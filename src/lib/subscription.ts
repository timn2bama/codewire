import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "./auth";
import { supabase } from "./supabase";

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
  /** True once the current account's entitlement request has settled. */
  ready: boolean;
  /** A profile-query error. Call refresh() to retry. */
  error: string | null;
  refresh: () => void;
}

interface SubscriptionRecord {
  userId: string;
  nonce: number;
  status: SubStatus;
  plan: string | null;
  periodEnd: string | null;
  error: string | null;
}

/**
 * Dev-only Pro override so Pro UI/gating can be exercised locally without a
 * live Stripe subscription. Toggle in the console:
 *   localStorage.setItem('cw:dev-pro','1')  // then reload
 * Ignored in production builds.
 */
function devProOverride(): boolean {
  if (!import.meta.env.DEV || typeof window === "undefined") return false;

  try {
    return window.localStorage.getItem("cw:dev-pro") === "1";
  } catch {
    return false;
  }
}

const SUB_STATUSES: readonly SubStatus[] = [
  "free",
  "trialing",
  "active",
  "canceled",
  "past_due",
];
const PRO_STATUSES: readonly SubStatus[] = ["trialing", "active"];

function isSubStatus(value: unknown): value is SubStatus {
  return SUB_STATUSES.includes(value as SubStatus);
}

function getErrorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return "Unable to load subscription status.";
}

const SubscriptionContext = createContext<Subscription | null>(null);

/**
 * Owns the single subscription-profile request for the application. Keeping
 * this above every consumer means a refresh from Account also updates cloud
 * sync and every Pro gate without issuing independent profile queries.
 */
export function SubscriptionProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [record, setRecord] = useState<SubscriptionRecord | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!supabase || !user) return;

    const userId = user.id;
    const requestNonce = nonce;
    let active = true;

    void (async () => {
      try {
        const { data, error } = await supabase
          .from("profiles")
          .select("status, plan, current_period_end")
          .eq("id", userId)
          .single();

        if (!active) return;
        if (error) {
          setRecord({
            userId,
            nonce: requestNonce,
            status: "free",
            plan: null,
            periodEnd: null,
            error: getErrorMessage(error),
          });
          return;
        }

        setRecord({
          userId,
          nonce: requestNonce,
          status: isSubStatus(data?.status) ? data.status : "free",
          plan: typeof data?.plan === "string" ? data.plan : null,
          periodEnd:
            typeof data?.current_period_end === "string"
              ? data.current_period_end
              : null,
          error: null,
        });
      } catch (error) {
        if (!active) return;
        setRecord({
          userId,
          nonce: requestNonce,
          status: "free",
          plan: null,
          periodEnd: null,
          error: getErrorMessage(error),
        });
      }
    })();

    return () => {
      active = false;
    };
  }, [user, nonce]);

  const refresh = useCallback(() => setNonce((current) => current + 1), []);
  const current = user && record?.userId === user.id ? record : null;
  const loading = Boolean(
    supabase && user && (!current || current.nonce !== nonce),
  );
  const status = current?.status ?? "free";
  const error = current?.nonce === nonce ? current.error : null;
  const isPro = devProOverride() || PRO_STATUSES.includes(status);

  const value = useMemo<Subscription>(
    () => ({
      isPro,
      status,
      plan: current?.plan ?? null,
      currentPeriodEnd: current?.periodEnd ?? null,
      loading,
      ready: !loading,
      error,
      refresh,
    }),
    [current?.periodEnd, current?.plan, error, isPro, loading, refresh, status],
  );

  return createElement(SubscriptionContext.Provider, { value }, children);
}

export function useSubscription(): Subscription {
  const subscription = useContext(SubscriptionContext);
  if (!subscription) {
    throw new Error(
      "useSubscription must be used within <SubscriptionProvider>",
    );
  }
  return subscription;
}
