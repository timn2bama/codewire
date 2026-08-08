import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import { useAuth } from "./auth";

export type SubStatus =
  | "free"
  | "trialing"
  | "active"
  | "canceled"
  | "past_due";

export interface Subscription {
  isPro: boolean;
  status: SubStatus;
  plan: string | null;
  currentPeriodEnd: string | null;
  loading: boolean;
  refresh: () => void;
}

/**
 * Dev-only Pro override so Pro UI/gating can be exercised locally without a
 * live Stripe subscription. Toggle in the console:
 *   localStorage.setItem('cw:dev-pro','1')  // then reload
 * Ignored in production builds.
 */
function devProOverride(): boolean {
  return import.meta.env.DEV && localStorage.getItem("cw:dev-pro") === "1";
}

const PRO_STATUSES: SubStatus[] = ["trialing", "active"];

export function useSubscription(): Subscription {
  const { user } = useAuth();
  const [subscription, setSubscription] = useState<{
    userId: string;
    status: SubStatus;
    plan: string | null;
    periodEnd: string | null;
  } | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!supabase || !user) return;
    let active = true;
    supabase
      .from("profiles")
      .select("status, plan, current_period_end")
      .eq("id", user.id)
      .single()
      .then(({ data }) => {
        if (!active) return;
        setSubscription({
          userId: user.id,
          status: (data?.status as SubStatus) ?? "free",
          plan: data?.plan ?? null,
          periodEnd: data?.current_period_end ?? null,
        });
      });
    return () => {
      active = false;
    };
  }, [user, nonce]);

  // Never show one account's cached entitlement for another account (or after
  // sign-out) while the current profile request is in flight.
  const current = user && subscription?.userId === user.id ? subscription : null;
  const status = current?.status ?? "free";
  const isPro = devProOverride() || PRO_STATUSES.includes(status);

  return {
    isPro,
    status,
    plan: current?.plan ?? null,
    currentPeriodEnd: current?.periodEnd ?? null,
    loading: Boolean(supabase && user && !current),
    refresh: () => setNonce((n) => n + 1),
  };
}
