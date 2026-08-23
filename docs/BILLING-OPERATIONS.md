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

## Checkout single-flight rollout

Checkout creation is serialized per profile by
`private.stripe_checkout_reservations`. The public claim, publish, retire, and
yield functions are executable only by `service_role`; clients have no table
access. A claim stores one immutable, versioned Stripe request snapshot for one
hour. If a worker fails, a two-minute lease successor must retry that same
snapshot and reservation-based Stripe idempotency key.

Elapsed database time never deletes or overwrites a reservation. An expired
published Session enters `reconciling`; the lease owner must retrieve the exact
stored Session from Stripe. The row may be retired only when that Session is
`expired`, or when it is `complete` and its exact linked subscription is
terminal (`canceled` or `incomplete_expired`). An expired unpublished
`creating` attempt has no trustworthy Session id and fails closed with
`checkout_recovery_required` for operator reconciliation. This distinction
prevents a new idempotency key from racing an old Session that Stripe may still
consider usable.

### Required database gate

The required GitHub `verify` job starts a database-only Supabase stack with CLI
`2.115.0`, replays all migrations from an empty local database, runs the pgTAP
reservation suites, and then runs `npm run test:db:concurrency`. The concurrency
runner refuses any database except loopback port `54322/postgres`; it verifies API
role denials, observes the second same-account request waiting on a PostgreSQL
lock, and proves a different account can still claim without waiting.

This gate requires Docker. A green application-only test run is not sufficient
to promote the Checkout migration or API. Keep the release closed until the
required `verify` job passes the database steps. This local gate does not
replace the production database inventory or Stripe open-session reconciliation
below.

### Recover an expired unpublished attempt

Treat `checkout_recovery_required` as a billing incident, not as a row to clear
on a timer:

1. Set `CHECKOUT_CREATION_PAUSED=true`, deploy the pause, and keep it enabled
   throughout recovery.
2. In a privileged SQL session, read the exact `creating` row by `profile_id`
   and record its `reservation_id`, `customer_id`, `created_at`, and
   `requested_expires_at`. Its Stripe idempotency key is
   `codewire-checkout:<reservation_id>`.
3. In the matching Stripe mode, list every Checkout Session for that customer
   and time window, following all pagination. Match only a Session whose
   `client_reference_id` and
   `metadata.codewire_checkout_reservation_id` equal the reservation id. Also
   review the Stripe request logs for the idempotency key; a zero-result list by
   itself is not proof that an ambiguous request never reached Stripe.
4. Stop and escalate if there is more than one match, identity metadata differs,
   the request logs are inconclusive, or Stripe is unavailable. For one match,
   retrieve it authoritatively: expire an `open` Session and confirm `expired`;
   for `complete`, retrieve its exact `subscription` and require the terminal
   status `canceled` or `incomplete_expired`. Any other status remains blocked.
5. Only after that evidence proves there is no usable or recoverable Session,
   delete the exact stale row in one transaction with predicates for
   `profile_id`, `reservation_id`, `state = 'creating'`, and
   `requested_expires_at <= now()`. Require `RETURNING reservation_id` to match
   the incident record; otherwise roll back. Save the Stripe and SQL evidence
   in the incident log, then unpause and retry normally.

Stripe's list endpoint supports customer/created/status filters but not a
metadata filter, so the operator must paginate and compare the reservation
metadata client-side. See the [Checkout Session list API](https://docs.stripe.com/api/checkout/sessions/list)
and [Session lifecycle/status fields](https://docs.stripe.com/api/checkout/sessions/object).

The production inventory observed on 2026-08-15 was:

- `1` profile
- `0` linked Stripe customers
- `0` profiles in `active`, `trialing`, or `past_due`
- `0` Stripe entitlement-event rows
- no checkout-reservation table or reservation RPCs yet
- Stripe open-session inventory was not independently verified by this change;
  the release gate remains closed until Stripe reports zero

That snapshot is evidence, not a future release approval. Re-run the database
inventory immediately before rollout:

```sql
select
  count(*) as profiles,
  count(*) filter (where stripe_customer_id is not null) as linked_customers,
  count(*) filter (
    where status in ('active', 'trialing', 'past_due')
  ) as recoverable_profiles
from public.profiles;

select count(*) as entitlement_events
from private.stripe_entitlement_events;
```

Also query the production Stripe project directly for every open
subscription-mode Checkout Session, following all pagination. This check must
come from Stripe, not from `profiles`: the database is not the source of truth
for Checkout Session status. Pause Checkout first, let old requests drain, and
only then take the release-gate inventory. Let any old-code open Session expire
or deliberately expire and reconcile it, then repeat the Stripe query until
the open-session result is zero. A completed Session must be reconciled through
its subscription and webhook state instead of being discarded.

Roll out single-flight in this order:

1. Set production `CHECKOUT_CREATION_PAUSED=true`, deploy the guarded API build,
   and verify Checkout returns `503` with
   `code=checkout_temporarily_unavailable`. The pause check runs before any
   reservation RPC, so this build can be deployed before the migration.
2. Wait for old Checkout requests to drain. Re-run the database inventory and
   the independent, fully paginated Stripe open-session gate after the pause is
   confirmed. Keep Checkout paused unless the Stripe result is zero.
3. Apply `20260815142908_stripe_checkout_single_flight.sql`. Do not allow old
   Checkout API traffic during or after this migration.
4. Verify RLS is enabled, the table has no API-role privileges, and only
   `service_role` can execute the four reservation functions.
5. Set `CHECKOUT_CREATION_PAUSED=false` (or remove it), deploy, and verify the
   guarded build is live before accepting Checkout traffic.
6. Send concurrent same-plan and cross-plan requests for one test account.
   Confirm only one Stripe Session is created, same-plan retry reuses its URL,
   cross-plan is blocked while it is live, an expired ready Session is verified
   with Stripe before retirement, and a yielded lease preserves the original
   reservation id and snapshot.

For rollback, first re-enable the pause on the guarded build and let requests
drain. The migration and its reservation rows are additive and can remain while
the incident is investigated; do not drop the table or deploy an older API that
ignores the pause as the first rollback action.

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
3. Apply `20260809195056_stripe_entitlement_hardening.sql`.
4. Deploy the RPC-based webhook immediately.
5. Exercise a test subscription and verify `applied`, `duplicate`, cancellation,
   and an out-of-order replay without exposing raw database errors.

If rollback is necessary, roll back the application before changing the
database. The migration is additive for the previous direct-update webhook,
while the new webhook intentionally has no direct-write fallback.
