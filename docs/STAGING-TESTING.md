# Isolated staging verification

Codewire's staging smoke test is manual and fail-closed. It verifies remote
authentication, Pro/free entitlement boundaries, cross-account RLS, and the
`sync_codewire` RPC without using production customer data. It also refuses
Stripe live-mode keys. It does not create a Checkout Session or charge.

## One-time setup

1. Create a separate Supabase staging project or long-lived isolated branch.
   Apply the committed migrations to that environment. Never clone production
   data into it.
2. Create two staging-only email/password users. Keep one profile `free`. Give
   the other a future-dated `active` or `trialing` monthly/yearly entitlement.
3. Create a Vercel staging environment or branch-scoped Preview deployment that
   uses only the staging Supabase credentials and Stripe test-mode resources.
4. Add a protected GitHub environment named `staging`. Configure
   `STAGING_APP_URL` as an environment variable and the remaining values as
   environment secrets listed in `.github/workflows/staging-smoke.yml`.
5. Configure a Stripe test-mode webhook destination for the staging deployment.
   Do not reuse the production webhook secret or live Price ids.

## Running the gate

Run the **Staging smoke** workflow manually. The script rejects the production
Codewire hostname, the known production Supabase project, non-HTTPS endpoints,
and Stripe keys that are not test-mode keys before signing in or writing data.

The test creates one uniquely named job and saved calculation, proves the free
account cannot read them, proves free sync is denied, and proves a Pro account
cannot forge another user's ownership. A service-role client deletes only those
two exact disposable rows during cleanup.

## Current boundary

This first gate validates configuration isolation plus Supabase auth, RLS,
entitlement, and cloud sync. Stripe webhook delivery, Checkout, portal behavior,
and subscription lifecycle still require a separate test-mode journey before
they can be called covered.
