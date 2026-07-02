import type { VercelRequest, VercelResponse } from "@vercel/node";
import { appOrigin, getStripe, getSupabaseAdmin, getUser } from "../server/shared.js";

/**
 * Opens the Stripe Customer Portal so the user can manage or cancel their plan.
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

    const admin = getSupabaseAdmin();
    const { data: profile } = await admin
      .from("profiles")
      .select("stripe_customer_id")
      .eq("id", user.id)
      .single();

    const customerId = profile?.stripe_customer_id as string | undefined;
    if (!customerId) {
      res.status(400).json({ error: "No billing account yet" });
      return;
    }

    const stripe = getStripe();
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${appOrigin(req)}/account`,
    });

    res.status(200).json({ url: session.url });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}
