import type { SupabaseClient } from "@supabase/supabase-js";
import type { BillingPlan } from "./shared.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type JsonRecord = Record<string, unknown>;

export type CheckoutReservationSnapshot = Readonly<{
  reservationId: string;
  idempotencyKey: string;
  profileId: string;
  requestVersion: 1;
  plan: BillingPlan;
  customerId: string;
  priceId: string;
  origin: string;
  trialPeriodDays: 7 | null;
  requestedExpiresAt: number;
  leaseToken: string;
  leaseExpiresAt: number;
}>;

export type CheckoutReservationBlockReason =
  | "subscription_active"
  | "customer_mismatch"
  | "checkout_plan_locked"
  | "checkout_recovery_required"
  | "missing_profile";

export type CheckoutReservationClaim =
  | Readonly<{
      outcome: "create";
      snapshot: CheckoutReservationSnapshot;
    }>
  | Readonly<{
      outcome: "reuse";
      plan: BillingPlan;
      url: string;
      expiresAt: number;
    }>
  | Readonly<{
      outcome: "wait";
      plan: BillingPlan;
      expiresAt: number;
    }>
  | Readonly<{
      outcome: "reconcile";
      reservationId: string;
      leaseToken: string;
      plan: BillingPlan;
      customerId: string;
      stripeSessionId: string;
      sessionExpiresAt: number;
      leaseExpiresAt: number;
    }>
  | Readonly<{
      outcome: "blocked";
      reason: CheckoutReservationBlockReason;
      activePlan?: BillingPlan;
      expiresAt?: number;
    }>;

export type CheckoutReservationPublishResult =
  | Readonly<{
      outcome: "stored" | "already_stored";
      url: string;
      expiresAt: number;
    }>
  | Readonly<{ outcome: "stale" }>;

export type CheckoutReservationYieldResult = Readonly<{
  outcome: "yielded" | "stale";
}>;

export type CheckoutReservationRetireResult = Readonly<{
  outcome: "retired" | "stale";
}>;

export type ClaimStripeCheckoutReservationInput = Readonly<{
  profileId: string;
  customerId: string;
  plan: BillingPlan;
  priceId: string;
  origin: string;
  trialPeriodDays: 7 | null;
  requestedExpiresAt: string;
  reservationId: string;
  leaseToken: string;
}>;

export type PublishStripeCheckoutReservationInput = Readonly<{
  profileId: string;
  reservationId: string;
  leaseToken: string;
  stripeSessionId: string;
  checkoutUrl: string;
  stripeExpiresAt: string;
}>;

export type YieldStripeCheckoutReservationLeaseInput = Readonly<{
  profileId: string;
  reservationId: string;
  leaseToken: string;
}>;

export type RetireStripeCheckoutReservationInput = Readonly<{
  profileId: string;
  reservationId: string;
  leaseToken: string;
  stripeSessionId: string;
}>;

export class CheckoutReservationContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CheckoutReservationContractError";
  }
}

function malformed(context: string): never {
  throw new CheckoutReservationContractError(
    `Malformed checkout reservation ${context}`,
  );
}

function asRecord(value: unknown, context: string): JsonRecord {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return malformed(context);
  }
  return value as JsonRecord;
}

function assertOnlyKeys(
  value: JsonRecord,
  allowedKeys: readonly string[],
  context: string,
): void {
  const allowed = new Set(allowedKeys);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    malformed(`${context} fields`);
  }
}

function asNonEmptyString(value: unknown, context: string): string {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
    return malformed(context);
  }
  return value;
}

function asUuid(value: unknown, context: string): string {
  const uuid = asNonEmptyString(value, context);
  if (!UUID_PATTERN.test(uuid)) return malformed(context);
  return uuid;
}

function asPlan(value: unknown, context: string): BillingPlan {
  if (value !== "monthly" && value !== "yearly") return malformed(context);
  return value;
}

function asEpochSeconds(value: unknown, context: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    return malformed(context);
  }
  return value as number;
}

function asTrialPeriodDays(value: unknown, context: string): 7 | null {
  if (value === 7) return 7;
  if (value === null) return null;
  return malformed(context);
}

