import { Readable } from "node:stream";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStripeWebhookHandler } from "../../api/stripe-webhook";

const RAW_BODY = Buffer.from('{"fixture":"stripe-event"}');
const PERIOD_END_SECONDS = 1_800_000_000;
const PERIOD_END_ISO = new Date(PERIOD_END_SECONDS * 1000).toISOString();

type RpcResult = {
  data: "applied" | "duplicate" | "stale" | "missing_profile" | null;
  error: { message: string } | null;
};

function subscription(
  overrides: Partial<Stripe.Subscription> = {},
): Stripe.Subscription {
  return {
    id: "sub_test",
    object: "subscription",
    customer: "cus_test",
    status: "active",
    items: {
      object: "list",
      data: [
        {
          id: "si_test",
          object: "subscription_item",
          current_period_end: PERIOD_END_SECONDS,
          price: { id: "price_yearly" },
        } as Stripe.SubscriptionItem,
      ],
      has_more: false,
      url: "/v1/subscription_items?subscription=sub_test",
    },
    ...overrides,
  } as Stripe.Subscription;
}

function stripeEvent(
  id: string,
  created: number,
  object: Stripe.Subscription = subscription(),
  type: Stripe.Event.Type = "customer.subscription.updated",
): Stripe.Event {
  return {
    id,
    object: "event",
    created,
    type,
    data: { object },
  } as Stripe.Event;
}

function request(signature = "sig_test"): VercelRequest {
  return Object.assign(Readable.from([RAW_BODY]), {
    method: "POST",
    headers: { "stripe-signature": signature },
  }) as unknown as VercelRequest;
}

function response() {
  const res = {} as VercelResponse;
  const status = vi.fn(() => res);
  const json = vi.fn(() => res);
  Object.assign(res, { status, json });
  return { res, status, json };
}

