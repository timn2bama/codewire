import { createHash } from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import type Stripe from "stripe";
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
  getStripe: typeof getStripe;
  getSupabaseAdmin: typeof getSupabaseAdmin;
  getUser: typeof getUser;
  getWebhookSecret: () => string | undefined;
  planFromPrice: typeof planFromPrice;
  priceIdFor: typeof priceIdFor;
}

const defaultDependencies: CheckoutSessionDependencies = {
  appOrigin,
  billingPricesConfigured,
  getStripe,
  getSupabaseAdmin,
  getUser,
  getWebhookSecret: () => process.env.STRIPE_WEBHOOK_SECRET,
  planFromPrice,
  priceIdFor,
};

interface BillingProfile {
  stripe_customer_id: string | null;
  status: string;
  current_period_end: string | null;
  updated_at: string;
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

function requiresExistingSubscriptionRecovery(
  status: Stripe.Subscription.Status,
): boolean {
  return (
    status === "active" ||
    status === "trialing" ||
    status === "past_due" ||
    status === "incomplete" ||
    status === "paused" ||
    status === "unpaid"
  );
}

function stripeIdempotencyKey(scope: string, ...parts: string[]): string {
  const digest = createHash("sha256").update(parts.join("\u0000")).digest("hex");
  return `codewire-${scope}:${digest}`;
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
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
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

      // Reuse or create the Stripe customer for this user.
      const { data: profile, error: profileError } = await admin
        .from("profiles")
        .select("stripe_customer_id, status, current_period_end, updated_at")
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

      if (!billingProfile.updated_at) {
        throw new Error("Subscription profile has no version timestamp");
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

      const subscriptions = await stripe.subscriptions.list({
        customer: customerId,
        status: "all",
        limit: 100,
      });
      const codewireSubscriptions = subscriptions.data.filter((subscription) =>
        isCodewireSubscription(
          subscription,
          user.id,
          dependencies.planFromPrice,
        ),
      );
      if (
        codewireSubscriptions.some((subscription) =>
          requiresExistingSubscriptionRecovery(subscription.status),
        )
      ) {
        res.status(409).json({
          error:
            "Resolve the existing subscription before starting a new one",
        });
        return;
      }

      const trialAlreadyUsed =
        subscriptions.has_more ||
        codewireSubscriptions.some(
          (subscription) =>
            subscription.trial_start !== null ||
            subscription.trial_end !== null,
        );
      const subscriptionData: Stripe.Checkout.SessionCreateParams.SubscriptionData = {
        metadata: {
          codewire: "true",
          codewire_user_id: user.id,
        },
      };
      if (!trialAlreadyUsed) subscriptionData.trial_period_days = 7;

      const origin = dependencies.appOrigin(req);
      const session = await stripe.checkout.sessions.create(
        {
          mode: "subscription",
          customer: customerId,
          line_items: [{ price, quantity: 1 }],
          allow_promotion_codes: true,
          subscription_data: subscriptionData,
          success_url: `${origin}/account?upgraded=1`,
          cancel_url: `${origin}/upgrade`,
        },
        {
          idempotencyKey: stripeIdempotencyKey(
            "checkout",
            user.id,
            customerId,
            plan,
            billingProfile.updated_at,
          ),
        },
      );

      res.status(200).json({ url: session.url });
    } catch (err) {
      console.error("Checkout session creation failed", err);
      res.status(500).json({ error: "Checkout session creation failed" });
    }
  };
}

export default createCheckoutSessionHandler();