function asOrigin(value: unknown, context: string): string {
  const origin = asNonEmptyString(value, context);
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return malformed(context);
  }

  const isLocalHttp =
    parsed.protocol === "http:" &&
    (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1");
  if (
    (parsed.protocol !== "https:" && !isLocalHttp) ||
    parsed.origin !== origin ||
    parsed.username ||
    parsed.password
  ) {
    return malformed(context);
  }
  return origin;
}

function asCheckoutUrl(value: unknown, context: string): string {
  const url = asNonEmptyString(value, context);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return malformed(context);
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    return malformed(context);
  }
  return url;
}

function asOptionalPlan(
  value: unknown,
  context: string,
): BillingPlan | undefined {
  if (value === undefined || value === null) return undefined;
  return asPlan(value, context);
}

function asOptionalEpochSeconds(
  value: unknown,
  context: string,
): number | undefined {
  if (value === undefined || value === null) return undefined;
  return asEpochSeconds(value, context);
}

function asIsoTimestamp(value: unknown, context: string): string {
  if (typeof value !== "string") return malformed(context);
  const milliseconds = Date.parse(value);
  if (
    Number.isNaN(milliseconds) ||
    new Date(milliseconds).toISOString() !== value
  ) {
    return malformed(context);
  }
  return value;
}

function asBlockReason(
  value: unknown,
  context: string,
): CheckoutReservationBlockReason {
  if (
    value !== "subscription_active" &&
    value !== "customer_mismatch" &&
    value !== "checkout_plan_locked" &&
    value !== "checkout_recovery_required" &&
    value !== "missing_profile"
  ) {
    return malformed(context);
  }
  return value;
}

function parseSnapshot(value: unknown): CheckoutReservationSnapshot {
  const snapshot = asRecord(value, "claim snapshot");
  assertOnlyKeys(
    snapshot,
    [
      "reservation_id",
      "profile_id",
      "request_version",
      "plan",
      "customer_id",
      "price_id",
      "origin",
      "trial_period_days",
      "requested_expires_at",
      "lease_token",
      "lease_expires_at",
    ],
    "claim snapshot",
  );
  const requestVersion = snapshot.request_version;
  if (requestVersion !== 1) return malformed("claim snapshot request_version");
  const reservationId = asUuid(
    snapshot.reservation_id,
    "claim snapshot reservation_id",
  );

  const requestedExpiresAt = asEpochSeconds(
    snapshot.requested_expires_at,
    "claim snapshot requested_expires_at",
  );
  const leaseExpiresAt = asEpochSeconds(
    snapshot.lease_expires_at,
    "claim snapshot lease_expires_at",
  );
  if (leaseExpiresAt > requestedExpiresAt) {
    return malformed("claim snapshot expiry ordering");
  }

  return {
    reservationId,
    idempotencyKey: idempotencyKeyFor(reservationId),
    profileId: asUuid(snapshot.profile_id, "claim snapshot profile_id"),
    requestVersion,
    plan: asPlan(snapshot.plan, "claim snapshot plan"),
    customerId: asNonEmptyString(
      snapshot.customer_id,
      "claim snapshot customer_id",
    ),
    priceId: asNonEmptyString(snapshot.price_id, "claim snapshot price_id"),
    origin: asOrigin(snapshot.origin, "claim snapshot origin"),
    trialPeriodDays: asTrialPeriodDays(
      snapshot.trial_period_days,
      "claim snapshot trial_period_days",
    ),
    requestedExpiresAt,
    leaseToken: asUuid(snapshot.lease_token, "claim snapshot lease_token"),
    leaseExpiresAt,
  };
}

function idempotencyKeyFor(reservationId: string): string {
  return `codewire-checkout:${reservationId}`;
}

