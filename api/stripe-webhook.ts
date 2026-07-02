import type { VercelRequest, VercelResponse } from "@vercel/node";
import type Stripe from "stripe";
import { getStripe, getSupabaseAdmin, planFromPrice } from "../server/shared.js";

// Stripe needs the raw request body to verify the signature.
export const config = { api: { bodyParser: false } };

async function readRawBody(req: VercelRequest): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

type OurStatus = "free" | "trialing" | "active" | "canceled" | "past_due";

function mapStatus(s: Stripe.Subscription.Status): OurStatus {
  switch (s) {
    case "trialing":
      return "trialing";
    case "active":
      return "active";
    case "past_due":
      return "past_due";
    default:
      return "canceled";
  }
}

async function syncSubscription(sub: Stripe.Subscription) {
  const admin = getSupabaseAdmin();
  const item = sub.items.data[0];
  const priceId = item?.price.id;
  const periodEnd = item?.current_period_end
    ? new Date(item.current_period_end * 1000).toISOString()
    : null;
  await admin
    .from("profiles")
    .update({
      status: mapStatus(sub.status),
      plan: planFromPrice(priceId),
      current_period_end: periodEnd,
      updated_at: new Date().toISOString(),
    })
    .eq("stripe_customer_id", sub.customer as string);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const stripe = getStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    res.status(500).json({ error: "STRIPE_WEBHOOK_SECRET not set" });
    return;
  }

  let event: Stripe.Event;
  try {
    const raw = await readRawBody(req);
    const sig = req.headers["stripe-signature"] as string;
    event = stripe.webhooks.constructEvent(raw, sig, secret);
  } catch (err) {
    res.status(400).json({ error: `Webhook signature failed: ${(err as Error).message}` });
    return;
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.subscription) {
          const sub = await stripe.subscriptions.retrieve(
            session.subscription as string,
          );
          await syncSubscription(sub);
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        await syncSubscription(event.data.object as Stripe.Subscription);
        break;
      }
      default:
        break;
    }
    res.status(200).json({ received: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}
