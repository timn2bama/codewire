import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import {
  CheckoutReservationContractError,
  claimStripeCheckoutReservation,
  publishStripeCheckoutReservation,
  retireStripeCheckoutReservation,
  yieldStripeCheckoutReservationLease,
  type ClaimStripeCheckoutReservationInput,
} from "./checkoutReservation";

const PROFILE_ID = "00000000-0000-4000-8000-000000000001";
const RESERVATION_ID = "00000000-0000-4000-8000-000000000002";
const LEASE_TOKEN = "00000000-0000-4000-8000-000000000003";
const REQUESTED_EXPIRES_AT = 1_800_000_000;
const LEASE_EXPIRES_AT = REQUESTED_EXPIRES_AT - 3_000;

const claimInput: ClaimStripeCheckoutReservationInput = {
  profileId: PROFILE_ID,
  customerId: "cus_codewire",
  plan: "monthly",
  priceId: "price_monthly",
  origin: "https://codewire.tools",
  trialPeriodDays: 7,
  requestedExpiresAt: new Date(REQUESTED_EXPIRES_AT * 1000).toISOString(),
  reservationId: RESERVATION_ID,
  leaseToken: LEASE_TOKEN,
};

const snapshot = {
  reservation_id: RESERVATION_ID,
  profile_id: PROFILE_ID,
  request_version: 1,
  plan: "monthly",
  customer_id: "cus_codewire",
  price_id: "price_monthly",
  origin: "https://codewire.tools",
  trial_period_days: 7,
  requested_expires_at: REQUESTED_EXPIRES_AT,
  lease_token: LEASE_TOKEN,
  lease_expires_at: LEASE_EXPIRES_AT,
};

function adminReturning(data: unknown, error: unknown = null) {
  const rpc = vi.fn().mockResolvedValue({ data, error });
  return {
    admin: { rpc } as unknown as SupabaseClient,
    rpc,
  };
}

