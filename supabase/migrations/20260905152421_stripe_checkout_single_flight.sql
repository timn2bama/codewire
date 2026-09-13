-- Serialize Stripe Checkout creation per Codewire account.
--
-- Deploy this additive migration before the API version that calls these
-- functions. The immutable request snapshot and stable reservation id let a
-- lease successor retry Stripe with the same parameters and idempotency key.

create schema if not exists private;

revoke all on schema private from public, anon;
grant usage on schema private to service_role;

create table if not exists private.stripe_checkout_reservations (
  profile_id uuid primary key
    references public.profiles (id) on delete cascade,
  reservation_id uuid not null unique,
  request_version integer not null default 1,
  state text not null,
  plan text not null,
  customer_id text not null,
  price_id text not null,
  origin text not null,
  trial_period_days integer,
  requested_expires_at timestamptz not null,
  -- Keep the final owner's token in ready state so an exact publish retry can
  -- be recognized as already_stored without reopening the request snapshot.
  lease_token uuid not null,
  lease_expires_at timestamptz not null,
  stripe_session_id text unique,
  checkout_url text,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint stripe_checkout_reservations_version_check
    check (request_version = 1),
  constraint stripe_checkout_reservations_state_check
    check (state in ('creating', 'ready', 'reconciling')),
  constraint stripe_checkout_reservations_plan_check
    check (plan in ('monthly', 'yearly')),
  constraint stripe_checkout_reservations_customer_check
    check (
      pg_catalog.length(pg_catalog.btrim(customer_id)) > 0
      and pg_catalog.length(customer_id) <= 255
    ),
  constraint stripe_checkout_reservations_price_check
    check (
      pg_catalog.length(pg_catalog.btrim(price_id)) > 0
      and pg_catalog.length(price_id) <= 255
    ),
  constraint stripe_checkout_reservations_origin_check
    check (
      pg_catalog.length(origin) between 8 and 512
      and (
        origin ~ '^https://[^[:space:]/?#@]+$'
        or origin ~ '^http://(localhost|127[.]0[.]0[.]1)(:[0-9]{1,5})?$'
      )
    ),
  constraint stripe_checkout_reservations_trial_check
    check (
      trial_period_days is null
      or trial_period_days = 7
    ),
  constraint stripe_checkout_reservations_expiry_check
    check (
      requested_expires_at >= created_at + interval '30 minutes'
      and requested_expires_at <= created_at + interval '24 hours'
      and (
        state = 'reconciling'
        or lease_expires_at <= requested_expires_at
      )
    ),
  constraint stripe_checkout_reservations_timestamps_check
    check (updated_at >= created_at),
  constraint stripe_checkout_reservations_ready_fields_check
    check (
      (
        state = 'creating'
        and stripe_session_id is null
        and checkout_url is null
      )
      or (
        state in ('ready', 'reconciling')
        and stripe_session_id is not null
        and pg_catalog.length(pg_catalog.btrim(stripe_session_id)) > 0
        and pg_catalog.length(stripe_session_id) <= 255
        and checkout_url is not null
        and pg_catalog.length(pg_catalog.btrim(checkout_url)) > 0
        and pg_catalog.length(checkout_url) <= 4096
      )
    )
);

alter table private.stripe_checkout_reservations enable row level security;

revoke all on table private.stripe_checkout_reservations
  from public, anon, authenticated, service_role;

