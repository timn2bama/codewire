import { createHash, randomUUID } from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import type Stripe from "stripe";
import {
  claimStripeCheckoutReservation,
  publishStripeCheckoutReservation,
  retireStripeCheckoutReservation,
  yieldStripeCheckoutReservationLease,
  type CheckoutReservationClaim,
  type CheckoutReservationSnapshot,
} from "../server/checkoutReservation.js";
import {
  appOrigin,
  billingPricesConfigured,
  getStripe,
  getSupabaseAdmin,
  getUser,
  planFromPrice,
  priceIdFor,
} from "../server/shared.js";

export interface CheckoutSessionDependencies {
  appOrigin: typeof appOrigin;
  billingPricesConfigured: typeof billingPricesConfigured;
  checkoutCreationPaused: () => boolean;
  getStripe: typeof getStripe;
  getSupabaseAdmin: typeof getSupabaseAdmin;
  getUser: typeof getUser;
  getWebhookSecret: () => string | undefined;
  now: () => Date;
  planFromPrice: typeof planFromPrice;
  priceIdFor: typeof priceIdFor;
  randomUUID: typeof randomUUID;
  claimStripeCheckoutReservation: typeof claimStripeCheckoutReservation;
  publishStripeCheckoutReservation: typeof publishStripeCheckoutReservation;
  retireStripeCheckoutReservation: typeof retireStripeCheckoutReservation;
  yieldStripeCheckoutReservationLease:
    typeof yieldStripeCheckoutReservationLease;
}

const defaultDependencies: CheckoutSessionDependencies = {
  appOrigin,
  billingPricesConfigured,
  checkoutCreationPaused: () =>
    process.env.CHECKOUT_CREATION_PAUSED?.trim().toLowerCase() === "true",
  getStripe,
  getSupabaseAdmin,
  getUser,
  getWebhookSecret: () => process.env.STRIPE_WEBHOOK_SECRET,
  now: () => new Date(),
  planFromPrice,
  priceIdFor,
  randomUUID,
  claimStripeCheckoutReservation,
  publishStripeCheckoutReservation,
  retireStripeCheckoutReservation,
  yieldStripeCheckoutReservationLease,
};

const CHECKOUT_SESSION_LIFETIME_SECONDS = 60 * 60;

type CheckoutErrorCode =
  | "billing_confirmation_pending"
  | "billing_recovery_required"
  | "checkout_in_progress"
  | "checkout_internal_error"
  | "checkout_plan_locked"
  | "checkout_recovery_required"
  | "checkout_temporarily_unavailable"
  | "invalid_checkout_session"
  | "subscription_active";

class CheckoutResponseError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: CheckoutErrorCode,
    readonly retryable = false,
  ) {
    super(message);
  }
}

interface OwnedCheckoutLease {
  profileId: string;
  reservationId: string;
  leaseToken: string;
}

interface BillingProfile {
  stripe_customer_id: string | null;
  status: string;
}

function isMissingStripeResource(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "resource_missing",
  );
}

async function isUsableCustomer(
  stripe: Stripe,
  customerId: string,
  userId: string,
): Promise<boolean> {
  try {
    const customer = await stripe.customers.retrieve(customerId);
    if ("deleted" in customer && customer.deleted) return false;

    const owner = customer.metadata?.supabase_user_id;
    if (owner && owner !== userId) {
      throw new Error("Stripe customer is bound to a different account");
    }
    return true;
  } catch (error) {
    if (isMissingStripeResource(error)) return false;
    throw error;
  }
}

function blocksNewCheckout(profile: BillingProfile): boolean {
  return (
    profile.status === "active" ||
    profile.status === "trialing" ||
    profile.status === "past_due"
  );
}

function isCodewireSubscription(
  subscription: Stripe.Subscription,
  userId: string,
  priceToPlan: CheckoutSessionDependencies["planFromPrice"],
): boolean {
  return (
    subscription.metadata?.codewire === "true" ||
    subscription.metadata?.codewire_user_id === userId ||
    subscription.items.data.some((item) => priceToPlan(item.price.id) !== null)
  );
}

function isTerminalSubscriptionStatus(status: string): boolean {
  return status === "canceled" || status === "incomplete_expired";
}

function stripeIdempotencyKey(scope: string, ...parts: string[]): string {
  const digest = createHash("sha256").update(parts.join("\u0000")).digest("hex");
  return `codewire-${scope}:${digest}`;
}

