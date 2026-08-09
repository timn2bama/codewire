import Stripe from "stripe";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { VercelRequest } from "@vercel/node";

/** Shared server-side helpers for the Vercel serverless functions under /api. */

export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  return new Stripe(key, { apiVersion: "2026-05-27.dahlia" });
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

export type BillingPlan = "monthly" | "yearly";

function currentPriceId(plan: BillingPlan): string | undefined {
  const value =
    plan === "monthly"
      ? process.env.STRIPE_PRICE_MONTHLY
      : process.env.STRIPE_PRICE_YEARLY;
  return value?.trim() || undefined;
}

function configuredPriceIds(plan: BillingPlan): string[] {
  const current = currentPriceId(plan);
  const legacy =
    plan === "monthly"
      ? process.env.STRIPE_PRICE_MONTHLY_LEGACY
      : process.env.STRIPE_PRICE_YEARLY_LEGACY;

  return Array.from(
    new Set(
      [current, ...(legacy?.split(",") ?? [])]
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  );
}

export function priceIdFor(plan: string): string | undefined {
  if (plan === "monthly") return currentPriceId("monthly");
  if (plan === "yearly") return currentPriceId("yearly");
  return undefined;
}

export function planFromPrice(
  priceId: string | undefined,
): BillingPlan | null {
  if (!priceId) return null;
  const monthly = configuredPriceIds("monthly");
  const yearly = configuredPriceIds("yearly");
  if (monthly.includes(priceId) === yearly.includes(priceId)) return null;
  if (yearly.includes(priceId)) return "yearly";
  if (monthly.includes(priceId)) return "monthly";
  return null;
}

export function billingPricesConfigured(): boolean {
  const currentMonthly = currentPriceId("monthly");
  const currentYearly = currentPriceId("yearly");
  const monthly = configuredPriceIds("monthly");
  const yearly = configuredPriceIds("yearly");
  return Boolean(
    currentMonthly &&
      currentYearly &&
      !monthly.some((priceId) => yearly.includes(priceId)),
  );
}

export function appOrigin(req: VercelRequest): string {
  const configured = process.env.APP_ORIGIN?.trim();
  if (configured) {
    const url = new URL(configured);
    if (url.protocol !== "https:" && url.hostname !== "localhost") {
      throw new Error("APP_ORIGIN must use HTTPS");
    }
    return url.origin;
  }

  if (process.env.VERCEL_ENV === "production") {
    return "https://codewire.tools";
  }

  const proto = (req.headers["x-forwarded-proto"] as string) ?? "https";
  const host = req.headers.host;
  if (!host) throw new Error("Request host is missing");
  return `${proto}://${host}`;
}