function parseClaim(value: unknown): CheckoutReservationClaim {
  const result = asRecord(value, "claim result");
  switch (result.outcome) {
    case "create": {
      assertOnlyKeys(result, ["outcome", "snapshot"], "claim create");
      const snapshot = parseSnapshot(result.snapshot);
      return {
        outcome: "create",
        snapshot,
      };
    }
    case "reuse":
      assertOnlyKeys(
        result,
        ["outcome", "plan", "url", "expires_at"],
        "claim reuse",
      );
      return {
        outcome: "reuse",
        plan: asPlan(result.plan, "claim reuse plan"),
        url: asCheckoutUrl(result.url, "claim reuse url"),
        expiresAt: asEpochSeconds(
          result.expires_at,
          "claim reuse expires_at",
        ),
      };
    case "wait":
      assertOnlyKeys(
        result,
        ["outcome", "plan", "expires_at"],
        "claim wait",
      );
      return {
        outcome: "wait",
        plan: asPlan(result.plan, "claim wait plan"),
        expiresAt: asEpochSeconds(
          result.expires_at,
          "claim wait expires_at",
        ),
      };
    case "reconcile": {
      assertOnlyKeys(
        result,
        [
          "outcome",
          "reservation_id",
          "lease_token",
          "plan",
          "customer_id",
          "session_id",
          "session_expires_at",
          "lease_expires_at",
        ],
        "claim reconcile",
      );
      const sessionExpiresAt = asEpochSeconds(
        result.session_expires_at,
        "claim reconcile session_expires_at",
      );
      const leaseExpiresAt = asEpochSeconds(
        result.lease_expires_at,
        "claim reconcile lease_expires_at",
      );
      if (leaseExpiresAt <= sessionExpiresAt) {
        return malformed("claim reconcile expiry ordering");
      }
      return {
        outcome: "reconcile",
        reservationId: asUuid(
          result.reservation_id,
          "claim reconcile reservation_id",
        ),
        leaseToken: asUuid(
          result.lease_token,
          "claim reconcile lease_token",
        ),
        plan: asPlan(result.plan, "claim reconcile plan"),
        customerId: asNonEmptyString(
          result.customer_id,
          "claim reconcile customer_id",
        ),
        stripeSessionId: asNonEmptyString(
          result.session_id,
          "claim reconcile session_id",
        ),
        sessionExpiresAt,
        leaseExpiresAt,
      };
    }
    case "blocked": {
      assertOnlyKeys(
        result,
        ["outcome", "reason", "active_plan", "expires_at"],
        "claim blocked",
      );
      const activePlan = asOptionalPlan(
        result.active_plan,
        "claim blocked active_plan",
      );
      const expiresAt = asOptionalEpochSeconds(
        result.expires_at,
        "claim blocked expires_at",
      );
      return {
        outcome: "blocked",
        reason: asBlockReason(result.reason, "claim blocked reason"),
        ...(activePlan === undefined ? {} : { activePlan }),
        ...(expiresAt === undefined ? {} : { expiresAt }),
      };
    }
    default:
      return malformed("claim outcome");
  }
}

function parsePublishResult(value: unknown): CheckoutReservationPublishResult {
  const result = asRecord(value, "publish result");
  if (result.outcome === "stale") {
    assertOnlyKeys(result, ["outcome"], "publish stale");
    return { outcome: "stale" };
  }
  if (result.outcome !== "stored" && result.outcome !== "already_stored") {
    return malformed("publish outcome");
  }
  assertOnlyKeys(
    result,
    ["outcome", "url", "expires_at"],
    "publish stored",
  );
  return {
    outcome: result.outcome,
    url: asCheckoutUrl(result.url, "publish url"),
    expiresAt: asEpochSeconds(result.expires_at, "publish expires_at"),
  };
}

function parseYieldResult(value: unknown): CheckoutReservationYieldResult {
  const result = asRecord(value, "yield result");
  if (result.outcome !== "yielded" && result.outcome !== "stale") {
    return malformed("yield outcome");
  }
  assertOnlyKeys(result, ["outcome"], "yield");
  return { outcome: result.outcome };
}

function parseRetireResult(value: unknown): CheckoutReservationRetireResult {
  const result = asRecord(value, "retire result");
  if (result.outcome !== "retired" && result.outcome !== "stale") {
    return malformed("retire outcome");
  }
  assertOnlyKeys(result, ["outcome"], "retire");
  return { outcome: result.outcome };
}

async function callRpc(
  admin: SupabaseClient,
  functionName: string,
  parameters: Record<string, unknown>,
): Promise<unknown> {
  const { data, error } = await admin.rpc(functionName, parameters);
  if (error) throw error;
  return data;
}