function checkoutParameters(
  reservation: CheckoutReservationSnapshot,
): Stripe.Checkout.SessionCreateParams {
  if (reservation.requestVersion !== 1) {
    throw new Error("Unsupported checkout reservation version");
  }

  const reservationMetadata = {
    codewire: "true",
    codewire_user_id: reservation.profileId,
    codewire_checkout_reservation_id: reservation.reservationId,
  };
  const subscriptionData: Stripe.Checkout.SessionCreateParams.SubscriptionData = {
    metadata: reservationMetadata,
  };
  if (reservation.trialPeriodDays === 7) {
    subscriptionData.trial_period_days = 7;
  }

  return {
    mode: "subscription",
    customer: reservation.customerId,
    client_reference_id: reservation.reservationId,
    metadata: reservationMetadata,
    line_items: [{ price: reservation.priceId, quantity: 1 }],
    allow_promotion_codes: true,
    subscription_data: subscriptionData,
    expires_at: reservation.requestedExpiresAt,
    success_url: `${reservation.origin}/account?upgraded=1`,
    cancel_url: `${reservation.origin}/upgrade`,
  };
}

function sessionCustomerId(session: Stripe.Checkout.Session): string | null {
  if (typeof session.customer === "string") return session.customer;
  if (session.customer && !("deleted" in session.customer)) {
    return session.customer.id;
  }
  return null;
}

function sessionSubscriptionId(
  session: Stripe.Checkout.Session,
): string | null {
  if (typeof session.subscription === "string") return session.subscription;
  return session.subscription?.id ?? null;
}

function subscriptionCustomerId(
  subscription: Stripe.Subscription,
): string | null {
  if (typeof subscription.customer === "string") return subscription.customer;
  if (subscription.customer && !("deleted" in subscription.customer)) {
    return subscription.customer.id;
  }
  return null;
}

interface CheckoutSessionIdentity {
  reservationId: string;
  profileId: string;
  customerId: string;
  expiresAt: number;
  sessionId?: string;
}

function matchesCheckoutSessionIdentity(
  session: Stripe.Checkout.Session,
  identity: CheckoutSessionIdentity,
): boolean {
  return (
    (identity.sessionId === undefined || session.id === identity.sessionId) &&
    session.mode === "subscription" &&
    sessionCustomerId(session) === identity.customerId &&
    session.client_reference_id === identity.reservationId &&
    session.metadata?.codewire === "true" &&
    session.metadata?.codewire_user_id === identity.profileId &&
    session.metadata?.codewire_checkout_reservation_id ===
      identity.reservationId &&
    Number.isSafeInteger(session.expires_at) &&
    session.expires_at === identity.expiresAt
  );
}

function hasUsableCheckoutSession(
  session: Stripe.Checkout.Session,
  reservation: CheckoutReservationSnapshot,
  nowSeconds: number,
): session is Stripe.Checkout.Session & { url: string } {
  const url = session.url?.trim();
  if (!url) return false;

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return false;
  }

  return (
    parsedUrl.protocol === "https:" &&
    session.status === "open" &&
    matchesCheckoutSessionIdentity(session, {
      reservationId: reservation.reservationId,
      profileId: reservation.profileId,
      customerId: reservation.customerId,
      expiresAt: reservation.requestedExpiresAt,
    }) &&
    session.expires_at > nowSeconds
  );
}

async function checkoutTrialAlreadyUsed(
  stripe: Stripe,
  userId: string,
  customerId: string,
  priceToPlan: CheckoutSessionDependencies["planFromPrice"],
): Promise<boolean> {
  const subscriptions = await stripe.subscriptions.list({
    customer: customerId,
    status: "all",
    limit: 100,
  });
  if (subscriptions.has_more) {
    throw new CheckoutResponseError(
      409,
      "We could not safely verify every existing subscription. Open Billing or contact support before starting a new one.",
      "billing_recovery_required",
    );
  }

  const codewireSubscriptions = subscriptions.data.filter((subscription) =>
    isCodewireSubscription(subscription, userId, priceToPlan),
  );
  if (
    codewireSubscriptions.some(
      (subscription) => !isTerminalSubscriptionStatus(subscription.status),
    )
  ) {
    throw new CheckoutResponseError(
      409,
      "Resolve the existing subscription before starting a new one",
      "billing_recovery_required",
    );
  }

  return codewireSubscriptions.some(
    (subscription) =>
      subscription.trial_start !== null || subscription.trial_end !== null,
  );
}

function isTransientStripeFailure(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("type" in error)) return false;
  return [
    "StripeAPIError",
    "StripeConnectionError",
    "StripeIdempotencyError",
    "StripeRateLimitError",
  ].includes(String(error.type));
}