describe("Stripe webhook", () => {
  const constructEvent = vi.fn();
  const retrieveSubscription = vi.fn();
  const rpc = vi.fn();
  const getStripe = vi.fn();
  const getSupabaseAdmin = vi.fn();
  const getWebhookSecret = vi.fn();
  const planFromPrice = vi.fn(
    (priceId: string | undefined): "monthly" | "yearly" | null => {
      if (priceId === "price_monthly") return "monthly";
      if (priceId === "price_yearly") return "yearly";
      return null;
    },
  );
  const billingPricesConfigured = vi.fn();

  function handler() {
    return createStripeWebhookHandler({
      getStripe,
      getSupabaseAdmin,
      getWebhookSecret,
      planFromPrice,
      billingPricesConfigured,
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const currentSubscription = subscription();
    constructEvent.mockReturnValue(stripeEvent("evt_applied", 200));
    retrieveSubscription.mockResolvedValue(currentSubscription);
    rpc.mockResolvedValue({ data: "applied", error: null } satisfies RpcResult);
    getStripe.mockReturnValue({
      webhooks: { constructEvent },
      subscriptions: { retrieve: retrieveSubscription },
    } as unknown as Stripe);
    getSupabaseAdmin.mockReturnValue({ rpc } as unknown as SupabaseClient);
    getWebhookSecret.mockReturnValue("whsec_test");
    billingPricesConfigured.mockReturnValue(true);
  });

  afterEach(() => vi.mocked(console.error).mockRestore());

  it("returns 200 only after the entitlement event is applied", async () => {
    const output = response();

    await handler()(request(), output.res);

    expect(output.status).toHaveBeenCalledWith(200);
    expect(output.json).toHaveBeenCalledWith({ received: true });
    expect(rpc).toHaveBeenCalledWith("apply_stripe_entitlement_event", {
      p_event_id: "evt_applied",
      p_event_created: 200,
      p_event_type: "customer.subscription.updated",
      p_customer_id: "cus_test",
      p_subscription_id: "sub_test",
      p_status: "active",
      p_plan: "yearly",
      p_current_period_end: PERIOD_END_ISO,
    });

    const rawArgument = constructEvent.mock.calls[0]?.[0];
    expect(Buffer.isBuffer(rawArgument)).toBe(true);
    expect(rawArgument).toEqual(RAW_BODY);
    expect(constructEvent).toHaveBeenCalledWith(
      RAW_BODY,
      "sig_test",
      "whsec_test",
    );
  });

  it("returns a generic 500 when Supabase resolves with an error", async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "private database detail" },
    } satisfies RpcResult);
    const output = response();

    await handler()(request(), output.res);

    expect(output.status).toHaveBeenCalledWith(500);
    expect(output.json).toHaveBeenCalledWith({
      error: "Webhook processing failed",
    });
    expect(output.json).not.toHaveBeenCalledWith(
      expect.objectContaining({ error: "private database detail" }),
    );
  });

  it("returns 500 when no profile matches the Stripe customer", async () => {
    rpc.mockResolvedValueOnce({
      data: "missing_profile",
      error: null,
    } satisfies RpcResult);
    const output = response();

    await handler()(request(), output.res);

    expect(output.status).toHaveBeenCalledWith(500);
    expect(output.json).toHaveBeenCalledWith({
      error: "Webhook processing failed",
    });
  });

  it("ignores an untagged subscription with an unknown price", async () => {
    constructEvent.mockReturnValueOnce(
      stripeEvent(
        "evt_unrelated",
        210,
        subscription({
          items: {
            ...subscription().items,
            data: [
              {
                ...subscription().items.data[0],
                price: { id: "price_other_product" },
              } as Stripe.SubscriptionItem,
            ],
          },
        }),
      ),
    );
    const output = response();

    await handler()(request(), output.res);

    expect(output.status).toHaveBeenCalledWith(200);
    expect(output.json).toHaveBeenCalledWith({ received: true });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("fails a tagged Codewire subscription closed when its price is unknown", async () => {
    constructEvent.mockReturnValueOnce(
      stripeEvent(
        "evt_unknown_codewire_price",
        220,
        subscription({
          metadata: { codewire: "true" },
          items: {
            ...subscription().items,
            data: [
              {
                ...subscription().items.data[0],
                price: { id: "price_removed" },
              } as Stripe.SubscriptionItem,
            ],
          },
        }),
      ),
    );
    const output = response();

    await handler()(request(), output.res);

    expect(output.status).toHaveBeenCalledWith(200);
    expect(rpc).toHaveBeenCalledWith("apply_stripe_entitlement_event", {
      p_event_id: "evt_unknown_codewire_price",
      p_event_created: 220,
      p_event_type: "customer.subscription.updated",
      p_customer_id: "cus_test",
      p_subscription_id: "sub_test",
      p_status: "canceled",
      p_plan: null,
      p_current_period_end: null,
    });
  });

  it.each([
    "incomplete",
    "past_due",
    "paused",
    "unpaid",
  ] satisfies Stripe.Subscription.Status[])(
    "routes the recoverable %s status through billing recovery",
    async (status) => {
      constructEvent.mockReturnValueOnce(
        stripeEvent(
          `evt_${status}`,
          223,
          subscription({ status }),
        ),
      );
      const output = response();

      await handler()(request(), output.res);

      expect(output.status).toHaveBeenCalledWith(200);
      expect(rpc).toHaveBeenCalledWith(
        "apply_stripe_entitlement_event",
        expect.objectContaining({
          p_status: "past_due",
          p_plan: "yearly",
        }),
      );
    },
  );

  it("fails closed when a subscription has multiple Codewire prices", async () => {
    constructEvent.mockReturnValueOnce(
      stripeEvent(
        "evt_ambiguous_prices",
        225,
        subscription({
          items: {
            ...subscription().items,
            data: [
              subscription().items.data[0],
              {
                ...subscription().items.data[0],
                id: "si_second",
                price: { id: "price_monthly" },
              } as Stripe.SubscriptionItem,
            ],
          },
        }),
      ),
    );
    const output = response();

    await handler()(request(), output.res);

    expect(output.status).toHaveBeenCalledWith(200);
    expect(rpc).toHaveBeenCalledWith(
      "apply_stripe_entitlement_event",
      expect.objectContaining({
        p_status: "canceled",
        p_plan: null,
        p_current_period_end: null,
      }),
    );
  });

  it("normalizes an expanded Stripe customer reference", async () => {
    constructEvent.mockReturnValueOnce(
      stripeEvent(
        "evt_expanded_customer",
        230,
        subscription({
          customer: { id: "cus_expanded" } as Stripe.Customer,
        }),
      ),
    );
    const output = response();

    await handler()(request(), output.res);

    expect(output.status).toHaveBeenCalledWith(200);
    expect(rpc).toHaveBeenCalledWith(
      "apply_stripe_entitlement_event",
      expect.objectContaining({ p_customer_id: "cus_expanded" }),
    );
  });

  it("returns 500 for an active recognized price with no valid period end", async () => {
    constructEvent.mockReturnValueOnce(
      stripeEvent(
        "evt_missing_period",
        240,
        subscription({
          items: {
            ...subscription().items,
            data: [
              {
                ...subscription().items.data[0],
                current_period_end: undefined,
              } as unknown as Stripe.SubscriptionItem,
            ],
          },
        }),
      ),
    );
    const output = response();

    await handler()(request(), output.res);

    expect(output.status).toHaveBeenCalledWith(500);
    expect(output.json).toHaveBeenCalledWith({
      error: "Webhook processing failed",
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("acknowledges unsupported events without mutating entitlement", async () => {
    constructEvent.mockReturnValueOnce(
      stripeEvent(
        "evt_checkout",
        250,
        subscription(),
        "checkout.session.completed",
      ),
    );
    const output = response();

    await handler()(request(), output.res);

    expect(output.status).toHaveBeenCalledWith(200);
    expect(output.json).toHaveBeenCalledWith({ received: true });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns 500 for an unexpected persistence result", async () => {
    rpc.mockResolvedValueOnce({ data: "unknown", error: null });
    const output = response();

    await handler()(request(), output.res);

    expect(output.status).toHaveBeenCalledWith(500);
    expect(output.json).toHaveBeenCalledWith({
      error: "Webhook processing failed",
    });
  });

  it("acknowledges a duplicate delivery without failing the retry", async () => {
    const event = stripeEvent("evt_duplicate", 300);
    constructEvent.mockReturnValue(event);
    rpc
      .mockResolvedValueOnce({ data: "applied", error: null } satisfies RpcResult)
      .mockResolvedValueOnce({
        data: "duplicate",
        error: null,
      } satisfies RpcResult);
    const first = response();
    const duplicate = response();

    await handler()(request(), first.res);
    await handler()(request(), duplicate.res);

    expect(first.status).toHaveBeenCalledWith(200);
    expect(duplicate.status).toHaveBeenCalledWith(200);
    expect(duplicate.json).toHaveBeenCalledWith({ received: true });
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ p_event_id: "evt_duplicate" }),
    );
    expect(rpc.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({ p_event_id: "evt_duplicate" }),
    );
  });

  it("acknowledges an older event after a newer event without retrying it", async () => {
    const newer = stripeEvent("evt_newer", 400);
    const older = stripeEvent(
      "evt_older",
      100,
      subscription({ status: "canceled" }),
    );
    constructEvent.mockReturnValueOnce(newer).mockReturnValueOnce(older);
    rpc
      .mockResolvedValueOnce({ data: "applied", error: null } satisfies RpcResult)
      .mockResolvedValueOnce({ data: "stale", error: null } satisfies RpcResult);
    const first = response();
    const stale = response();

    await handler()(request(), first.res);
    await handler()(request(), stale.res);

    expect(first.status).toHaveBeenCalledWith(200);
    expect(stale.status).toHaveBeenCalledWith(200);
    expect(stale.json).toHaveBeenCalledWith({ received: true });
    expect(rpc.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        p_event_id: "evt_newer",
        p_event_created: 400,
      }),
    );
    expect(rpc.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({
        p_event_id: "evt_older",
        p_event_created: 100,
      }),
    );
  });

  it("returns a generic 400 and performs no persistence for an invalid signature", async () => {
    constructEvent.mockImplementationOnce(() => {
      throw new Error("private signature verifier detail");
    });
    const output = response();

    await handler()(request("bad_signature"), output.res);

    expect(output.status).toHaveBeenCalledWith(400);
    expect(output.json).toHaveBeenCalledWith({
      error: "Invalid webhook signature",
    });
    expect(getSupabaseAdmin).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["the webhook secret is missing", "secret"],
    ["billing prices are incomplete", "prices"],
  ] as const)("returns a generic 500 when %s", async (_case, failure) => {
    if (failure === "secret") getWebhookSecret.mockReturnValueOnce(undefined);
    if (failure === "prices") billingPricesConfigured.mockReturnValueOnce(false);
    const output = response();

    await handler()(request(), output.res);

    expect(output.status).toHaveBeenCalledWith(500);
    expect(output.json).toHaveBeenCalledWith({
      error: "Webhook processing failed",
    });
    expect(constructEvent).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});