export async function claimStripeCheckoutReservation(
  admin: SupabaseClient,
  input: ClaimStripeCheckoutReservationInput,
): Promise<CheckoutReservationClaim> {
  const profileId = asUuid(input.profileId, "claim input profileId");
  const customerId = asNonEmptyString(
    input.customerId,
    "claim input customerId",
  );
  const plan = asPlan(input.plan, "claim input plan");
  const priceId = asNonEmptyString(input.priceId, "claim input priceId");
  const origin = asOrigin(input.origin, "claim input origin");
  const trialPeriodDays = asTrialPeriodDays(
    input.trialPeriodDays,
    "claim input trialPeriodDays",
  );
  const requestedExpiresAt = asIsoTimestamp(
    input.requestedExpiresAt,
    "claim input requestedExpiresAt",
  );
  const reservationId = asUuid(
    input.reservationId,
    "claim input reservationId",
  );
  const leaseToken = asUuid(input.leaseToken, "claim input leaseToken");

  const data = await callRpc(admin, "claim_stripe_checkout_reservation", {
    p_profile_id: profileId,
    p_customer_id: customerId,
    p_plan: plan,
    p_price_id: priceId,
    p_origin: origin,
    p_trial_period_days: trialPeriodDays,
    p_requested_expires_at: requestedExpiresAt,
    p_reservation_id: reservationId,
    p_lease_token: leaseToken,
  });
  const claim = parseClaim(data);

  if (claim.outcome === "create") {
    if (
      claim.snapshot.profileId !== profileId ||
      claim.snapshot.customerId !== customerId ||
      claim.snapshot.plan !== plan ||
      claim.snapshot.leaseToken !== leaseToken
    ) {
      return malformed("claim snapshot ownership");
    }
  }
  if (
    claim.outcome === "reconcile" &&
    (claim.customerId !== customerId ||
      claim.leaseToken !== leaseToken)
  ) {
    return malformed("claim reconciliation ownership");
  }

  return claim;
}

export async function publishStripeCheckoutReservation(
  admin: SupabaseClient,
  input: PublishStripeCheckoutReservationInput,
): Promise<CheckoutReservationPublishResult> {
  const checkoutUrl = asCheckoutUrl(
    input.checkoutUrl,
    "publish input checkoutUrl",
  );
  const stripeExpiresAt = asIsoTimestamp(
    input.stripeExpiresAt,
    "publish input stripeExpiresAt",
  );
  const data = await callRpc(admin, "publish_stripe_checkout_reservation", {
    p_profile_id: asUuid(input.profileId, "publish input profileId"),
    p_reservation_id: asUuid(
      input.reservationId,
      "publish input reservationId",
    ),
    p_lease_token: asUuid(input.leaseToken, "publish input leaseToken"),
    p_stripe_session_id: asNonEmptyString(
      input.stripeSessionId,
      "publish input stripeSessionId",
    ),
    p_checkout_url: checkoutUrl,
    p_stripe_expires_at: stripeExpiresAt,
  });
  const result = parsePublishResult(data);
  const expectedExpiresAt = Date.parse(stripeExpiresAt) / 1000;
  if (
    result.outcome !== "stale" &&
    (result.url !== checkoutUrl || result.expiresAt !== expectedExpiresAt)
  ) {
    return malformed("publish identity");
  }
  return result;
}

export async function yieldStripeCheckoutReservationLease(
  admin: SupabaseClient,
  input: YieldStripeCheckoutReservationLeaseInput,
): Promise<CheckoutReservationYieldResult> {
  const data = await callRpc(
    admin,
    "yield_stripe_checkout_reservation_lease",
    {
      p_profile_id: asUuid(input.profileId, "yield input profileId"),
      p_reservation_id: asUuid(
        input.reservationId,
        "yield input reservationId",
      ),
      p_lease_token: asUuid(input.leaseToken, "yield input leaseToken"),
    },
  );
  return parseYieldResult(data);
}

export async function retireStripeCheckoutReservation(
  admin: SupabaseClient,
  input: RetireStripeCheckoutReservationInput,
): Promise<CheckoutReservationRetireResult> {
  const data = await callRpc(admin, "retire_stripe_checkout_reservation", {
    p_profile_id: asUuid(input.profileId, "retire input profileId"),
    p_reservation_id: asUuid(
      input.reservationId,
      "retire input reservationId",
    ),
    p_lease_token: asUuid(input.leaseToken, "retire input leaseToken"),
    p_stripe_session_id: asNonEmptyString(
      input.stripeSessionId,
      "retire input stripeSessionId",
    ),
  });
  return parseRetireResult(data);
}