async function reconcileExpiredCheckout(
  dependencies: CheckoutSessionDependencies,
  stripe: Stripe,
  admin: ReturnType<typeof getSupabaseAdmin>,
  profileId: string,
  claim: Extract<CheckoutReservationClaim, { outcome: "reconcile" }>,
): Promise<void> {
  const identity: CheckoutSessionIdentity = {
    reservationId: claim.reservationId,
    profileId,
    customerId: claim.customerId,
    expiresAt: claim.sessionExpiresAt,
    sessionId: claim.stripeSessionId,
  };
  let session = await stripe.checkout.sessions.retrieve(claim.stripeSessionId);
  if (!matchesCheckoutSessionIdentity(session, identity)) {
    throw new CheckoutResponseError(
      502,
      "Stripe returned an unusable checkout session",
      "invalid_checkout_session",
    );
  }

  if (session.status === "open") {
    session = await stripe.checkout.sessions.expire(claim.stripeSessionId);
    if (!matchesCheckoutSessionIdentity(session, identity)) {
      throw new CheckoutResponseError(
        502,
        "Stripe returned an unusable checkout session",
        "invalid_checkout_session",
      );
    }
  }

  if (session.status === "complete") {
    const subscriptionId = sessionSubscriptionId(session);
    if (!subscriptionId) {
      throw new CheckoutResponseError(
        409,
        "Checkout completed and billing confirmation is still processing.",
        "billing_confirmation_pending",
      );
    }
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    if (
      subscriptionCustomerId(subscription) !== claim.customerId ||
      subscription.metadata?.codewire_checkout_reservation_id !==
        claim.reservationId ||
      !isCodewireSubscription(
        subscription,
        profileId,
        dependencies.planFromPrice,
      )
    ) {
      throw new CheckoutResponseError(
        502,
        "Stripe returned an unusable checkout session",
        "invalid_checkout_session",
      );
    }
    if (!isTerminalSubscriptionStatus(subscription.status)) {
      throw new CheckoutResponseError(
        409,
        "Checkout completed and billing confirmation is still processing.",
        "billing_confirmation_pending",
      );
    }
  } else if (session.status !== "expired") {
    throw new CheckoutResponseError(
      503,
      "Checkout is temporarily unavailable",
      "checkout_temporarily_unavailable",
      true,
    );
  }

  const retired = await dependencies.retireStripeCheckoutReservation(admin, {
    profileId,
    reservationId: claim.reservationId,
    leaseToken: claim.leaseToken,
    stripeSessionId: claim.stripeSessionId,
  });
  if (retired.outcome !== "retired") {
    throw new CheckoutResponseError(
      503,
      "Checkout is temporarily unavailable",
      "checkout_temporarily_unavailable",
      true,
    );
  }
}

/**
 * Creates a Stripe Checkout session for the signed-in user and returns its URL.
 * Body: { plan: "monthly" | "yearly" }
 */
