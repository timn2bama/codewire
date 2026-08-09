import type { SupabaseClient } from "@supabase/supabase-js";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import type Stripe from "stripe";
import {
  billingPricesConfigured,
  getStripe,
  getSupabaseAdmin,
  planFromPrice,
  type BillingPlan,
} from "../server/shared.js";

// Stripe needs the raw request body to verify the signature.
export const config = { api: { bodyParser: false } };

type EntitlementStatus = "trialing" | "active" | "canceled" | "past_due";
type PersistenceResult =
  | "applied"
  | "duplicate"
  | "stale"
  | "missing_profile";

export interface StripeWebhookDependencies {
  getStripe: () => Stripe;
  getSupabaseAdmin: () => SupabaseClient;
  getWebhookSecret: () => string | undefined;
  planFromPrice: (priceId: string | undefined) => BillingPlan | null;
  billingPricesConfigured: () => boolean;
}

const defaultDependencies: StripeWebhookDependencies = {
  getStripe,
  getSupabaseAdmin,
  getWebhookSecret: () => process.env.STRIPE_WEBHOOK_SECRET,
  planFromPrice,
  billingPricesConfigured,
};

const SUPPORTED_SUBSCRIPTION_EVENTS = new Set<string>([
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
]);

async function readRawBody(req: VercelRequest): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

function customerIdFor(sub: Stripe.Subscription): string | null {
  if (typeof sub.customer === "string") return sub.customer;
  return sub.customer?.id ?? null;
}

function mapStatus(status: Stripe.Subscription.Status): EntitlementStatus {
  switch (status) {
    case "trialing":
      return "trialing";
    case "active":
      return "active";
    case "past_due":
    case "incomplete":
    case "paused":
    case "unpaid":
      return "past_due";
    default:
      return "canceled";
  }
}

function periodEndIso(
  item: Stripe.SubscriptionItem | undefined,
  subscription: Stripe.Subscription,
): string | null {
  const legacyPeriodEnd = (subscription as Stripe.Subscription & {
    current_period_end?: number;
  }).current_period_end;
  const seconds = item?.current_period_end ?? legacyPeriodEnd;
  if (!Number.isSafeInteger(seconds) || !seconds || seconds <= 0) return null;

  const periodEnd = new Date(seconds * 1000);
  return Number.isNaN(periodEnd.getTime()) ? null : periodEnd.toISOString();
}

function isCodewireSubscription(sub: Stripe.Subscription): boolean {
  return (
    sub.metadata?.codewire === "true" ||
    Boolean(sub.metadata?.codewire_user_id)
  );
}

function normalizeSubscription(
  sub: Stripe.Subscription,
  priceToPlan: StripeWebhookDependencies["planFromPrice"],
) {
  const recognizedItems = sub.items.data.flatMap((item) => {
    const plan = priceToPlan(item.price.id);
    return plan ? [{ item, plan }] : [];
  });

  if (recognizedItems.length === 0 && !isCodewireSubscription(sub)) {
    return null;
  }

  // Missing, ambiguous, or duplicated Codewire prices fail closed instead of
  // retaining an active entitlement with an uncertain plan.
  if (recognizedItems.length !== 1) {
    return { status: "canceled" as const, plan: null, currentPeriodEnd: null };
  }

  const [{ item, plan }] = recognizedItems;
  const status = mapStatus(sub.status);
  const currentPeriodEnd = periodEndIso(item, sub);

  if (
    (status === "active" || status === "trialing") &&
    currentPeriodEnd === null
  ) {
    throw new Error("Active subscription has no valid current period end");
  }

  return { status, plan, currentPeriodEnd };
}

function respondWithProcessingFailure(
  res: VercelResponse,
  error: unknown,
): void {
  console.error("Stripe webhook processing failed", error);
  res.status(500).json({ error: "Webhook processing failed" });
}

export function createStripeWebhookHandler(
  overrides: Partial<StripeWebhookDependencies> = {},
) {
  const dependencies = { ...defaultDependencies, ...overrides };

  return async function stripeWebhookHandler(
    req: VercelRequest,
    res: VercelResponse,
  ): Promise<void> {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    const secret = dependencies.getWebhookSecret();
    if (!secret || !dependencies.billingPricesConfigured()) {
      respondWithProcessingFailure(
        res,
        new Error("Stripe webhook configuration is incomplete"),
      );
      return;
    }

    let stripe: Stripe;
    try {
      stripe = dependencies.getStripe();
    } catch (error) {
      respondWithProcessingFailure(res, error);
      return;
    }

    let event: Stripe.Event;
    try {
      const rawBody = await readRawBody(req);
      const signature = req.headers["stripe-signature"];
      if (typeof signature !== "string") {
        throw new Error("Stripe signature header is missing");
      }
      event = stripe.webhooks.constructEvent(rawBody, signature, secret);
    } catch {
      res.status(400).json({ error: "Invalid webhook signature" });
      return;
    }

    if (!SUPPORTED_SUBSCRIPTION_EVENTS.has(event.type)) {
      res.status(200).json({ received: true });
      return;
    }

    try {
      const subscription = event.data.object as Stripe.Subscription;
      if (!subscription.id) {
        throw new Error("Stripe event is missing a subscription id");
      }
      const normalized = normalizeSubscription(
        subscription,
        dependencies.planFromPrice,
      );

      // Ignore unrelated Stripe subscriptions, including products that share
      // the same account but were never tagged or priced for Codewire.
      if (!normalized) {
        res.status(200).json({ received: true });
        return;
      }

      const customerId = customerIdFor(subscription);
      if (!event.id || !customerId) {
        throw new Error("Stripe event is missing a required identifier");
      }

      const admin = dependencies.getSupabaseAdmin();
      const { data, error } = await admin.rpc(
        "apply_stripe_entitlement_event",
        {
          p_event_id: event.id,
          p_event_created: event.created,
          p_event_type: event.type,
          p_customer_id: customerId,
          p_subscription_id: subscription.id,
          p_status: normalized.status,
          p_plan: normalized.plan,
          p_current_period_end: normalized.currentPeriodEnd,
        },
      );

      if (error) throw error;
      const result = data as PersistenceResult | null;
      if (
        result !== "applied" &&
        result !== "duplicate" &&
        result !== "stale"
      ) {
        throw new Error(`Entitlement persistence failed: ${String(result)}`);
      }

      res.status(200).json({ received: true });
    } catch (error) {
      respondWithProcessingFailure(res, error);
    }
  };
}

export default createStripeWebhookHandler();
