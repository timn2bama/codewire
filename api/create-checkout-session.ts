import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  appOrigin,
  getStripe,
  getSupabaseAdmin,
  getUser,
  priceIdFor,
} from "../server/shared.js";

/**
 * Creates a Stripe Checkout session for the signed-in user and returns its URL.
 * Body: { plan: "monthly" | "yearly" }
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  try {
    const user = await getUser(req);
    if (!user) {
      res.status(401).json({ error: "Not signed in" });
      return;
    }

    const plan = (req.body?.plan as string) ?? "monthly";
    const price = priceIdFor(plan);
    if (!price) {
      res.status(400).json({ error: "Unknown plan" });
      return;
    }

    const stripe = getStripe();
    const admin = getSupabaseAdmin();

    // Reuse or create the Stripe customer for this user.
    const { data: profile } = await admin
      .from("profiles")
      .select("stripe_customer_id")
      .eq("id", user.id)
      .single();

    let customerId = profile?.stripe_customer_id as string | undefined;

    // The saved customer may belong to a different Stripe mode (e.g. a live
    // customer after switching to a sandbox). Verify it exists in the current
    // mode; if not, fall through and create a fresh one.
    if (customerId) {
      try {
        const existing = await stripe.customers.retrieve(customerId);
        if ((existing as { deleted?: boolean }).deleted) customerId = undefined;
      } catch {
        customerId = undefined;
      }
    }

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email ?? undefined,
        metadata: { supabase_user_id: user.id },
      });
      customerId = customer.id;
      await admin
        .from("profiles")
        .update({ stripe_customer_id: customerId })
        .eq("id", user.id);
    }

    const origin = appOrigin(req);
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price, quantity: 1 }],
      allow_promotion_codes: true,
      subscription_data: { trial_period_days: 7 },
      success_url: `${origin}/account?upgraded=1`,
      cancel_url: `${origin}/upgrade`,
    });

    res.status(200).json({ url: session.url });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}