export function createCheckoutSessionHandler(
  overrides: Partial<CheckoutSessionDependencies> = {},
) {
  const dependencies = { ...defaultDependencies, ...overrides };

  return async function checkoutSessionHandler(
    req: VercelRequest,
    res: VercelResponse,
  ): Promise<void> {
    let ownedLease: OwnedCheckoutLease | null = null;
    let leaseAdmin: ReturnType<
      CheckoutSessionDependencies["getSupabaseAdmin"]
    > | null = null;

    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    if (dependencies.checkoutCreationPaused()) {
      res.setHeader("Retry-After", "60");
      res.status(503).json({
        error: "Checkout is temporarily unavailable",
        code: "checkout_temporarily_unavailable",
        retryable: true,
      });
      return;
    }

    try {
      const user = await dependencies.getUser(req);
      if (!user) {
        res.status(401).json({ error: "Not signed in" });
        return;
      }

      const plan = (req.body?.plan as string) ?? "monthly";
      if (plan !== "monthly" && plan !== "yearly") {
        res.status(400).json({ error: "Unknown plan" });
        return;
      }

      if (
        !dependencies.billingPricesConfigured() ||
        !dependencies.getWebhookSecret()?.trim()
      ) {
        throw new Error("Stripe billing configuration is incomplete");
      }

      const price = dependencies.priceIdFor(plan);
      if (!price) {
        throw new Error("Stripe price configuration is incomplete");
      }

      const stripe = dependencies.getStripe();
      const admin = dependencies.getSupabaseAdmin();
      leaseAdmin = admin;

      // Reuse or create the Stripe customer for this user.
      const { data: profile, error: profileError } = await admin
        .from("profiles")
        .select("stripe_customer_id, status")
        .eq("id", user.id)
        .single();

      if (profileError || !profile) {
        throw profileError ?? new Error("Subscription profile was not found");
      }

      const billingProfile = profile as BillingProfile;
      if (blocksNewCheckout(billingProfile)) {
        res.status(409).json({
          error:
            billingProfile.status === "past_due"
              ? "Resolve the existing billing issue before starting a new subscription"
              : "Subscription already active",
        });
        return;
      }

      const observedCustomerId = billingProfile.stripe_customer_id;
      let customerId = observedCustomerId ?? undefined;

      // The saved customer may belong to a different Stripe mode (e.g. a live
      // customer after switching to a sandbox). Verify it exists in the current
      // mode; if not, fall through and create a fresh one.
      if (
        customerId &&
        !(await isUsableCustomer(stripe, customerId, user.id))
      ) {
        customerId = undefined;
      }

      if (!customerId) {
        const previousCustomerId = observedCustomerId ?? "initial";
        const customer = await stripe.customers.create(
          {
            email: user.email ?? undefined,
            metadata: {
              codewire: "true",
              supabase_user_id: user.id,
            },
          },
          {
            idempotencyKey: stripeIdempotencyKey(
              "customer",
              user.id,
              previousCustomerId,
            ),
          },
        );
        const createdCustomerId = customer.id;
        let bindQuery = admin
          .from("profiles")
          .update({ stripe_customer_id: createdCustomerId })
          .eq("id", user.id);

        bindQuery = observedCustomerId
          ? bindQuery.eq("stripe_customer_id", observedCustomerId)
          : bindQuery.is("stripe_customer_id", null);

        const { data: updatedProfile, error: updateError } = await bindQuery
          .select("id, stripe_customer_id")
          .maybeSingle();

        if (updateError) throw updateError;

        if (updatedProfile?.id === user.id) {
          customerId = createdCustomerId;
        } else {
          // Another request won the binding race. Use its verified customer
          // rather than overwriting it with this request's stale observation.
          const { data: winningProfile, error: winningError } = await admin
            .from("profiles")
            .select("stripe_customer_id")
            .eq("id", user.id)
            .single();

          const winningCustomerId = winningProfile?.stripe_customer_id;
          if (winningError || !winningCustomerId) {
            throw winningError ?? new Error("Stripe customer binding failed");
          }
          if (
            !(await isUsableCustomer(stripe, winningCustomerId, user.id))
          ) {
            throw new Error("Winning Stripe customer is unavailable");
          }
          customerId = winningCustomerId;
        }

        if (!customerId) throw new Error("Stripe customer binding failed");
      }

      let trialAlreadyUsed = await checkoutTrialAlreadyUsed(
        stripe,
        user.id,
        customerId,
        dependencies.planFromPrice,
      );
      const origin = dependencies.appOrigin(req);
      const claimReservation = () => {
        const requestedExpiresAt =
          Math.floor(dependencies.now().getTime() / 1000) +
          CHECKOUT_SESSION_LIFETIME_SECONDS;
        return dependencies.claimStripeCheckoutReservation(admin, {
          profileId: user.id,
          customerId,
          plan,
          priceId: price,
          origin,
          trialPeriodDays: trialAlreadyUsed ? null : 7,
          requestedExpiresAt: new Date(
            requestedExpiresAt * 1000,
          ).toISOString(),
          reservationId: dependencies.randomUUID(),
          leaseToken: dependencies.randomUUID(),
        });
      };

      let claim = await claimReservation();
      if (claim.outcome === "reconcile") {
        ownedLease = {
          profileId: user.id,
          reservationId: claim.reservationId,
          leaseToken: claim.leaseToken,
        };
        await reconcileExpiredCheckout(
          dependencies,
          stripe,
          admin,
          user.id,
          claim,
        );
        ownedLease = null;

        // Close the expiry-boundary race: after Stripe confirms the old
        // Session is expired, verify subscriptions again before allocating a
        // fresh reservation and idempotency key.
        trialAlreadyUsed = await checkoutTrialAlreadyUsed(
          stripe,
          user.id,
          customerId,
          dependencies.planFromPrice,
        );
        claim = await claimReservation();
        if (claim.outcome === "reconcile") {
          throw new CheckoutResponseError(
            503,
            "Checkout is temporarily unavailable",
            "checkout_temporarily_unavailable",
            true,
          );
        }
      }

      if (claim.outcome === "reuse") {
        const nowSeconds = Math.floor(dependencies.now().getTime() / 1000);
        if (claim.plan !== plan || claim.expiresAt <= nowSeconds) {
          throw new Error("Checkout reservation returned an invalid reusable session");
        }
        res.status(200).json({
          url: claim.url,
          outcome: "reused",
          expiresAt: claim.expiresAt,
        });
        return;
      }

      if (claim.outcome === "wait") {
        res.setHeader("Retry-After", "2");
        res.status(503).json({
          error: "Checkout is already being prepared. Try again in a moment.",
          code: "checkout_in_progress",
          retryable: true,
        });
        return;
      }

      if (claim.outcome === "blocked") {
        if (claim.reason === "checkout_plan_locked") {
          res.status(409).json({
            error:
              "Finish the existing checkout or wait for it to expire before changing plans.",
            code: "checkout_plan_locked",
            activePlan: claim.activePlan,
            expiresAt: claim.expiresAt,
          });
          return;
        }
        if (claim.reason === "subscription_active") {
          res.status(409).json({
            error: "Subscription already active",
            code: "subscription_active",
          });
          return;
        }
        if (claim.reason === "checkout_recovery_required") {
          res.status(409).json({
            error:
              "The previous checkout needs review before another session can be opened.",
            code: "checkout_recovery_required",
            activePlan: claim.activePlan,
            expiresAt: claim.expiresAt,
          });
          return;
        }
        throw new Error(`Checkout reservation blocked: ${claim.reason}`);
      }

      const reservation = claim.snapshot;
      if (
        reservation.profileId !== user.id ||
        reservation.customerId !== customerId ||
        reservation.plan !== plan
      ) {
        throw new Error("Checkout reservation identity mismatch");
      }
      ownedLease = {
        profileId: reservation.profileId,
        reservationId: reservation.reservationId,
        leaseToken: reservation.leaseToken,
      };

      const session = await stripe.checkout.sessions.create(
        checkoutParameters(reservation),
        {
          idempotencyKey: reservation.idempotencyKey,
        },
      );

      const nowSeconds = Math.floor(dependencies.now().getTime() / 1000);
      if (session.status === "complete") {
        throw new CheckoutResponseError(
          409,
          "Checkout completed and billing confirmation is still processing.",
          "billing_confirmation_pending",
        );
      }
      if (!hasUsableCheckoutSession(session, reservation, nowSeconds)) {
        throw new CheckoutResponseError(
          502,
          "Stripe returned an unusable checkout session",
          "invalid_checkout_session",
        );
      }

      const publish = await dependencies.publishStripeCheckoutReservation(
        admin,
        {
          profileId: reservation.profileId,
          reservationId: reservation.reservationId,
          leaseToken: reservation.leaseToken,
          stripeSessionId: session.id,
          checkoutUrl: session.url,
          stripeExpiresAt: new Date(session.expires_at * 1000).toISOString(),
        },
      );
      if (publish.outcome === "stale") {
        throw new CheckoutResponseError(
          503,
          "Checkout is temporarily unavailable",
          "checkout_temporarily_unavailable",
          true,
        );
      }
      if (
        publish.url !== session.url ||
        publish.expiresAt !== session.expires_at
      ) {
        throw new CheckoutResponseError(
          503,
          "Checkout is temporarily unavailable",
          "checkout_temporarily_unavailable",
          true,
        );
      }
      ownedLease = null;
      res.status(200).json({
        url: publish.url,
        outcome: publish.outcome === "stored" ? "created" : "reused",
        expiresAt: publish.expiresAt,
      });
    } catch (err) {
      if (ownedLease && leaseAdmin) {
        try {
          await dependencies.yieldStripeCheckoutReservationLease(
            leaseAdmin,
            ownedLease,
          );
        } catch (yieldError) {
          console.error("Checkout reservation lease yield failed", yieldError);
        }
      }

      if (err instanceof CheckoutResponseError) {
        if (err.retryable) res.setHeader("Retry-After", "2");
        res.status(err.status).json({
          error: err.message,
          code: err.code,
          ...(err.retryable ? { retryable: true } : {}),
        });
        return;
      }

      if (isTransientStripeFailure(err)) {
        console.error("Transient Stripe Checkout failure", {
          type: (err as { type?: unknown }).type,
          code: (err as { code?: unknown }).code,
          requestId: (err as { requestId?: unknown }).requestId,
        });
        res.setHeader("Retry-After", "2");
        res.status(503).json({
          error: "Checkout is temporarily unavailable",
          code: "checkout_temporarily_unavailable",
          retryable: true,
        });
        return;
      }

      console.error("Checkout session creation failed", err);
      res.status(500).json({
        error: "Checkout session creation failed",
        code: "checkout_internal_error",
      });
    }
  };
}

export default createCheckoutSessionHandler();
