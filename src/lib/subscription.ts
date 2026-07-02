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
  const [status, setStatus] = useState<SubStatus>("free");
  const [plan, setPlan] = useState<string | null>(null);
  const [periodEnd, setPeriodEnd] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!supabase || !user) {
      setStatus("free");
      setPlan(null);
      setPeriodEnd(null);
      return;
    }
    let active = true;
    setLoading(true);
    supabase
      .from("profiles")
      .select("status, plan, current_period_end")
      .eq("id", user.id)
      .single()
      .then(({ data }) => {
        if (!active) return;
        setStatus((data?.status as SubStatus) ?? "free");
        setPlan(data?.plan ?? null);
        setPeriodEnd(data?.current_period_end ?? null);
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [user, nonce]);

  const isPro = devProOverride() || PRO_STATUSES.includes(status);

  return {
    isPro,
    status,
    plan,
    currentPeriodEnd: periodEnd,
    loading,
    refresh: () => setNonce((n) => n + 1),
  };
}
