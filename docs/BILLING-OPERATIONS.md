# Billing operations

Codewire treats Stripe as the source of truth for Pro access. The webhook
persists immutable subscription-event snapshots through a service-role-only
Postgres function; direct client writes cannot grant entitlement.

## Required Stripe destination

- URL: `https://codewire.tools/api/stripe-webhook`
- API version: `2025-06-30.basil` or newer. Create new destinations with
  `2026-05-27.dahlia`; the existing production destination can remain on
  `2025-06-30.basil` because the handler supports its snapshot shape.
- Events:
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `customer.subscription.paused`
  - `customer.subscription.resumed`

Checkout events are intentionally not entitlement sources. Subscription events
contain the immutable snapshot and event timestamp required for deterministic
ordering and replay.

## Environment

Production requires `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
`STRIPE_PRICE_MONTHLY`, and `STRIPE_PRICE_YEARLY`. Checkout fails closed when
any of them are missing.

When rotating a Stripe Price, keep the retired ID in the comma-separated
`STRIPE_PRICE_MONTHLY_LEGACY` or `STRIPE_PRICE_YEARLY_LEGACY` variable until no
subscription uses it. Legacy IDs are recognized by the webhook but are never
used to open a new Checkout Session.

## Ledger cutover

The first ledger migration supports only a database with zero linked Stripe
customers. Immediately before rollout, verify:

```sql
select count(*) as linked_customers
from public.profiles
where stripe_customer_id is not null;
```

The result must be `0`; otherwise stop and reconcile every current Stripe
subscription into the ledger before enabling it.

Roll out in this order:

1. Verify the production destination, API version, enabled events, and required
   environment variables.
2. Recheck that `linked_customers` is `0`.
3. Apply `20260809142314_stripe_entitlement_hardening.sql`.
4. Deploy the RPC-based webhook immediately.
5. Exercise a test subscription and verify `applied`, `duplicate`, cancellation,
   and an out-of-order replay without exposing raw database errors.

If rollback is necessary, roll back the application before changing the
database. The migration is additive for the previous direct-update webhook,
while the new webhook intentionally has no direct-write fallback.
