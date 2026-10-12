import { describe, expect, it } from "vitest";
import {
  assertFreeProfile,
  assertProProfile,
  validateStagingEnvironment,
} from "./stagingEnvironment.mjs";

const validEnvironment = {
  STAGING_APP_URL: "https://staging-codewire.example.com",
  STAGING_SUPABASE_URL: "https://stagingproject.supabase.co",
  STAGING_SUPABASE_ANON_KEY: "anon",
  STAGING_SUPABASE_SERVICE_ROLE_KEY: "service-role",
  STAGING_TEST_PRO_EMAIL: "pro@example.com",
  STAGING_TEST_PRO_PASSWORD: "pro-password",
  STAGING_TEST_FREE_EMAIL: "free@example.com",
  STAGING_TEST_FREE_PASSWORD: "free-password",
  STAGING_STRIPE_SECRET_KEY: "sk_test_example",
  STAGING_STRIPE_WEBHOOK_SECRET: "whsec_example",
  STAGING_STRIPE_PRICE_MONTHLY: "price_monthly",
  STAGING_STRIPE_PRICE_YEARLY: "price_yearly",
};

describe("staging environment safety", () => {
  it("accepts isolated staging and Stripe test-mode configuration", () => {
    expect(validateStagingEnvironment(validEnvironment)).toEqual({
      appUrl: "https://staging-codewire.example.com",
      supabaseUrl: "https://stagingproject.supabase.co",
      stripeConfigured: true,
    });
  });

  // Stripe values are optional because this smoke test never calls Stripe; the
  // backend checks it does perform must not be blocked by credentials it does not
  // use. Omitting them is reported, not silently treated as verified.
  it("runs without Stripe configuration and says so", () => {
    const {
      STAGING_STRIPE_SECRET_KEY: _sk,
      STAGING_STRIPE_WEBHOOK_SECRET: _wh,
      STAGING_STRIPE_PRICE_MONTHLY: _pm,
      STAGING_STRIPE_PRICE_YEARLY: _py,
      ...withoutStripe
    } = validEnvironment;
    expect(validateStagingEnvironment(withoutStripe)).toEqual({
      appUrl: "https://staging-codewire.example.com",
      supabaseUrl: "https://stagingproject.supabase.co",
      stripeConfigured: false,
    });
  });

  it("rejects a half-configured Stripe set rather than half-checking it", () => {
    expect(() =>
      validateStagingEnvironment({
        ...validEnvironment,
        STAGING_STRIPE_PRICE_YEARLY: "",
      }),
    ).toThrow(/Incomplete Stripe test-mode configuration/);
  });

  it.each([
    ["STAGING_APP_URL", "https://codewire.tools"],
    [
      "STAGING_SUPABASE_URL",
      "https://lwqrkxslfputbnioatvn.supabase.co",
    ],
    ["STAGING_STRIPE_SECRET_KEY", "sk_live_never"],
  ])("rejects unsafe %s", (name, value) => {
    expect(() =>
      validateStagingEnvironment({ ...validEnvironment, [name]: value }),
    ).toThrow();
  });

  it("requires separate Pro and free accounts", () => {
    expect(() =>
      validateStagingEnvironment({
        ...validEnvironment,
        STAGING_TEST_FREE_EMAIL: validEnvironment.STAGING_TEST_PRO_EMAIL,
      }),
    ).toThrow(/different users/);
  });
});

describe("staging account contracts", () => {
  it("accepts only a current recognized Pro entitlement", () => {
    expect(() =>
      assertProProfile({
        status: "active",
        plan: "monthly",
        current_period_end: "2099-01-01T00:00:00.000Z",
      }),
    ).not.toThrow();
    expect(() =>
      assertProProfile({
        status: "active",
        plan: "monthly",
        current_period_end: "2020-01-01T00:00:00.000Z",
      }),
    ).toThrow(/expired/);
  });

  it("requires the free account to remain unentitled", () => {
    expect(() => assertFreeProfile({ status: "free", plan: null })).not.toThrow();
    expect(() =>
      assertFreeProfile({ status: "trialing", plan: "monthly" }),
    ).toThrow(/unexpectedly/);
  });
});
