import { supabase } from "./supabase";

async function authedPost<T>(path: string, body: unknown): Promise<T> {
  if (!supabase) throw new Error("Cloud accounts are not configured.");
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Please sign in first.");
  const res = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const msg = await res.json().catch(() => ({}));
    throw new Error(msg.error || "Request failed");
  }
  return res.json() as Promise<T>;
}

/** Start Stripe Checkout for the chosen plan and redirect to it. */
export async function startCheckout(plan: "monthly" | "yearly") {
  const { url } = await authedPost<{ url: string }>(
    "/api/create-checkout-session",
    { plan },
  );
  window.location.href = url;
}

/** Open the Stripe Customer Portal to manage/cancel the subscription. */
export async function openBillingPortal() {
  const { url } = await authedPost<{ url: string }>(
    "/api/create-portal-session",
    {},
  );
  window.location.href = url;
}