describe("checkout reservation RPC gateway", () => {
  it("claims a create lease, converts timestamps to ISO, and derives one stable key", async () => {
    const { admin, rpc } = adminReturning({ outcome: "create", snapshot });

    const result = await claimStripeCheckoutReservation(admin, claimInput);

    expect(result).toEqual({
      outcome: "create",
      snapshot: {
        reservationId: RESERVATION_ID,
        idempotencyKey: `codewire-checkout:${RESERVATION_ID}`,
        profileId: PROFILE_ID,
        requestVersion: 1,
        plan: "monthly",
        customerId: "cus_codewire",
        priceId: "price_monthly",
        origin: "https://codewire.tools",
        trialPeriodDays: 7,
        requestedExpiresAt: REQUESTED_EXPIRES_AT,
        leaseToken: LEASE_TOKEN,
        leaseExpiresAt: LEASE_EXPIRES_AT,
      },
    });
    expect(rpc).toHaveBeenCalledWith("claim_stripe_checkout_reservation", {
      p_profile_id: PROFILE_ID,
      p_customer_id: "cus_codewire",
      p_plan: "monthly",
      p_price_id: "price_monthly",
      p_origin: "https://codewire.tools",
      p_trial_period_days: 7,
      p_requested_expires_at: new Date(
        REQUESTED_EXPIRES_AT * 1000,
      ).toISOString(),
      p_reservation_id: RESERVATION_ID,
      p_lease_token: LEASE_TOKEN,
    });
  });

  it("parses reuse, wait, and blocked outcomes without inventing optional fields", async () => {
    const reuse = adminReturning({
      outcome: "reuse",
      plan: "monthly",
      url: "https://checkout.stripe.com/c/pay/reused",
      expires_at: REQUESTED_EXPIRES_AT,
    });
    const wait = adminReturning({
      outcome: "wait",
      plan: "monthly",
      expires_at: LEASE_EXPIRES_AT,
    });
    const blocked = adminReturning({
      outcome: "blocked",
      reason: "checkout_plan_locked",
      active_plan: "yearly",
      expires_at: REQUESTED_EXPIRES_AT,
    });
    const missing = adminReturning({
      outcome: "blocked",
      reason: "missing_profile",
      active_plan: null,
      expires_at: null,
    });
    const recoveryRequired = adminReturning({
      outcome: "blocked",
      reason: "checkout_recovery_required",
      active_plan: "monthly",
      expires_at: REQUESTED_EXPIRES_AT,
    });

    await expect(
      claimStripeCheckoutReservation(reuse.admin, claimInput),
    ).resolves.toEqual({
      outcome: "reuse",
      plan: "monthly",
      url: "https://checkout.stripe.com/c/pay/reused",
      expiresAt: REQUESTED_EXPIRES_AT,
    });
    await expect(
      claimStripeCheckoutReservation(wait.admin, claimInput),
    ).resolves.toEqual({
      outcome: "wait",
      plan: "monthly",
      expiresAt: LEASE_EXPIRES_AT,
    });
    await expect(
      claimStripeCheckoutReservation(blocked.admin, claimInput),
    ).resolves.toEqual({
      outcome: "blocked",
      reason: "checkout_plan_locked",
      activePlan: "yearly",
      expiresAt: REQUESTED_EXPIRES_AT,
    });
    await expect(
      claimStripeCheckoutReservation(missing.admin, claimInput),
    ).resolves.toEqual({
      outcome: "blocked",
      reason: "missing_profile",
    });
    await expect(
      claimStripeCheckoutReservation(recoveryRequired.admin, claimInput),
    ).resolves.toEqual({
      outcome: "blocked",
      reason: "checkout_recovery_required",
      activePlan: "monthly",
      expiresAt: REQUESTED_EXPIRES_AT,
    });
  });

  it("parses a fenced old-plan reconciliation before a safe plan switch", async () => {
    const { admin } = adminReturning({
      outcome: "reconcile",
      reservation_id: RESERVATION_ID,
      lease_token: LEASE_TOKEN,
      plan: "yearly",
      customer_id: "cus_codewire",
      session_id: "cs_test_existing",
      session_expires_at: REQUESTED_EXPIRES_AT,
      lease_expires_at: REQUESTED_EXPIRES_AT + 120,
    });

    await expect(
      claimStripeCheckoutReservation(admin, claimInput),
    ).resolves.toEqual({
      outcome: "reconcile",
      reservationId: RESERVATION_ID,
      leaseToken: LEASE_TOKEN,
      plan: "yearly",
      customerId: "cus_codewire",
      stripeSessionId: "cs_test_existing",
      sessionExpiresAt: REQUESTED_EXPIRES_AT,
      leaseExpiresAt: REQUESTED_EXPIRES_AT + 120,
    });
  });

  it("rejects malformed JSON and snapshot ownership mismatches", async () => {
    const unknownOutcome = adminReturning({ outcome: "surprise" });
    const invalidTrial = adminReturning({
      outcome: "create",
      snapshot: { ...snapshot, trial_period_days: 14 },
    });
    const wrongProfile = adminReturning({
      outcome: "create",
      snapshot: {
        ...snapshot,
        profile_id: "00000000-0000-4000-8000-000000000099",
      },
    });
    const unknownField = adminReturning({
      outcome: "wait",
      plan: "monthly",
      expires_at: LEASE_EXPIRES_AT,
      untrusted: true,
    });
    const mismatchedReconciliation = adminReturning({
      outcome: "reconcile",
      reservation_id: RESERVATION_ID,
      lease_token: LEASE_TOKEN,
      plan: "monthly",
      customer_id: "cus_wrong",
      session_id: "cs_test_existing",
      session_expires_at: REQUESTED_EXPIRES_AT,
      lease_expires_at: REQUESTED_EXPIRES_AT + 120,
    });
    const invalidReconciliationExpiry = adminReturning({
      outcome: "reconcile",
      reservation_id: RESERVATION_ID,
      lease_token: LEASE_TOKEN,
      plan: "monthly",
      customer_id: "cus_codewire",
      session_id: "cs_test_existing",
      session_expires_at: REQUESTED_EXPIRES_AT,
      lease_expires_at: REQUESTED_EXPIRES_AT,
    });

    await expect(
      claimStripeCheckoutReservation(unknownOutcome.admin, claimInput),
    ).rejects.toBeInstanceOf(CheckoutReservationContractError);
    await expect(
      claimStripeCheckoutReservation(invalidTrial.admin, claimInput),
    ).rejects.toThrow("Malformed checkout reservation claim snapshot");
    await expect(
      claimStripeCheckoutReservation(wrongProfile.admin, claimInput),
    ).rejects.toThrow("Malformed checkout reservation claim snapshot ownership");
    await expect(
      claimStripeCheckoutReservation(unknownField.admin, claimInput),
    ).rejects.toThrow("Malformed checkout reservation claim wait fields");
    await expect(
      claimStripeCheckoutReservation(
        mismatchedReconciliation.admin,
        claimInput,
      ),
    ).rejects.toThrow(
      "Malformed checkout reservation claim reconciliation ownership",
    );
    await expect(
      claimStripeCheckoutReservation(
        invalidReconciliationExpiry.admin,
        claimInput,
      ),
    ).rejects.toThrow(
      "Malformed checkout reservation claim reconcile expiry ordering",
    );
  });

  it("validates input before calling the privileged RPC", async () => {
    const { admin, rpc } = adminReturning({ outcome: "create", snapshot });

    await expect(
      claimStripeCheckoutReservation(admin, {
        ...claimInput,
        origin: "javascript:alert(1)",
      }),
    ).rejects.toBeInstanceOf(CheckoutReservationContractError);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("propagates Supabase RPC errors", async () => {
    const databaseError = new Error("database unavailable");
    const { admin } = adminReturning(null, databaseError);

    await expect(
      claimStripeCheckoutReservation(admin, claimInput),
    ).rejects.toBe(databaseError);
  });

  it("publishes a Stripe session and returns the database-stored result", async () => {
    const { admin, rpc } = adminReturning({
      outcome: "already_stored",
      url: "https://checkout.stripe.com/c/pay/new",
      expires_at: REQUESTED_EXPIRES_AT,
    });

    await expect(
      publishStripeCheckoutReservation(admin, {
        profileId: PROFILE_ID,
        reservationId: RESERVATION_ID,
        leaseToken: LEASE_TOKEN,
        stripeSessionId: "cs_test_new",
        checkoutUrl: "https://checkout.stripe.com/c/pay/new",
        stripeExpiresAt: new Date(
          REQUESTED_EXPIRES_AT * 1000,
        ).toISOString(),
      }),
    ).resolves.toEqual({
      outcome: "already_stored",
      url: "https://checkout.stripe.com/c/pay/new",
      expiresAt: REQUESTED_EXPIRES_AT,
    });
    expect(rpc).toHaveBeenCalledWith("publish_stripe_checkout_reservation", {
      p_profile_id: PROFILE_ID,
      p_reservation_id: RESERVATION_ID,
      p_lease_token: LEASE_TOKEN,
      p_stripe_session_id: "cs_test_new",
      p_checkout_url: "https://checkout.stripe.com/c/pay/new",
      p_stripe_expires_at: new Date(
        REQUESTED_EXPIRES_AT * 1000,
      ).toISOString(),
    });
  });

  it("parses stale publication and rejects incomplete stored results", async () => {
    const stale = adminReturning({ outcome: "stale" });
    const malformed = adminReturning({ outcome: "stored", url: null });
    const missingExpiry = adminReturning({
      outcome: "stored",
      url: "https://checkout.stripe.com/c/pay/new",
    });
    const mismatchedUrl = adminReturning({
      outcome: "already_stored",
      url: "https://checkout.stripe.com/c/pay/different",
      expires_at: REQUESTED_EXPIRES_AT,
    });
    const mismatchedExpiry = adminReturning({
      outcome: "stored",
      url: "https://checkout.stripe.com/c/pay/new",
      expires_at: REQUESTED_EXPIRES_AT - 1,
    });
    const input = {
      profileId: PROFILE_ID,
      reservationId: RESERVATION_ID,
      leaseToken: LEASE_TOKEN,
      stripeSessionId: "cs_test_new",
      checkoutUrl: "https://checkout.stripe.com/c/pay/new",
      stripeExpiresAt: new Date(REQUESTED_EXPIRES_AT * 1000).toISOString(),
    } as const;

    await expect(
      publishStripeCheckoutReservation(stale.admin, input),
    ).resolves.toEqual({ outcome: "stale" });
    await expect(
      publishStripeCheckoutReservation(malformed.admin, input),
    ).rejects.toBeInstanceOf(CheckoutReservationContractError);
    await expect(
      publishStripeCheckoutReservation(missingExpiry.admin, input),
    ).rejects.toBeInstanceOf(CheckoutReservationContractError);
    await expect(
      publishStripeCheckoutReservation(mismatchedUrl.admin, input),
    ).rejects.toThrow("Malformed checkout reservation publish identity");
    await expect(
      publishStripeCheckoutReservation(mismatchedExpiry.admin, input),
    ).rejects.toThrow("Malformed checkout reservation publish identity");
  });

  it("yields only the currently fenced lease", async () => {
    const { admin, rpc } = adminReturning({ outcome: "yielded" });

    await expect(
      yieldStripeCheckoutReservationLease(admin, {
        profileId: PROFILE_ID,
        reservationId: RESERVATION_ID,
        leaseToken: LEASE_TOKEN,
      }),
    ).resolves.toEqual({ outcome: "yielded" });
    expect(rpc).toHaveBeenCalledWith(
      "yield_stripe_checkout_reservation_lease",
      {
        p_profile_id: PROFILE_ID,
        p_reservation_id: RESERVATION_ID,
        p_lease_token: LEASE_TOKEN,
      },
    );
  });

  it("retires only the reconciled Stripe Session behind the current lease", async () => {
    const retired = adminReturning({ outcome: "retired" });
    const stale = adminReturning({ outcome: "stale" });
    const malformed = adminReturning({ outcome: "deleted" });
    const input = {
      profileId: PROFILE_ID,
      reservationId: RESERVATION_ID,
      leaseToken: LEASE_TOKEN,
      stripeSessionId: "cs_test_existing",
    } as const;

    await expect(
      retireStripeCheckoutReservation(retired.admin, input),
    ).resolves.toEqual({ outcome: "retired" });
    expect(retired.rpc).toHaveBeenCalledWith(
      "retire_stripe_checkout_reservation",
      {
        p_profile_id: PROFILE_ID,
        p_reservation_id: RESERVATION_ID,
        p_lease_token: LEASE_TOKEN,
        p_stripe_session_id: "cs_test_existing",
      },
    );
    await expect(
      retireStripeCheckoutReservation(stale.admin, input),
    ).resolves.toEqual({ outcome: "stale" });
    await expect(
      retireStripeCheckoutReservation(malformed.admin, input),
    ).rejects.toBeInstanceOf(CheckoutReservationContractError);
  });
});
