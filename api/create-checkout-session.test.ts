import type { SupabaseClient } from "@supabase/supabase-js";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import type Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCheckoutSessionHandler } from "./create-checkout-session";

const USER = { id: "user_test", email: "user@example.com" };
const PROFILE_VERSION = "2026-08-09T12:00:00.000Z";

function profile(stripeCustomerId: string | null) {
  return {
    stripe_customer_id: stripeCustomerId,
    status: "free",
    current_period_end: null,
    updated_at: PROFILE_VERSION,
  };
}

function request(plan: string = "monthly"): VercelRequest {
  return {
    method: "POST",
    body: { plan },
    headers: { host: "codewire.tools" },
  } as VercelRequest;
}

function response() {
  const res = {} as VercelResponse;
  const status = vi.fn(() => res);
  const json = vi.fn(() => res);
  Object.assign(res, { status, json });
  return { res, status, json };
}

describe("checkout session creation", () => {
  const profileSingle = vi.fn();
  const profileEq = vi.fn(() => ({ single: profileSingle }));
  const profileSelect = vi.fn(() => ({ eq: profileEq }));

  const bindMaybeSingle = vi.fn();
  const bindSelect = vi.fn(() => ({ maybeSingle: bindMaybeSingle }));
  const bindFilters = {
    eq: vi.fn(),
    is: vi.fn(),
    select: bindSelect,
  };
  bindFilters.eq.mockReturnValue(bindFilters);
  bindFilters.is.mockReturnValue(bindFilters);
  const profileUpdate = vi.fn(() => bindFilters);
  const from = vi.fn(() => ({ select: profileSelect, update: profileUpdate }));

  const retrieveCustomer = vi.fn();
  const createCustomer = vi.fn();
  const listSubscriptions = vi.fn();
  const createSession = vi.fn();
  const getStripe = vi.fn();
  const getSupabaseAdmin = vi.fn();
  const getUser = vi.fn();
  const getWebhookSecret = vi.fn();
  const billingPricesConfigured = vi.fn();
  const planFromPrice = vi.fn();
  const priceIdFor = vi.fn();
  const appOrigin = vi.fn();

  function handler() {
    return createCheckoutSessionHandler({
      appOrigin,
      billingPricesConfigured,
      getStripe,
      getSupabaseAdmin,
      getUser,
      getWebhookSecret,
      planFromPrice,
      priceIdFor,
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    profileSingle.mockResolvedValue({
      data: profile("cus_existing"),
      error: null,
    });
    bindMaybeSingle.mockResolvedValue({
      data: { id: USER.id, stripe_customer_id: "cus_new" },
      error: null,
    });
    retrieveCustomer.mockResolvedValue({
      id: "cus_existing",
      object: "customer",
      deleted: false,
      metadata: { supabase_user_id: USER.id },
    });
    createCustomer.mockResolvedValue({ id: "cus_new", object: "customer" });
    listSubscriptions.mockResolvedValue({
      object: "list",
      data: [],
      has_more: false,
      url: "/v1/subscriptions",
    });
    createSession.mockResolvedValue({ url: "https://checkout.stripe.test/s" });
    getStripe.mockReturnValue({
      customers: {
        retrieve: retrieveCustomer,
        create: createCustomer,
      },
      subscriptions: { list: listSubscriptions },
      checkout: { sessions: { create: createSession } },
    } as unknown as Stripe);
    getSupabaseAdmin.mockReturnValue({ from } as unknown as SupabaseClient);
    getUser.mockResolvedValue(USER);
    getWebhookSecret.mockReturnValue("whsec_test");
    billingPricesConfigured.mockReturnValue(true);
    planFromPrice.mockImplementation((priceId: string | undefined) => {
      if (priceId === "price_monthly") return "monthly";
      if (priceId === "price_yearly") return "yearly";
      return null;
    });
    priceIdFor.mockImplementation((plan: string) =>
      plan === "monthly" || plan === "yearly" ? `price_${plan}` : undefined,
    );
    appOrigin.mockReturnValue("https://codewire.tools");
  });

  afterEach(() => vi.mocked(console.error).mockRestore());

  it("creates a tagged, idempotent checkout for an existing customer", async () => {
    const output = response();

    await handler()(request("yearly"), output.res);

    expect(output.status).toHaveBeenCalledWith(200);
    expect(output.json).toHaveBeenCalledWith({
      url: "https://checkout.stripe.test/s",
    });
    expect(createSession).toHaveBeenCalledWith(
      {
        mode: "subscription",
        customer: "cus_existing",
        line_items: [{ price: "price_yearly", quantity: 1 }],
        allow_promotion_codes: true,
        subscription_data: {
          trial_period_days: 7,
          metadata: {
            codewire: "true",
            codewire_user_id: USER.id,
          },
        },
        success_url: "https://codewire.tools/account?upgraded=1",
        cancel_url: "https://codewire.tools/upgrade",
      },
      {
        idempotencyKey: expect.stringMatching(
          /^codewire-checkout:[a-f0-9]{64}$/,
        ),
      },
    );
  });

  it("uses the same Checkout idempotency key for a repeated request", async () => {
    await handler()(request(), response().res);
    await handler()(request(), response().res);

    expect(createSession).toHaveBeenCalledTimes(2);
    expect(createSession.mock.calls[0]?.[1]).toEqual(
      createSession.mock.calls[1]?.[1],
    );
  });

  it("does not create another checkout for an active subscription", async () => {
    profileSingle.mockResolvedValueOnce({
      data: {
        ...profile("cus_existing"),
        status: "active",
      },
      error: null,
    });
    const output = response();

    await handler()(request(), output.res);

    expect(output.status).toHaveBeenCalledWith(409);
    expect(output.json).toHaveBeenCalledWith({
      error: "Subscription already active",
    });
    expect(retrieveCustomer).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
  });

  it("blocks a past-due account before creating another subscription", async () => {
    profileSingle.mockResolvedValueOnce({
      data: {
        ...profile("cus_existing"),
        status: "past_due",
      },
      error: null,
    });
    const output = response();

    await handler()(request(), output.res);

    expect(output.status).toHaveBeenCalledWith(409);
    expect(output.json).toHaveBeenCalledWith({
      error:
        "Resolve the existing billing issue before starting a new subscription",
    });
    expect(retrieveCustomer).not.toHaveBeenCalled();
    expect(listSubscriptions).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
  });

  it("blocks a live Stripe subscription when the local profile is stale", async () => {
    listSubscriptions.mockResolvedValueOnce({
      object: "list",
      data: [
        {
          id: "sub_existing",
          object: "subscription",
          status: "active",
          metadata: { codewire: "true" },
          items: { data: [] },
        } as unknown as Stripe.Subscription,
      ],
      has_more: false,
      url: "/v1/subscriptions",
    });
    const output = response();

    await handler()(request(), output.res);

    expect(output.status).toHaveBeenCalledWith(409);
    expect(output.json).toHaveBeenCalledWith({
      error: "Resolve the existing subscription before starting a new one",
    });
    expect(createSession).not.toHaveBeenCalled();
  });

  it("does not grant a repeat trial to a returning subscriber", async () => {
    listSubscriptions.mockResolvedValueOnce({
      object: "list",
      data: [
        {
          id: "sub_prior_trial",
          object: "subscription",
          status: "canceled",
          metadata: { codewire: "true" },
          trial_start: 1_780_000_000,
          trial_end: 1_780_604_800,
          items: { data: [] },
        } as unknown as Stripe.Subscription,
      ],
      has_more: false,
      url: "/v1/subscriptions",
    });
    const output = response();

    await handler()(request(), output.res);

    expect(output.status).toHaveBeenCalledWith(200);
    const sessionParameters = createSession.mock.calls[0]?.[0] as
      | Stripe.Checkout.SessionCreateParams
      | undefined;
    expect(sessionParameters?.subscription_data).toEqual({
      metadata: {
        codewire: "true",
        codewire_user_id: USER.id,
      },
    });
    expect(sessionParameters?.subscription_data).not.toHaveProperty(
      "trial_period_days",
    );
  });

  it("rejects an unknown plan before creating Stripe resources", async () => {
    const output = response();

    await handler()(request("weekly"), output.res);

    expect(output.status).toHaveBeenCalledWith(400);
    expect(output.json).toHaveBeenCalledWith({ error: "Unknown plan" });
    expect(getStripe).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it.each([
    ["the webhook secret is missing", "secret"],
    ["the price configuration is incomplete", "prices"],
  ] as const)("does not create a paid session when %s", async (_case, failure) => {
    if (failure === "secret") getWebhookSecret.mockReturnValueOnce(undefined);
    if (failure === "prices") {
      billingPricesConfigured.mockReturnValueOnce(false);
    }
    const output = response();

    await handler()(request(), output.res);

    expect(output.status).toHaveBeenCalledWith(500);
    expect(output.json).toHaveBeenCalledWith({
      error: "Checkout session creation failed",
    });
    expect(getStripe).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
  });

  it("returns a generic 500 when the profile lookup resolves with an error", async () => {
    profileSingle.mockResolvedValueOnce({
      data: null,
      error: { message: "private database detail" },
    });
    const output = response();

    await handler()(request(), output.res);

    expect(output.status).toHaveBeenCalledWith(500);
    expect(output.json).toHaveBeenCalledWith({
      error: "Checkout session creation failed",
    });
    expect(createSession).not.toHaveBeenCalled();
  });

  it("does not replace a customer after a transient Stripe lookup error", async () => {
    retrieveCustomer.mockRejectedValueOnce({ code: "api_connection_error" });
    const output = response();

    await handler()(request(), output.res);

    expect(output.status).toHaveBeenCalledWith(500);
    expect(createCustomer).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
  });

  it("fails closed when customer metadata belongs to another user", async () => {
    retrieveCustomer.mockResolvedValueOnce({
      id: "cus_existing",
      object: "customer",
      metadata: { supabase_user_id: "different_user" },
    });
    const output = response();

    await handler()(request(), output.res);

    expect(output.status).toHaveBeenCalledWith(500);
    expect(createSession).not.toHaveBeenCalled();
  });

  it("replaces a missing customer with a guarded profile binding", async () => {
    retrieveCustomer.mockRejectedValueOnce({ code: "resource_missing" });
    const output = response();

    await handler()(request(), output.res);

    expect(createCustomer).toHaveBeenCalledWith(
      {
        email: USER.email,
        metadata: {
          codewire: "true",
          supabase_user_id: USER.id,
        },
      },
      {
        idempotencyKey: expect.stringMatching(
          /^codewire-customer:[a-f0-9]{64}$/,
        ),
      },
    );
    expect(profileUpdate).toHaveBeenCalledWith({
      stripe_customer_id: "cus_new",
    });
    expect(bindFilters.eq).toHaveBeenCalledWith("stripe_customer_id", "cus_existing");
    expect(createSession).toHaveBeenCalledWith(
      expect.objectContaining({ customer: "cus_new" }),
      expect.any(Object),
    );
    expect(output.status).toHaveBeenCalledWith(200);
  });

  it("returns 500 when a guarded binding update fails", async () => {
    profileSingle.mockResolvedValueOnce({ data: profile(null), error: null });
    bindMaybeSingle.mockResolvedValueOnce({
      data: null,
      error: { message: "failed" },
    });
    const output = response();

    await handler()(request(), output.res);

    expect(output.status).toHaveBeenCalledWith(500);
    expect(createSession).not.toHaveBeenCalled();
  });

  it("uses the verified winner when another request wins the binding race", async () => {
    profileSingle
      .mockResolvedValueOnce({ data: profile(null), error: null })
      .mockResolvedValueOnce({
        data: { stripe_customer_id: "cus_winner" },
        error: null,
      });
    bindMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
    retrieveCustomer.mockResolvedValueOnce({
      id: "cus_winner",
      object: "customer",
      metadata: { supabase_user_id: USER.id },
    });
    const output = response();

    await handler()(request(), output.res);

    expect(bindFilters.is).toHaveBeenCalledWith("stripe_customer_id", null);
    expect(createSession).toHaveBeenCalledWith(
      expect.objectContaining({ customer: "cus_winner" }),
      expect.any(Object),
    );
    expect(output.status).toHaveBeenCalledWith(200);
  });

  it("does not continue when a lost binding race has no winner", async () => {
    profileSingle
      .mockResolvedValueOnce({ data: profile(null), error: null })
      .mockResolvedValueOnce({ data: null, error: null });
    bindMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
    const output = response();

    await handler()(request(), output.res);

    expect(output.status).toHaveBeenCalledWith(500);
    expect(createSession).not.toHaveBeenCalled();
  });
});
