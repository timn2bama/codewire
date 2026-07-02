import Stripe from "stripe";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { VercelRequest } from "@vercel/node";

/** Shared server-side helpers for the Vercel serverless functions under /api. */

export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  return new Stripe(key);
}

export function getSupabaseAdmin(): SupabaseClient {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey)
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set");
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Resolve the signed-in user from the Bearer token sent by the client. */
export async function getUser(
  req: VercelRequest,
): Promise<{ id: string; email: string | null } | null> {
  const auth = req.headers.authorization;
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return null;
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email ?? null };
}

export function priceIdFor(plan: string): string | undefined {
  return plan === "yearly"
    ? process.env.STRIPE_PRICE_YEARLY
    : process.env.STRIPE_PRICE_MONTHLY;
}

export function planFromPrice(priceId: string | undefined): string | null {
  if (!priceId) return null;
  if (priceId === process.env.STRIPE_PRICE_YEARLY) return "yearly";
  if (priceId === process.env.STRIPE_PRICE_MONTHLY) return "monthly";
  return null;
}

export function appOrigin(req: VercelRequest): string {
  const proto = (req.headers["x-forwarded-proto"] as string) ?? "https";
  const host = req.headers.host;
  return `${proto}://${host}`;
}
