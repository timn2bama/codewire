import { describe, expect, it } from "vitest";
import {
  hasValidEntitlement,
  needsBillingRecovery,
  type SubStatus,
} from "./subscription";

const NOW = Date.parse("2026-08-09T12:00:00.000Z");
const FUTURE_PERIOD_END = new Date(NOW + 60_000).toISOString();

describe("hasValidEntitlement", () => {
  it.each([
    ["active", "monthly"],
    ["active", "yearly"],
    ["trialing", "monthly"],
    ["trialing", "yearly"],
  ] as const)(
    "accepts a future %s entitlement on the %s plan",
    (status, plan) => {
      expect(
        hasValidEntitlement(status, plan, FUTURE_PERIOD_END, NOW),
      ).toBe(true);
    },
  );

  it.each([null, "", "legacy", "MONTHLY"])(
    "rejects an unknown plan (%s)",
    (plan) => {
      expect(
        hasValidEntitlement("active", plan, FUTURE_PERIOD_END, NOW),
      ).toBe(false);
    },
  );

  it.each([
    ["missing", null],
    ["empty", ""],
    ["malformed", "not-a-date"],
    ["invalid calendar date", "2026-13-40T12:00:00.000Z"],
    ["expired", new Date(NOW - 1).toISOString()],
    ["equal to now", new Date(NOW).toISOString()],
  ] as const)("rejects the period end when it is %s", (_case, periodEnd) => {
    expect(hasValidEntitlement("active", "monthly", periodEnd, NOW)).toBe(
      false,
    );
  });

  it.each([
    "free",
    "canceled",
    "past_due",
  ] satisfies readonly SubStatus[])(
    "rejects the non-Pro %s status",
    (status) => {
      expect(
        hasValidEntitlement(status, "yearly", FUTURE_PERIOD_END, NOW),
      ).toBe(false);
    },
  );
});

describe("needsBillingRecovery", () => {
  it("routes only past-due accounts to billing recovery", () => {
    expect(needsBillingRecovery("past_due")).toBe(true);
    expect(needsBillingRecovery("free")).toBe(false);
    expect(needsBillingRecovery("canceled")).toBe(false);
    expect(needsBillingRecovery("active")).toBe(false);
    expect(needsBillingRecovery("trialing")).toBe(false);
  });
});
