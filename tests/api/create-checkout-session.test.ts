import type { SupabaseClient } from "@supabase/supabase-js";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import type Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCheckoutSessionHandler } from "../../api/create-checkout-session";

const USER = { id: "user_test", email: "user@example.com" };
const PROFILE_VERSION = "2026-08-09T12:00:00.000Z";
const NOW = new Date("2026-08-15T12:00:00.000Z");

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function checkoutSessionFrom(
  parameters: Stripe.Checkout.SessionCreateParams,
  overrides: Partial<Stripe.Checkout.Session> = {},
): Stripe.Checkout.Session {
  return {
    id: "cs_test",
    object: "checkout.session",
    url: "https://checkout.stripe.test/s",
    status: "open",
    mode: "subscription",
    customer: parameters.customer as string,
    client_reference_id: parameters.client_reference_id ?? null,
    metadata: parameters.metadata ?? {},
    expires_at: parameters.expires_at ?? 0,
    ...overrides,
  } as Stripe.Checkout.Session;
}

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
  const setHeader = vi.fn(() => res);
  Object.assign(res, { status, json, setHeader });
  return { res, status, json, setHeader };
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
  const retrieveSubscription = vi.fn();
  const createSession = vi.fn();
  const retrieveSession = vi.fn();
  const expireSession = vi.fn();
  const getStripe = vi.fn();
  const getSupabaseAdmin = vi.fn();
  const getUser = vi.fn();
  const getWebhookSecret = vi.fn();
  const billingPricesConfigured = vi.fn();
  const checkoutCreationPaused = vi.fn();
  const planFromPrice = vi.fn();
  const priceIdFor = vi.fn();
  const appOrigin = vi.fn();
  const now = vi.fn();
  const randomUUID = vi.fn();
  const claimStripeCheckoutReservation = vi.fn();
  const publishStripeCheckoutReservation = vi.fn();
  const retireStripeCheckoutReservation = vi.fn();
  const yieldStripeCheckoutReservationLease = vi.fn();

  function handler() {
    return createCheckoutSessionHandler({
      appOrigin,
      billingPricesConfigured,
      checkoutCreationPaused,
      getStripe,
      getSupabaseAdmin,
      getUser,
      getWebhookSecret,
      now,
      planFromPrice,
      priceIdFor,
      randomUUID,
      claimStripeCheckoutReservation,
      publishStripeCheckoutReservation,
      retireStripeCheckoutReservation,
      yieldStripeCheckoutReservationLease,
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
    createSession.mockImplementation(
      async (parameters: Stripe.Checkout.SessionCreateParams) =>
        checkoutSessionFrom(parameters),
    );
    getStripe.mockReturnValue({
      customers: {
        retrieve: retrieveCustomer,
        create: createCustomer,
      },
      subscriptions: {
        list: listSubscriptions,
        retrieve: retrieveSubscription,
      },
      checkout: {
        sessions: {
          create: createSession,
          retrieve: retrieveSession,
          expire: expireSession,
        },
      },
    } as unknown as Stripe);
    getSupabaseAdmin.mockReturnValue({ from } as unknown as SupabaseClient);
    getUser.mockResolvedValue(USER);
    getWebhookSecret.mockReturnValue("whsec_test");
    billingPricesConfigured.mockReturnValue(true);
    checkoutCreationPaused.mockReturnValue(false);
    planFromPrice.mockImplementation((priceId: string | undefined) => {
      if (priceId === "price_monthly") return "monthly";
      if (priceId === "price_yearly") return "yearly";
      return null;
    });
    priceIdFor.mockImplementation((plan: string) =>
      plan === "monthly" || plan === "yearly" ? `price_${plan}` : undefined,
    );
    appOrigin.mockReturnValue("https://codewire.tools");
    now.mockReturnValue(NOW);
    let nextUuid = 0;
    randomUUID.mockImplementation(
      () => `00000000-0000-4000-8000-${String(++nextUuid).padStart(12, "0")}`,
    );
    claimStripeCheckoutReservation.mockImplementation(
      async (
        _admin: SupabaseClient,
        input: {
          profileId: string;
          customerId: string;
          plan: "monthly" | "yearly";
          priceId: string;
          origin: string;
          trialPeriodDays: 7 | null;
          requestedExpiresAt: string;
          reservationId: string;
          leaseToken: string;
        },
      ) => ({
        outcome: "create",
        snapshot: {
          reservationId: input.reservationId,
          profileId: input.profileId,
          requestVersion: 1,
          plan: input.plan,
          customerId: input.customerId,
          priceId: input.priceId,
          origin: input.origin,
          trialPeriodDays: input.trialPeriodDays,
          requestedExpiresAt: Math.floor(
            Date.parse(input.requestedExpiresAt) / 1000,
          ),
          idempotencyKey: `codewire-checkout:${input.reservationId}`,
          leaseToken: input.leaseToken,
          leaseExpiresAt: Math.floor(NOW.getTime() / 1000) + 120,
        },
      }),
    );
    publishStripeCheckoutReservation.mockImplementation(
      async (
        _admin: SupabaseClient,
        input: { checkoutUrl: string; stripeExpiresAt: string },
      ) => ({
        outcome: "stored",
        url: input.checkoutUrl,
        expiresAt: Math.floor(Date.parse(input.stripeExpiresAt) / 1000),
      }),
    );
    yieldStripeCheckoutReservationLease.mockResolvedValue({
      outcome: "yielded",
    });
    retireStripeCheckoutReservation.mockResolvedValue({
      outcome: "retired",
    });
  });

  afterEach(() => vi.mocked(console.error).mockRestore());

  it("fails closed before database access while checkout is paused", async () => {
    checkoutCreationPaused.mockReturnValueOnce(true);
    const output = response();

    await handler()(request(), output.res);

    expect(output.status).toHaveBeenCalledWith(503);
    expect(output.json).toHaveBeenCalledWith({
      error: "Checkout is temporarily unavailable",
      code: "checkout_temporarily_unavailable",
      retryable: true,
    });
    expect(output.setHeader).toHaveBeenCalledWith("Retry-After", "60");
    expect(getUser).not.toHaveBeenCalled();
    expect(getStripe).not.toHaveBeenCalled();
  });

  it("creates a tagged, idempotent checkout for an existing customer", async () => {
    const output = response();

    await handler()(request("yearly"), output.res);

    expect(output.status).toHaveBeenCalledWith(200);
    expect(output.json).toHaveBeenCalledWith({
      url: "https://checkout.stripe.test/s",
      outcome: "created",
      expiresAt: Math.floor(NOW.getTime() / 1000) + 3600,
    });
    expect(createSession).toHaveBeenCalledWith(
      {
        mode: "subscription",
        customer: "cus_existing",
        client_reference_id: "00000000-0000-4000-8000-000000000001",
        metadata: {
          codewire: "true",
          codewire_user_id: USER.id,
          codewire_checkout_reservation_id:
            "00000000-0000-4000-8000-000000000001",
        },
        line_items: [{ price: "price_yearly", quantity: 1 }],
        allow_promotion_codes: true,
        subscription_data: {
          trial_period_days: 7,
          metadata: {
            codewire: "true",
            codewire_user_id: USER.id,
            codewire_checkout_reservation_id:
              "00000000-0000-4000-8000-000000000001",
          },
        },
        expires_at: Math.floor(NOW.getTime() / 1000) + 3600,
        success_url: "https://codewire.tools/account?upgraded=1",
        cancel_url: "https://codewire.tools/upgrade",
      },
      {
        idempotencyKey:
          "codewire-checkout:00000000-0000-4000-8000-000000000001",
      },
    );
  });

  it("reuses the published checkout without calling Stripe again", async () => {
    const first = response();
    const second = response();

    await handler()(request(), first.res);
    claimStripeCheckoutReservation.mockResolvedValueOnce({
      outcome: "reuse",
      plan: "monthly",
      url: "https://checkout.stripe.test/s",
      expiresAt: Math.floor(NOW.getTime() / 1000) + 3600,
    });
    await handler()(request(), second.res);

    expect(createSession).toHaveBeenCalledTimes(1);
    expect(second.status).toHaveBeenCalledWith(200);
    expect(second.json).toHaveBeenCalledWith({
      url: "https://checkout.stripe.test/s",
      outcome: "reused",
      expiresAt: Math.floor(NOW.getTime() / 1000) + 3600,
    });
  });

  it("lets only one same-plan request own Stripe session creation", async () => {
    const heldSession = deferred<Stripe.Checkout.Session>();
    createSession.mockImplementationOnce(() => heldSession.promise);
    const first = response();
    const firstRequest = handler()(request("monthly"), first.res);
    await vi.waitFor(() => expect(createSession).toHaveBeenCalledTimes(1));

    claimStripeCheckoutReservation.mockResolvedValueOnce({
      outcome: "wait",
      plan: "monthly",
      expiresAt: Math.floor(NOW.getTime() / 1000) + 120,
    });
    const second = response();
    await handler()(request("monthly"), second.res);

    expect(second.status).toHaveBeenCalledWith(503);
    expect(second.json).toHaveBeenCalledWith({
      error: "Checkout is already being prepared. Try again in a moment.",
      code: "checkout_in_progress",
      retryable: true,
    });
    expect(second.setHeader).toHaveBeenCalledWith("Retry-After", "2");
    expect(createSession).toHaveBeenCalledTimes(1);

    const parameters = createSession.mock.calls[0]?.[0] as
      | Stripe.Checkout.SessionCreateParams
      | undefined;
    expect(parameters).toBeDefined();
    heldSession.resolve(checkoutSessionFrom(parameters!));
    await firstRequest;
    expect(first.status).toHaveBeenCalledWith(200);
  });

  it("blocks a concurrent request for a different plan", async () => {
    const heldSession = deferred<Stripe.Checkout.Session>();
    createSession.mockImplementationOnce(() => heldSession.promise);
    const monthly = response();
    const monthlyRequest = handler()(request("monthly"), monthly.res);
    await vi.waitFor(() => expect(createSession).toHaveBeenCalledTimes(1));

    claimStripeCheckoutReservation.mockResolvedValueOnce({
      outcome: "blocked",
      reason: "checkout_plan_locked",
      activePlan: "monthly",
      expiresAt: Math.floor(NOW.getTime() / 1000) + 3600,
    });
    const yearly = response();
    await handler()(request("yearly"), yearly.res);

    expect(yearly.status).toHaveBeenCalledWith(409);
    expect(yearly.json).toHaveBeenCalledWith({
      error:
        "Finish the existing checkout or wait for it to expire before changing plans.",
      code: "checkout_plan_locked",
      activePlan: "monthly",
      expiresAt: Math.floor(NOW.getTime() / 1000) + 3600,
    });
    expect(createSession).toHaveBeenCalledTimes(1);

    const parameters = createSession.mock.calls[0]?.[0] as
      | Stripe.Checkout.SessionCreateParams
      | undefined;
    heldSession.resolve(checkoutSessionFrom(parameters!));
    await monthlyRequest;
  });

  it("confirms an old Session is expired before switching plans", async () => {
    const oldReservationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const oldLeaseToken = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const oldSessionId = "cs_old";
    const oldExpiresAt = Math.floor(NOW.getTime() / 1000) - 1;
    claimStripeCheckoutReservation.mockResolvedValueOnce({
      outcome: "reconcile",
      reservationId: oldReservationId,
      leaseToken: oldLeaseToken,
      plan: "monthly",
      customerId: "cus_existing",
      stripeSessionId: oldSessionId,
      sessionExpiresAt: oldExpiresAt,
      leaseExpiresAt: Math.floor(NOW.getTime() / 1000) + 120,
    });
    retrieveSession.mockResolvedValueOnce({
      id: oldSessionId,
      object: "checkout.session",
      status: "expired",
      mode: "subscription",
      customer: "cus_existing",
      client_reference_id: oldReservationId,
      metadata: {
        codewire: "true",
        codewire_user_id: USER.id,
        codewire_checkout_reservation_id: oldReservationId,
      },
      expires_at: oldExpiresAt,
      url: null,
    } as Stripe.Checkout.Session);
    const output = response();

    await handler()(request("yearly"), output.res);

    expect(retrieveSession).toHaveBeenCalledWith(oldSessionId);
    expect(expireSession).not.toHaveBeenCalled();
    expect(retireStripeCheckoutReservation).toHaveBeenCalledWith(
      expect.anything(),
      {
        profileId: USER.id,
        reservationId: oldReservationId,
        leaseToken: oldLeaseToken,
        stripeSessionId: oldSessionId,
      },
    );
    expect(listSubscriptions).toHaveBeenCalledTimes(2);
    expect(createSession).toHaveBeenCalledTimes(1);
    expect(createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        line_items: [{ price: "price_yearly", quantity: 1 }],
      }),
      expect.any(Object),
    );
    expect(output.status).toHaveBeenCalledWith(200);
  });

  it("blocks when the post-reconcile subscription check sees a new live subscription", async () => {
    const reservationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const leaseToken = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const sessionId = "cs_expired";
    const expiresAt = Math.floor(NOW.getTime() / 1000) - 1;
    listSubscriptions
      .mockResolvedValueOnce({
        object: "list",
        data: [],
        has_more: false,
        url: "/v1/subscriptions",
      })
      .mockResolvedValueOnce({
        object: "list",
        data: [
          {
            id: "sub_raced",
            object: "subscription",
            status: "active",
            customer: "cus_existing",
            metadata: { codewire: "true" },
            items: { data: [] },
          } as unknown as Stripe.Subscription,
        ],
        has_more: false,
        url: "/v1/subscriptions",
      });
    claimStripeCheckoutReservation.mockResolvedValueOnce({
      outcome: "reconcile",
      reservationId,
      leaseToken,
      plan: "monthly",
      customerId: "cus_existing",
      stripeSessionId: sessionId,
      sessionExpiresAt: expiresAt,
      leaseExpiresAt: Math.floor(NOW.getTime() / 1000) + 120,
    });
    retrieveSession.mockResolvedValueOnce({
      id: sessionId,
      object: "checkout.session",
      status: "expired",
      mode: "subscription",
      customer: "cus_existing",
      client_reference_id: reservationId,
      metadata: {
        codewire: "true",
        codewire_user_id: USER.id,
        codewire_checkout_reservation_id: reservationId,
      },
      expires_at: expiresAt,
      url: null,
    } as Stripe.Checkout.Session);
    const output = response();

    await handler()(request(), output.res);

    expect(retireStripeCheckoutReservation).toHaveBeenCalledTimes(1);
    expect(listSubscriptions).toHaveBeenCalledTimes(2);
    expect(claimStripeCheckoutReservation).toHaveBeenCalledTimes(1);
    expect(createSession).not.toHaveBeenCalled();
    expect(output.status).toHaveBeenCalledWith(409);
    expect(output.json).toHaveBeenCalledWith({
      error: "Resolve the existing subscription before starting a new one",
      code: "billing_recovery_required",
    });
  });

  it("blocks when an expired reservation's Session completed", async () => {
    const reservationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const leaseToken = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const expiresAt = Math.floor(NOW.getTime() / 1000) - 1;
    claimStripeCheckoutReservation.mockResolvedValueOnce({
      outcome: "reconcile",
      reservationId,
      leaseToken,
      plan: "monthly",
      customerId: "cus_existing",
      stripeSessionId: "cs_complete",
      sessionExpiresAt: expiresAt,
      leaseExpiresAt: Math.floor(NOW.getTime() / 1000) + 120,
    });
    retrieveSession.mockResolvedValueOnce({
      id: "cs_complete",
      object: "checkout.session",
      status: "complete",
      mode: "subscription",
      customer: "cus_existing",
      subscription: "sub_active",
      client_reference_id: reservationId,
      metadata: {
        codewire: "true",
        codewire_user_id: USER.id,
        codewire_checkout_reservation_id: reservationId,
      },
      expires_at: expiresAt,
      url: null,
    } as Stripe.Checkout.Session);
    retrieveSubscription.mockResolvedValueOnce({
      id: "sub_active",
      object: "subscription",
      status: "active",
      customer: "cus_existing",
      metadata: {
        codewire: "true",
        codewire_user_id: USER.id,
        codewire_checkout_reservation_id: reservationId,
      },
      items: { data: [] },
    } as unknown as Stripe.Subscription);
    const output = response();

    await handler()(request(), output.res);

    expect(output.status).toHaveBeenCalledWith(409);
    expect(output.json).toHaveBeenCalledWith({
      error: "Checkout completed and billing confirmation is still processing.",
      code: "billing_confirmation_pending",
    });
    expect(retireStripeCheckoutReservation).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
    expect(retrieveSubscription).toHaveBeenCalledWith("sub_active");
    expect(yieldStripeCheckoutReservationLease).toHaveBeenCalledTimes(1);
  });

  it("retires a completed Session after its exact subscription is terminal", async () => {
    const reservationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const leaseToken = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const expiresAt = Math.floor(NOW.getTime() / 1000) - 1;
    const terminalSubscription = {
      id: "sub_terminal",
      object: "subscription",
      status: "canceled",
      customer: "cus_existing",
      metadata: {
        codewire: "true",
        codewire_user_id: USER.id,
        codewire_checkout_reservation_id: reservationId,
      },
      trial_start: 1_780_000_000,
      trial_end: 1_780_604_800,
      items: { data: [] },
    } as unknown as Stripe.Subscription;
    listSubscriptions.mockResolvedValue({
      object: "list",
      data: [terminalSubscription],
      has_more: false,
      url: "/v1/subscriptions",
    });
    claimStripeCheckoutReservation.mockResolvedValueOnce({
      outcome: "reconcile",
      reservationId,
      leaseToken,
      plan: "monthly",
      customerId: "cus_existing",
      stripeSessionId: "cs_complete",
      sessionExpiresAt: expiresAt,
      leaseExpiresAt: Math.floor(NOW.getTime() / 1000) + 120,
    });
    retrieveSession.mockResolvedValueOnce({
      id: "cs_complete",
      object: "checkout.session",
      status: "complete",
      mode: "subscription",
      customer: "cus_existing",
      subscription: terminalSubscription.id,
      client_reference_id: reservationId,
      metadata: {
        codewire: "true",
        codewire_user_id: USER.id,
        codewire_checkout_reservation_id: reservationId,
      },
      expires_at: expiresAt,
      url: null,
    } as Stripe.Checkout.Session);
    retrieveSubscription.mockResolvedValueOnce(terminalSubscription);
    const output = response();

    await handler()(request(), output.res);

    expect(retrieveSubscription).toHaveBeenCalledWith(
      terminalSubscription.id,
    );
    expect(retireStripeCheckoutReservation).toHaveBeenCalledTimes(1);
    expect(listSubscriptions).toHaveBeenCalledTimes(2);
    expect(createSession).toHaveBeenCalledTimes(1);
    const createParameters = createSession.mock.calls[0]?.[0] as
      | Stripe.Checkout.SessionCreateParams
      | undefined;
    expect(createParameters?.subscription_data).not.toHaveProperty(
      "trial_period_days",
    );
    expect(output.status).toHaveBeenCalledWith(200);
  });

  it("explicitly expires an old open Session before retirement", async () => {
    const reservationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const leaseToken = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const expiresAt = Math.floor(NOW.getTime() / 1000) - 1;
    const session = {
      id: "cs_open",
      object: "checkout.session",
      status: "open",
      mode: "subscription",
      customer: "cus_existing",
      client_reference_id: reservationId,
      metadata: {
        codewire: "true",
        codewire_user_id: USER.id,
        codewire_checkout_reservation_id: reservationId,
      },
      expires_at: expiresAt,
      url: "https://checkout.stripe.test/old",
    } as Stripe.Checkout.Session;
    claimStripeCheckoutReservation.mockResolvedValueOnce({
      outcome: "reconcile",
      reservationId,
      leaseToken,
      plan: "monthly",
      customerId: "cus_existing",
      stripeSessionId: session.id,
      sessionExpiresAt: expiresAt,
      leaseExpiresAt: Math.floor(NOW.getTime() / 1000) + 120,
    });
    retrieveSession.mockResolvedValueOnce(session);
    expireSession.mockResolvedValueOnce({ ...session, status: "expired" });

    await handler()(request(), response().res);

    expect(expireSession).toHaveBeenCalledWith(session.id);
    expect(retireStripeCheckoutReservation).toHaveBeenCalledTimes(1);
    expect(createSession).toHaveBeenCalledTimes(1);
  });

  it("blocks when an open Session completes during expiration", async () => {
    const reservationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const leaseToken = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const expiresAt = Math.floor(NOW.getTime() / 1000) - 1;
    const openSession = {
      id: "cs_racing",
      object: "checkout.session",
      status: "open",
      mode: "subscription",
      customer: "cus_existing",
      subscription: null,
      client_reference_id: reservationId,
      metadata: {
        codewire: "true",
        codewire_user_id: USER.id,
        codewire_checkout_reservation_id: reservationId,
      },
      expires_at: expiresAt,
      url: "https://checkout.stripe.test/old",
    } as Stripe.Checkout.Session;
    claimStripeCheckoutReservation.mockResolvedValueOnce({
      outcome: "reconcile",
      reservationId,
      leaseToken,
      plan: "monthly",
      customerId: "cus_existing",
      stripeSessionId: openSession.id,
      sessionExpiresAt: expiresAt,
      leaseExpiresAt: Math.floor(NOW.getTime() / 1000) + 120,
    });
    retrieveSession.mockResolvedValueOnce(openSession);
    expireSession.mockResolvedValueOnce({
      ...openSession,
      status: "complete",
      subscription: "sub_racing",
    });
    retrieveSubscription.mockResolvedValueOnce({
      id: "sub_racing",
      object: "subscription",
      status: "active",
      customer: "cus_existing",
      metadata: {
        codewire: "true",
        codewire_user_id: USER.id,
        codewire_checkout_reservation_id: reservationId,
      },
      items: { data: [] },
    } as unknown as Stripe.Subscription);
    const output = response();

    await handler()(request(), output.res);

    expect(output.status).toHaveBeenCalledWith(409);
    expect(output.json).toHaveBeenCalledWith({
      error: "Checkout completed and billing confirmation is still processing.",
      code: "billing_confirmation_pending",
    });
    expect(retireStripeCheckoutReservation).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
  });

  it("requires manual recovery for an expired ambiguous create", async () => {
    claimStripeCheckoutReservation.mockResolvedValueOnce({
      outcome: "blocked",
      reason: "checkout_recovery_required",
      activePlan: "monthly",
      expiresAt: Math.floor(NOW.getTime() / 1000) - 1,
    });
    const output = response();

    await handler()(request(), output.res);

    expect(output.status).toHaveBeenCalledWith(409);
    expect(output.json).toHaveBeenCalledWith({
      error:
        "The previous checkout needs review before another session can be opened.",
      code: "checkout_recovery_required",
      activePlan: "monthly",
      expiresAt: Math.floor(NOW.getTime() / 1000) - 1,
    });
    expect(createSession).not.toHaveBeenCalled();
  });

  it("replays the persisted request after configuration changes", async () => {
    claimStripeCheckoutReservation.mockResolvedValueOnce({
      outcome: "create",
      snapshot: {
        reservationId: "11111111-1111-4111-8111-111111111111",
        profileId: USER.id,
        requestVersion: 1,
        plan: "monthly",
        customerId: "cus_existing",
        priceId: "price_monthly_legacy",
        origin: "https://old.codewire.tools",
        trialPeriodDays: null,
        requestedExpiresAt: Math.floor(NOW.getTime() / 1000) + 1800,
        idempotencyKey:
          "codewire-checkout:11111111-1111-4111-8111-111111111111",
        leaseToken: "22222222-2222-4222-8222-222222222222",
        leaseExpiresAt: Math.floor(NOW.getTime() / 1000) + 120,
      },
    });

    await handler()(request("monthly"), response().res);

    expect(createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        line_items: [{ price: "price_monthly_legacy", quantity: 1 }],
        success_url: "https://old.codewire.tools/account?upgraded=1",
        cancel_url: "https://old.codewire.tools/upgrade",
        expires_at: Math.floor(NOW.getTime() / 1000) + 1800,
        subscription_data: {
          metadata: expect.objectContaining({
            codewire_checkout_reservation_id:
              "11111111-1111-4111-8111-111111111111",
          }),
        },
      }),
      {
        idempotencyKey:
          "codewire-checkout:11111111-1111-4111-8111-111111111111",
      },
    );
  });

  it("never publishes or redirects to a checkout with no URL", async () => {
    createSession.mockImplementationOnce(
      async (parameters: Stripe.Checkout.SessionCreateParams) =>
        checkoutSessionFrom(parameters, { url: null }),
    );
    const output = response();

    await handler()(request(), output.res);

    expect(output.status).toHaveBeenCalledWith(502);
    expect(output.json).toHaveBeenCalledWith({
      error: "Stripe returned an unusable checkout session",
      code: "invalid_checkout_session",
    });
    expect(publishStripeCheckoutReservation).not.toHaveBeenCalled();
    expect(yieldStripeCheckoutReservationLease).toHaveBeenCalledTimes(1);
  });

  it("does not return an unfenced URL after a stale publish", async () => {
    publishStripeCheckoutReservation.mockResolvedValueOnce({
      outcome: "stale",
    });
    const output = response();

    await handler()(request(), output.res);

    expect(output.status).toHaveBeenCalledWith(503);
    expect(output.json).toHaveBeenCalledWith({
      error: "Checkout is temporarily unavailable",
      code: "checkout_temporarily_unavailable",
      retryable: true,
    });
    expect(yieldStripeCheckoutReservationLease).toHaveBeenCalledTimes(1);
  });

  it("rejects a publication result that does not match Stripe", async () => {
    publishStripeCheckoutReservation.mockResolvedValueOnce({
      outcome: "already_stored",
      url: "https://checkout.stripe.test/different",
      expiresAt: Math.floor(NOW.getTime() / 1000) + 3600,
    });
    const output = response();

    await handler()(request(), output.res);

    expect(output.status).toHaveBeenCalledWith(503);
    expect(output.json).toHaveBeenCalledWith({
      error: "Checkout is temporarily unavailable",
      code: "checkout_temporarily_unavailable",
      retryable: true,
    });
    expect(yieldStripeCheckoutReservationLease).toHaveBeenCalledTimes(1);
  });

  it("preserves the reservation and returns retryable status on a transient Stripe error", async () => {
    createSession.mockRejectedValueOnce({
      type: "StripeConnectionError",
      code: "api_connection_error",
      requestId: "req_test",
    });
    const output = response();

    await handler()(request(), output.res);

    expect(output.status).toHaveBeenCalledWith(503);
    expect(output.json).toHaveBeenCalledWith({
      error: "Checkout is temporarily unavailable",
      code: "checkout_temporarily_unavailable",
      retryable: true,
    });
    expect(yieldStripeCheckoutReservationLease).toHaveBeenCalledTimes(1);
  });

  it("retries an ambiguous Stripe failure with the same snapshot and key", async () => {
    const reservationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const requestedExpiresAt = Math.floor(NOW.getTime() / 1000) + 3600;
    const snapshot = (leaseToken: string) => ({
      reservationId,
      profileId: USER.id,
      requestVersion: 1 as const,
      plan: "monthly" as const,
      customerId: "cus_existing",
      priceId: "price_monthly",
      origin: "https://codewire.tools",
      trialPeriodDays: 7 as const,
      requestedExpiresAt,
      idempotencyKey: `codewire-checkout:${reservationId}`,
      leaseToken,
      leaseExpiresAt: Math.floor(NOW.getTime() / 1000) + 120,
    });
    claimStripeCheckoutReservation
      .mockResolvedValueOnce({
        outcome: "create",
        snapshot: snapshot("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"),
      })
      .mockResolvedValueOnce({
        outcome: "create",
        snapshot: snapshot("cccccccc-cccc-4ccc-8ccc-cccccccccccc"),
      });
    createSession.mockRejectedValueOnce({
      type: "StripeConnectionError",
      code: "api_connection_error",
    });

    await handler()(request(), response().res);
    const retry = response();
    await handler()(request(), retry.res);

    expect(createSession).toHaveBeenCalledTimes(2);
    expect(createSession.mock.calls[0]?.[0]).toEqual(
      createSession.mock.calls[1]?.[0],
    );
    expect(createSession.mock.calls[0]?.[1]).toEqual({
      idempotencyKey: `codewire-checkout:${reservationId}`,
    });
    expect(createSession.mock.calls[1]?.[1]).toEqual(
      createSession.mock.calls[0]?.[1],
    );
    expect(retry.status).toHaveBeenCalledWith(200);
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
      code: "billing_recovery_required",
    });
    expect(createSession).not.toHaveBeenCalled();
  });

  it("fails closed on an unknown future Stripe subscription status", async () => {
    listSubscriptions.mockResolvedValueOnce({
      object: "list",
      data: [
        {
          id: "sub_future",
          object: "subscription",
          status: "future_status",
          customer: "cus_existing",
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
      code: "billing_recovery_required",
    });
    expect(claimStripeCheckoutReservation).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
  });

  it("fails closed when Stripe subscription pagination is incomplete", async () => {
    listSubscriptions.mockResolvedValueOnce({
      object: "list",
      data: [],
      has_more: true,
      url: "/v1/subscriptions",
    });
    const output = response();

    await handler()(request(), output.res);

    expect(output.status).toHaveBeenCalledWith(409);
    expect(output.json).toHaveBeenCalledWith({
      error:
        "We could not safely verify every existing subscription. Open Billing or contact support before starting a new one.",
      code: "billing_recovery_required",
    });
    expect(claimStripeCheckoutReservation).not.toHaveBeenCalled();
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
        codewire_checkout_reservation_id:
          "00000000-0000-4000-8000-000000000001",
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
      code: "checkout_internal_error",
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
      code: "checkout_internal_error",
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
