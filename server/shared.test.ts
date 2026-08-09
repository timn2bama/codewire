import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appOrigin,
  billingPricesConfigured,
  planFromPrice,
  priceIdFor,
} from "./shared";

const ENV_KEYS = [
  "APP_ORIGIN",
  "VERCEL_ENV",
  "STRIPE_PRICE_MONTHLY",
  "STRIPE_PRICE_YEARLY",
  "STRIPE_PRICE_MONTHLY_LEGACY",
  "STRIPE_PRICE_YEARLY_LEGACY",
] as const;

let originalEnvironment: Partial<Record<(typeof ENV_KEYS)[number], string>>;

beforeEach(() => {
  originalEnvironment = {};
  for (const key of ENV_KEYS) {
    originalEnvironment[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const original = originalEnvironment[key];
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
});

describe("Stripe billing configuration", () => {
  it("trims current prices and uses them for new checkout", () => {
    process.env.STRIPE_PRICE_MONTHLY = "  price_monthly  ";
    process.env.STRIPE_PRICE_YEARLY = "price_yearly";

    expect(billingPricesConfigured()).toBe(true);
    expect(priceIdFor("monthly")).toBe("price_monthly");
    expect(priceIdFor("yearly")).toBe("price_yearly");
    expect(priceIdFor("weekly")).toBeUndefined();
  });

  it("continues recognizing comma-separated legacy prices", () => {
    process.env.STRIPE_PRICE_MONTHLY = "price_monthly_v2";
    process.env.STRIPE_PRICE_YEARLY = "price_yearly_v2";
    process.env.STRIPE_PRICE_MONTHLY_LEGACY =
      "price_monthly_v1, price_monthly_v0";
    process.env.STRIPE_PRICE_YEARLY_LEGACY = "price_yearly_v1";

    expect(planFromPrice("price_monthly_v1")).toBe("monthly");
    expect(planFromPrice("price_monthly_v0")).toBe("monthly");
    expect(planFromPrice("price_yearly_v1")).toBe("yearly");
  });

  it("does not use a legacy price as the current checkout price", () => {
    process.env.STRIPE_PRICE_MONTHLY_LEGACY = "price_monthly_v1";
    process.env.STRIPE_PRICE_YEARLY_LEGACY = "price_yearly_v1";

    expect(billingPricesConfigured()).toBe(false);
    expect(priceIdFor("monthly")).toBeUndefined();
    expect(planFromPrice("price_monthly_v1")).toBe("monthly");
  });

  it("rejects an ambiguous price shared by both plans", () => {
    process.env.STRIPE_PRICE_MONTHLY = "price_monthly";
    process.env.STRIPE_PRICE_YEARLY = "price_yearly";
    process.env.STRIPE_PRICE_MONTHLY_LEGACY = "price_shared";
    process.env.STRIPE_PRICE_YEARLY_LEGACY = "price_shared";

    expect(billingPricesConfigured()).toBe(false);
    expect(planFromPrice("price_shared")).toBeNull();
  });
});

describe("appOrigin", () => {
  const request = {
    headers: {
      host: "attacker.invalid",
      "x-forwarded-proto": "https",
    },
  } as Parameters<typeof appOrigin>[0];

  it("uses the canonical Codewire origin in production", () => {
    process.env.VERCEL_ENV = "production";
    expect(appOrigin(request)).toBe("https://codewire.tools");
  });

  it("accepts an explicit HTTPS origin without a path", () => {
    process.env.APP_ORIGIN = "https://app.example.com/path";
    expect(appOrigin(request)).toBe("https://app.example.com");
  });

  it("rejects an insecure configured production origin", () => {
    process.env.APP_ORIGIN = "http://app.example.com";
    expect(() => appOrigin(request)).toThrow("APP_ORIGIN must use HTTPS");
  });
});