create or replace function public.claim_stripe_checkout_reservation(
  p_profile_id uuid,
  p_customer_id text,
  p_plan text,
  p_price_id text,
  p_origin text,
  p_trial_period_days integer,
  p_requested_expires_at timestamptz,
  p_reservation_id uuid,
  p_lease_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_lease_expires_at timestamptz;
  v_profile record;
  v_reservation private.stripe_checkout_reservations%rowtype;
  v_has_reservation boolean;
begin
  if p_profile_id is null
    or p_reservation_id is null
    or p_lease_token is null then
    raise exception using
      errcode = '22023',
      message = 'checkout identifiers are required';
  end if;

  if p_customer_id is null
    or pg_catalog.length(pg_catalog.btrim(p_customer_id)) = 0
    or pg_catalog.length(p_customer_id) > 255 then
    raise exception using
      errcode = '22023',
      message = 'invalid Stripe customer id';
  end if;

  if p_plan is null or p_plan not in ('monthly', 'yearly') then
    raise exception using
      errcode = '22023',
      message = 'invalid subscription plan';
  end if;

  if p_price_id is null
    or pg_catalog.length(pg_catalog.btrim(p_price_id)) = 0
    or pg_catalog.length(p_price_id) > 255 then
    raise exception using
      errcode = '22023',
      message = 'invalid Stripe price id';
  end if;

  if p_origin is null
    or pg_catalog.length(p_origin) not between 8 and 512
    or not (
      p_origin ~ '^https://[^[:space:]/?#@]+$'
      or p_origin
        ~ '^http://(localhost|127[.]0[.]0[.]1)(:[0-9]{1,5})?$'
    ) then
    raise exception using
      errcode = '22023',
      message = 'invalid application origin';
  end if;

  if p_trial_period_days is not null
    and p_trial_period_days <> 7 then
    raise exception using
      errcode = '22023',
      message = 'invalid trial period';
  end if;

  -- Stripe expects second-precision Unix timestamps. Accept a small clock and
  -- transit tolerance while still enforcing the one-hour Checkout lifetime.
  if p_requested_expires_at is null
    or p_requested_expires_at
      <> pg_catalog.date_trunc('second', p_requested_expires_at)
    or p_requested_expires_at < v_now + interval '59 minutes'
    or p_requested_expires_at > v_now + interval '61 minutes' then
    raise exception using
      errcode = '22023',
      message = 'Checkout expiry must be one hour from database time';
  end if;

  -- Every claim locks the profile first. This is the only serialization point,
  -- so unrelated accounts can still open Checkout concurrently.
  select
    p.status,
    p.plan,
    p.stripe_customer_id
  into v_profile
  from public.profiles as p
  where p.id = p_profile_id
  for update;

  if not found then
    return pg_catalog.jsonb_build_object(
      'outcome', 'blocked',
      'reason', 'missing_profile'
    );
  end if;

  if v_profile.stripe_customer_id is distinct from p_customer_id then
    return pg_catalog.jsonb_build_object(
      'outcome', 'blocked',
      'reason', 'customer_mismatch'
    );
  end if;

  if v_profile.status in ('active', 'trialing', 'past_due') then
    return pg_catalog.jsonb_build_object(
      'outcome', 'blocked',
      'reason', 'subscription_active',
      'active_plan', v_profile.plan
    );
  end if;

  select r.*
  into v_reservation
  from private.stripe_checkout_reservations as r
  where r.profile_id = p_profile_id
  for update;
  v_has_reservation := found;
  v_now := pg_catalog.clock_timestamp();

  if not v_has_reservation then
    if p_requested_expires_at < v_now + interval '30 minutes' then
      raise exception using
        errcode = '22023',
        message = 'Checkout expiry became too near while waiting for account lock';
    end if;

    v_lease_expires_at := v_now + interval '2 minutes';

    insert into private.stripe_checkout_reservations (
      profile_id,
      reservation_id,
      request_version,
      state,
      plan,
      customer_id,
      price_id,
      origin,
      trial_period_days,
      requested_expires_at,
      lease_token,
      lease_expires_at,
      stripe_session_id,
      checkout_url,
      created_at,
      updated_at
    ) values (
      p_profile_id,
      p_reservation_id,
      1,
      'creating',
      p_plan,
      p_customer_id,
      p_price_id,
      p_origin,
      p_trial_period_days,
      p_requested_expires_at,
      p_lease_token,
      v_lease_expires_at,
      null,
      null,
      v_now,
      v_now
    )
    returning * into v_reservation;

    return pg_catalog.jsonb_build_object(
      'outcome', 'create',
      'snapshot', pg_catalog.jsonb_build_object(
        'reservation_id', v_reservation.reservation_id,
        'profile_id', v_reservation.profile_id,
        'request_version', v_reservation.request_version,
        'plan', v_reservation.plan,
        'customer_id', v_reservation.customer_id,
        'price_id', v_reservation.price_id,
        'origin', v_reservation.origin,
        'trial_period_days', v_reservation.trial_period_days,
        'requested_expires_at', pg_catalog.floor(
          extract(epoch from v_reservation.requested_expires_at)
        )::bigint,
        'lease_token', v_reservation.lease_token,
        'lease_expires_at', pg_catalog.floor(
          extract(epoch from v_reservation.lease_expires_at)
        )::bigint
      )
    );
  end if;

  -- Time alone cannot prove whether Stripe accepted an earlier unpublished
  -- request. Once it reaches session expiry, operator reconciliation is
  -- required before any customer binding or plan can allocate a new key.
  if v_reservation.state = 'creating'
    and v_reservation.requested_expires_at <= v_now then
    return pg_catalog.jsonb_build_object(
      'outcome', 'blocked',
      'reason', 'checkout_recovery_required',
      'active_plan', v_reservation.plan,
      'expires_at', pg_catalog.floor(
        extract(epoch from v_reservation.requested_expires_at)
      )::bigint
    );
  end if;

  if v_reservation.customer_id <> p_customer_id then
    return pg_catalog.jsonb_build_object(
      'outcome', 'blocked',
      'reason', 'customer_mismatch',
      'expires_at', pg_catalog.floor(
        extract(epoch from v_reservation.requested_expires_at)
      )::bigint
    );
  end if;

  if v_reservation.state = 'creating' then

    if v_reservation.plan <> p_plan then
      return pg_catalog.jsonb_build_object(
        'outcome', 'blocked',
        'reason', 'checkout_plan_locked',
        'active_plan', v_reservation.plan,
        'expires_at', pg_catalog.floor(
          extract(epoch from v_reservation.requested_expires_at)
        )::bigint
      );
    end if;

    if v_reservation.lease_expires_at > v_now then
      return pg_catalog.jsonb_build_object(
        'outcome', 'wait',
        'plan', v_reservation.plan,
        'expires_at', pg_catalog.floor(
          extract(epoch from v_reservation.lease_expires_at)
        )::bigint
      );
    end if;

    if v_now + interval '2 minutes' < v_reservation.requested_expires_at then
      v_lease_expires_at := v_now + interval '2 minutes';
    else
      v_lease_expires_at := v_reservation.requested_expires_at;
    end if;

    update private.stripe_checkout_reservations
    set lease_token = p_lease_token,
        lease_expires_at = v_lease_expires_at,
        updated_at = v_now
    where profile_id = p_profile_id
    returning * into v_reservation;

    return pg_catalog.jsonb_build_object(
      'outcome', 'create',
      'snapshot', pg_catalog.jsonb_build_object(
        'reservation_id', v_reservation.reservation_id,
        'profile_id', v_reservation.profile_id,
        'request_version', v_reservation.request_version,
        'plan', v_reservation.plan,
        'customer_id', v_reservation.customer_id,
        'price_id', v_reservation.price_id,
        'origin', v_reservation.origin,
        'trial_period_days', v_reservation.trial_period_days,
        'requested_expires_at', pg_catalog.floor(
          extract(epoch from v_reservation.requested_expires_at)
        )::bigint,
        'lease_token', v_reservation.lease_token,
        'lease_expires_at', pg_catalog.floor(
          extract(epoch from v_reservation.lease_expires_at)
        )::bigint
      )
    );
  end if;

  if v_reservation.state = 'ready'
    and v_reservation.requested_expires_at > v_now then
    if v_reservation.plan <> p_plan then
      return pg_catalog.jsonb_build_object(
        'outcome', 'blocked',
        'reason', 'checkout_plan_locked',
        'active_plan', v_reservation.plan,
        'expires_at', pg_catalog.floor(
          extract(epoch from v_reservation.requested_expires_at)
        )::bigint
      );
    end if;

    return pg_catalog.jsonb_build_object(
      'outcome', 'reuse',
      'plan', v_reservation.plan,
      'url', v_reservation.checkout_url,
      'expires_at', pg_catalog.floor(
        extract(epoch from v_reservation.requested_expires_at)
      )::bigint
    );
  end if;

  -- A ready session is never retired from elapsed database time alone. The
  -- lease holder must retrieve it from Stripe, prove that it is safely
  -- expired, and then call the fenced retirement function.
  if v_reservation.state = 'ready' then
    v_lease_expires_at := v_now + interval '2 minutes';

    update private.stripe_checkout_reservations
    set state = 'reconciling',
        lease_token = p_lease_token,
        lease_expires_at = v_lease_expires_at,
        updated_at = v_now
    where profile_id = p_profile_id
    returning * into v_reservation;

    return pg_catalog.jsonb_build_object(
      'outcome', 'reconcile',
      'reservation_id', v_reservation.reservation_id,
      'lease_token', v_reservation.lease_token,
      'session_id', v_reservation.stripe_session_id,
      'plan', v_reservation.plan,
      'customer_id', v_reservation.customer_id,
      'session_expires_at', pg_catalog.floor(
        extract(epoch from v_reservation.requested_expires_at)
      )::bigint,
      'lease_expires_at', pg_catalog.floor(
        extract(epoch from v_reservation.lease_expires_at)
      )::bigint
    );
  end if;

  if v_reservation.lease_expires_at > v_now then
    return pg_catalog.jsonb_build_object(
      'outcome', 'wait',
      'plan', v_reservation.plan,
      'expires_at', pg_catalog.floor(
        extract(epoch from v_reservation.lease_expires_at)
      )::bigint
    );
  end if;

  v_lease_expires_at := v_now + interval '2 minutes';

  update private.stripe_checkout_reservations
  set lease_token = p_lease_token,
      lease_expires_at = v_lease_expires_at,
      updated_at = v_now
  where profile_id = p_profile_id
  returning * into v_reservation;

  return pg_catalog.jsonb_build_object(
    'outcome', 'reconcile',
    'reservation_id', v_reservation.reservation_id,
    'lease_token', v_reservation.lease_token,
    'session_id', v_reservation.stripe_session_id,
    'plan', v_reservation.plan,
    'customer_id', v_reservation.customer_id,
    'session_expires_at', pg_catalog.floor(
      extract(epoch from v_reservation.requested_expires_at)
    )::bigint,
    'lease_expires_at', pg_catalog.floor(
      extract(epoch from v_reservation.lease_expires_at)
    )::bigint
  );
end;
$$;

create or replace function public.publish_stripe_checkout_reservation(
  p_profile_id uuid,
  p_reservation_id uuid,
  p_lease_token uuid,
  p_stripe_session_id text,
  p_checkout_url text,
  p_stripe_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_reservation private.stripe_checkout_reservations%rowtype;
begin
  if p_profile_id is null
    or p_reservation_id is null
    or p_lease_token is null
    or p_stripe_expires_at is null then
    raise exception using
      errcode = '22023',
      message = 'checkout publication identifiers are required';
  end if;

  if p_stripe_session_id is null
    or pg_catalog.length(pg_catalog.btrim(p_stripe_session_id)) = 0
    or pg_catalog.length(p_stripe_session_id) > 255 then
    raise exception using
      errcode = '22023',
      message = 'invalid Stripe Checkout session id';
  end if;

  if p_checkout_url is null
    or pg_catalog.length(pg_catalog.btrim(p_checkout_url)) = 0
    or pg_catalog.length(p_checkout_url) > 4096
    or p_checkout_url !~ '^https://' then
    raise exception using
      errcode = '22023',
      message = 'invalid Stripe Checkout URL';
  end if;

  select r.*
  into v_reservation
  from private.stripe_checkout_reservations as r
  where r.profile_id = p_profile_id
  for update;
  v_now := pg_catalog.clock_timestamp();

  if v_reservation.profile_id is null
    or v_reservation.reservation_id <> p_reservation_id
    or v_reservation.lease_token <> p_lease_token
    or v_reservation.requested_expires_at <> p_stripe_expires_at then
    return pg_catalog.jsonb_build_object('outcome', 'stale');
  end if;

  if v_reservation.state = 'ready' then
    if v_reservation.stripe_session_id = p_stripe_session_id
      and v_reservation.checkout_url = p_checkout_url then
      return pg_catalog.jsonb_build_object(
        'outcome', 'already_stored',
        'url', v_reservation.checkout_url,
        'expires_at', pg_catalog.floor(
          extract(epoch from v_reservation.requested_expires_at)
        )::bigint
      );
    end if;

    return pg_catalog.jsonb_build_object('outcome', 'stale');
  end if;

  if v_reservation.state <> 'creating'
    or v_reservation.lease_expires_at <= v_now
    or v_reservation.requested_expires_at <= v_now then
    return pg_catalog.jsonb_build_object('outcome', 'stale');
  end if;

  update private.stripe_checkout_reservations
  set state = 'ready',
      stripe_session_id = p_stripe_session_id,
      checkout_url = p_checkout_url,
      updated_at = v_now
  where profile_id = p_profile_id;

  return pg_catalog.jsonb_build_object(
    'outcome', 'stored',
    'url', p_checkout_url,
    'expires_at', pg_catalog.floor(
      extract(epoch from p_stripe_expires_at)
    )::bigint
  );
end;
$$;

create or replace function public.retire_stripe_checkout_reservation(
  p_profile_id uuid,
  p_reservation_id uuid,
  p_lease_token uuid,
  p_stripe_session_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_locked_profile_id uuid;
  v_reservation private.stripe_checkout_reservations%rowtype;
begin
  if p_profile_id is null
    or p_reservation_id is null
    or p_lease_token is null then
    raise exception using
      errcode = '22023',
      message = 'checkout retirement identifiers are required';
  end if;

  if p_stripe_session_id is null
    or pg_catalog.length(pg_catalog.btrim(p_stripe_session_id)) = 0
    or pg_catalog.length(p_stripe_session_id) > 255 then
    raise exception using
      errcode = '22023',
      message = 'invalid Stripe Checkout session id';
  end if;

  -- Match the claim lock order: profile first, reservation second. Retirement
  -- is permitted only after the caller has reconciled the stored session with
  -- Stripe; elapsed database time by itself never invokes this function.
  select p.id
  into v_locked_profile_id
  from public.profiles as p
  where p.id = p_profile_id
  for update;

  if v_locked_profile_id is null then
    return pg_catalog.jsonb_build_object('outcome', 'stale');
  end if;

  select r.*
  into v_reservation
  from private.stripe_checkout_reservations as r
  where r.profile_id = p_profile_id
  for update;
  v_now := pg_catalog.clock_timestamp();

  if v_reservation.profile_id is null
    or v_reservation.state <> 'reconciling'
    or v_reservation.reservation_id <> p_reservation_id
    or v_reservation.lease_token <> p_lease_token
    or v_reservation.stripe_session_id <> p_stripe_session_id
    or v_reservation.requested_expires_at > v_now
    or v_reservation.lease_expires_at <= v_now then
    return pg_catalog.jsonb_build_object('outcome', 'stale');
  end if;

  delete from private.stripe_checkout_reservations
  where profile_id = p_profile_id;

  return pg_catalog.jsonb_build_object('outcome', 'retired');
end;
$$;

create or replace function public.yield_stripe_checkout_reservation_lease(
  p_profile_id uuid,
  p_reservation_id uuid,
  p_lease_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_updated_profile_id uuid;
begin
  if p_profile_id is null
    or p_reservation_id is null
    or p_lease_token is null then
    raise exception using
      errcode = '22023',
      message = 'checkout lease identifiers are required';
  end if;

  -- Yielding only shortens the current lease. It deliberately preserves the
  -- reservation id and exact request snapshot after every Stripe outcome,
  -- including an ambiguous network failure.
  update private.stripe_checkout_reservations
  set lease_expires_at = v_now,
      updated_at = v_now
  where profile_id = p_profile_id
    and reservation_id = p_reservation_id
    and lease_token = p_lease_token
    and state in ('creating', 'reconciling')
    and lease_expires_at > v_now
    and (
      (state = 'creating' and requested_expires_at > v_now)
      or (state = 'reconciling' and requested_expires_at <= v_now)
    )
  returning profile_id into v_updated_profile_id;

  if v_updated_profile_id is null then
    return pg_catalog.jsonb_build_object('outcome', 'stale');
  end if;

  return pg_catalog.jsonb_build_object('outcome', 'yielded');
end;
$$;

revoke all on function public.claim_stripe_checkout_reservation(
  uuid,
  text,
  text,
  text,
  text,
  integer,
  timestamptz,
  uuid,
  uuid
) from public, anon, authenticated, service_role;

revoke all on function public.publish_stripe_checkout_reservation(
  uuid,
  uuid,
  uuid,
  text,
  text,
  timestamptz
) from public, anon, authenticated, service_role;

revoke all on function public.retire_stripe_checkout_reservation(
  uuid,
  uuid,
  uuid,
  text
) from public, anon, authenticated, service_role;

revoke all on function public.yield_stripe_checkout_reservation_lease(
  uuid,
  uuid,
  uuid
) from public, anon, authenticated, service_role;

grant execute on function public.claim_stripe_checkout_reservation(
  uuid,
  text,
  text,
  text,
  text,
  integer,
  timestamptz,
  uuid,
  uuid
) to service_role;

grant execute on function public.publish_stripe_checkout_reservation(
  uuid,
  uuid,
  uuid,
  text,
  text,
  timestamptz
) to service_role;

grant execute on function public.retire_stripe_checkout_reservation(
  uuid,
  uuid,
  uuid,
  text
) to service_role;

grant execute on function public.yield_stripe_checkout_reservation_lease(
  uuid,
  uuid,
  uuid
) to service_role;
