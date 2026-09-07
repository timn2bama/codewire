import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getCheckoutReturnNotice,
  getUpgradeBillingView,
  startCheckoutConfirmationPolling,
} from "./billingUi";

afterEach(() => {
  vi.useRealTimers();
});

describe("getUpgradeBillingView", () => {
  const offer = {
    cloudEnabled: true,
    isPro: false,
    status: "free" as const,
    loading: false,
    error: null,
  };

  it("uses truthful eligibility-dependent trial copy", () => {
    expect(getUpgradeBillingView(offer)).toEqual({
      kind: "offer",
      action: "checkout",
      cta: "Continue to secure checkout",
      detail:
        "Eligible first-time subscribers receive a 7-day trial. Stripe shows any amount due before confirmation.",
    });
  });

  it("routes recoverable subscription states to the billing portal", () => {
    expect(
      getUpgradeBillingView({ ...offer, status: "past_due" }),
    ).toMatchObject({
      kind: "recovery",
      action: "portal",
      cta: "Fix billing",
    });
    expect(
      getUpgradeBillingView({ ...offer, status: "active" }),
    ).toMatchObject({ kind: "recovery", action: "portal" });
    expect(
      getUpgradeBillingView({ ...offer, status: "trialing" }),
    ).toMatchObject({ kind: "recovery", action: "portal" });
  });

  it("fails closed while the plan is loading or unavailable", () => {
    expect(
      getUpgradeBillingView({ ...offer, loading: true }),
    ).toMatchObject({ kind: "loading", action: "none" });
    expect(
      getUpgradeBillingView({ ...offer, error: "network unavailable" }),
    ).toMatchObject({
      kind: "error",
      action: "refresh",
      cta: "Check plan again",
    });
    expect(
      getUpgradeBillingView({ ...offer, cloudEnabled: false }),
    ).toMatchObject({ kind: "unavailable", action: "none" });
  });

  it("does not trust stale Pro state while a refresh is pending", () => {
    expect(
      getUpgradeBillingView({ ...offer, isPro: true, loading: true }),
    ).toMatchObject({ kind: "loading", action: "none" });
  });
});

describe("getCheckoutReturnNotice", () => {
  const returned = {
    justUpgraded: true,
    signedIn: true,
    status: "free" as const,
    isPro: false,
    loading: false,
    error: null,
  };

  it("requires verified subscription state before showing success", () => {
    expect(getCheckoutReturnNotice(returned)).toEqual({
      tone: "pending",
      message: "Checkout returned. Waiting for Stripe to confirm your subscription.",
    });
    expect(
      getCheckoutReturnNotice({
        ...returned,
        isPro: true,
        status: "active",
      }),
    ).toEqual({
      tone: "success",
      message: "Welcome to Pro! Your subscription is active.",
    });
    expect(
      getCheckoutReturnNotice({
        ...returned,
        isPro: true,
        status: "trialing",
      }),
    ).toEqual({
      tone: "success",
      message: "Welcome to Pro! Your trial has started.",
    });
  });

  it("reports verification and recovery states without false success", () => {
    expect(
      getCheckoutReturnNotice({ ...returned, loading: true }),
    ).toMatchObject({ tone: "pending" });
    expect(
      getCheckoutReturnNotice({ ...returned, error: "network unavailable" }),
    ).toMatchObject({ tone: "warning" });
    expect(
      getCheckoutReturnNotice({ ...returned, status: "past_due" }),
    ).toMatchObject({ tone: "warning" });
    expect(
      getCheckoutReturnNotice({ ...returned, signedIn: false }),
    ).toMatchObject({ tone: "pending" });
  });

  it.each(["active", "trialing"] as const)(
    "does not report success for %s status without a valid entitlement",
    (status) => {
      const notice = getCheckoutReturnNotice({
        ...returned,
        status,
        isPro: false,
      });

      expect(notice).toMatchObject({ tone: "warning" });
    },
  );

  it("renders no checkout notice without the return marker", () => {
    expect(
      getCheckoutReturnNotice({ ...returned, justUpgraded: false }),
    ).toBeNull();
  });
});

describe("startCheckoutConfirmationPolling", () => {
  it("retries on a bounded schedule and times out without confirmation", async () => {
    vi.useFakeTimers();
    const state = {
      isPro: false,
      status: "free" as const,
      loading: false,
      error: null,
    };
    const refresh = vi.fn();
    const onTimeout = vi.fn();

    startCheckoutConfirmationPolling({
      getState: () => state,
      refresh,
      onTimeout,
      delaysMs: [0, 100, 200],
      maxDurationMs: 500,
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(refresh).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(200);
    expect(refresh).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(200);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it("stops as soon as a verified or recovery state arrives", async () => {
    vi.useFakeTimers();
    const state: {
      isPro: boolean;
      status: "free" | "active" | "past_due";
      loading: boolean;
      error: string | null;
    } = {
      isPro: false,
      status: "free",
      loading: false,
      error: null,
    };
    const refresh = vi.fn();
    const onTimeout = vi.fn();

    startCheckoutConfirmationPolling({
      getState: () => state,
      refresh,
      onTimeout,
      delaysMs: [0, 100, 200],
      maxDurationMs: 500,
    });
    await vi.advanceTimersByTimeAsync(0);
    state.status = "active";
    state.isPro = true;
    await vi.advanceTimersByTimeAsync(500);

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it("waits for an in-flight refresh and cleanup cancels late callbacks", async () => {
    vi.useFakeTimers();
    const state = {
      isPro: false,
      status: "free" as const,
      loading: true,
      error: null,
    };
    const refresh = vi.fn();
    const onTimeout = vi.fn();
    const stop = startCheckoutConfirmationPolling({
      getState: () => state,
      refresh,
      onTimeout,
      delaysMs: [0, 100],
      maxDurationMs: 1_000,
    });

    await vi.advanceTimersByTimeAsync(250);
    expect(refresh).not.toHaveBeenCalled();
    state.loading = false;
    await vi.advanceTimersByTimeAsync(250);
    expect(refresh).toHaveBeenCalledTimes(1);

    stop();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(onTimeout).not.toHaveBeenCalled();
  });
});
