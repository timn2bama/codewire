import type { SubStatus } from "./subscription";

export type UpgradeBillingAction = "checkout" | "portal" | "refresh" | "none";

export interface UpgradeBillingView {
  kind: "pro" | "offer" | "recovery" | "loading" | "error" | "unavailable";
  action: UpgradeBillingAction;
  cta: string;
  detail: string;
}

export function getUpgradeBillingView({
  cloudEnabled,
  isPro,
  status,
  loading,
  error,
}: {
  cloudEnabled: boolean;
  isPro: boolean;
  status: SubStatus;
  loading: boolean;
  error: string | null;
}): UpgradeBillingView {
  if (!cloudEnabled) {
    return {
      kind: "unavailable",
      action: "none",
      cta: "Billing unavailable",
      detail: "Cloud billing isn't configured in this build yet.",
    };
  }
  if (loading) {
    return {
      kind: "loading",
      action: "none",
      cta: "Checking your plan...",
      detail: "Confirming your billing status before checkout.",
    };
  }
  if (error) {
    return {
      kind: "error",
      action: "refresh",
      cta: "Check plan again",
      detail: "Codewire couldn't verify your plan, so checkout is paused.",
    };
  }
  if (isPro) {
    return {
      kind: "pro",
      action: "none",
      cta: "Manage your plan",
      detail: "Your Codewire Pro subscription is active.",
    };
  }
  if (status === "past_due" || status === "active" || status === "trialing") {
    return {
      kind: "recovery",
      action: "portal",
      cta: status === "past_due" ? "Fix billing" : "Review billing",
      detail:
        status === "past_due"
          ? "Resolve the payment issue on your existing subscription before starting another checkout."
          : "Review your existing subscription before starting another checkout.",
    };
  }
  return {
    kind: "offer",
    action: "checkout",
    cta: "Continue to secure checkout",
    detail:
      "Eligible first-time subscribers receive a 7-day trial. Stripe shows any amount due before confirmation.",
  };
}

export interface CheckoutReturnNotice {
  tone: "success" | "pending" | "warning";
  message: string;
}

export function getCheckoutReturnNotice({
  justUpgraded,
  signedIn,
  status,
  isPro,
  loading,
  error,
  timedOut = false,
}: {
  justUpgraded: boolean;
  signedIn: boolean;
  status: SubStatus;
  isPro: boolean;
  loading: boolean;
  error: string | null;
  timedOut?: boolean;
}): CheckoutReturnNotice | null {
  if (!justUpgraded) return null;
  if (!signedIn) {
    return {
      tone: "pending",
      message: "Sign in to verify your Codewire Pro status.",
    };
  }
  if (loading) {
    return {
      tone: "pending",
      message: "Verifying your Codewire Pro status...",
    };
  }
  if (error) {
    return {
      tone: "warning",
      message: "Codewire couldn't verify your Pro status yet. Check your plan again.",
    };
  }
  if (isPro && status === "trialing") {
    return {
      tone: "success",
      message: "Welcome to Pro! Your trial has started.",
    };
  }
  if (isPro && status === "active") {
    return {
      tone: "success",
      message: "Welcome to Pro! Your subscription is active.",
    };
  }
  if (status === "past_due") {
    return {
      tone: "warning",
      message: "Your checkout returned, but billing still needs attention.",
    };
  }
  if (status === "active" || status === "trialing") {
    return {
      tone: "warning",
      message:
        "Your subscription needs verification before Pro can be enabled. Review billing or check your plan again.",
    };
  }
  if (timedOut) {
    return {
      tone: "warning",
      message:
        "Stripe confirmation is taking longer than expected. Check your plan again before starting another checkout.",
    };
  }
  return {
    tone: "pending",
    message: "Checkout returned. Waiting for Stripe to confirm your subscription.",
  };
}

export interface CheckoutConfirmationState {
  isPro: boolean;
  status: SubStatus;
  loading: boolean;
  error: string | null;
}

export function needsCheckoutConfirmation(
  state: CheckoutConfirmationState,
): boolean {
  return (
    !state.isPro &&
    (state.status === "free" || state.status === "canceled") &&
    !state.error
  );
}

const DEFAULT_CONFIRMATION_DELAYS_MS = [0, 1_000, 2_000, 4_000, 8_000];

/**
 * Polls the shared subscription profile after Stripe Checkout returns. The
 * controller reads current state on every tick so React can update it without
 * rebuilding the timer chain. It always stops on a terminal result, error,
 * timeout, or explicit cleanup.
 */
export function startCheckoutConfirmationPolling({
  getState,
  refresh,
  onTimeout,
  delaysMs = DEFAULT_CONFIRMATION_DELAYS_MS,
  maxDurationMs = 30_000,
}: {
  getState: () => CheckoutConfirmationState;
  refresh: () => void;
  onTimeout: () => void;
  delaysMs?: readonly number[];
  maxDurationMs?: number;
}): () => void {
  let stopped = false;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const startedAt = Date.now();

  const stop = () => {
    stopped = true;
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  const schedule = (delay: number) => {
    const remaining = Math.max(0, maxDurationMs - (Date.now() - startedAt));
    timer = setTimeout(run, Math.min(Math.max(0, delay), remaining));
  };

  const run = () => {
    timer = null;
    if (stopped) return;

    const state = getState();
    if (!needsCheckoutConfirmation(state)) {
      stop();
      return;
    }
    if (Date.now() - startedAt >= maxDurationMs) {
      stop();
      onTimeout();
      return;
    }
    if (state.loading) {
      schedule(250);
      return;
    }
    if (attempt >= delaysMs.length) {
      stop();
      onTimeout();
      return;
    }

    refresh();
    attempt += 1;
    const nextDelay =
      attempt < delaysMs.length ? delaysMs[attempt] : 2_000;
    schedule(nextDelay);
  };

  schedule(delaysMs[0] ?? 0);
  return stop;
}
