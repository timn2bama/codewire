-- Codewire — Supabase schema for accounts, billing entitlement, and cloud sync.
-- Run this in the Supabase SQL editor for your project.

-- 1) PROFILES: one row per user, mirrors Stripe subscription status.
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  stripe_customer_id text unique,
  plan text,                              -- 'monthly' | 'yearly' | null
  status text not null default 'free',    -- 'free' | 'trialing' | 'active' | 'canceled' | 'past_due'
  current_period_end timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.profiles
  drop constraint if exists profiles_status_check;
alter table public.profiles
  add constraint profiles_status_check
  check (status in ('free', 'trialing', 'active', 'canceled', 'past_due'));

alter table public.profiles
  drop constraint if exists profiles_plan_check;
alter table public.profiles
  add constraint profiles_plan_check
  check (plan is null or plan in ('monthly', 'yearly'));

alter table public.profiles enable row level security;

create policy "profiles_select_own"
  on public.profiles for select to authenticated
  using ((select auth.uid()) = id);
-- Auto-create a free profile when a user signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Pro entitlement helper: true only for a recognized, unexpired subscription.
-- Used by the jobs/saved_calcs WRITE policies so the paywall is enforced in the
-- database, not just the client. SECURITY DEFINER so it can read profiles.status.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

create or replace function private.is_pro()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles as p
    where p.id = (select auth.uid())
      and p.status in ('active', 'trialing')
      and p.plan in ('monthly', 'yearly')
      and p.current_period_end > pg_catalog.now()
  );
$$;

revoke all on function private.is_pro() from public, anon;
grant execute on function private.is_pro() to authenticated, service_role;

-- 2) JOBS: cloud copy of on-device jobs (Pro sync). Client-generated text ids
--    so local and cloud rows line up. `deleted` is a tombstone for sync.
create table if not exists public.jobs (
  id text not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  job_number text,
  phone text,
  notes text,
  address text,
  city text,
  state text,
  zip text,
  created_at bigint not null,
  updated_at bigint not null,
  deleted boolean not null default false,
  primary key (user_id, id)
);

alter table public.jobs enable row level security;
-- Read/delete: any owner. Insert/update (the paid cloud-sync write): Pro only.
create policy "jobs_select_own" on public.jobs
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "jobs_delete_own" on public.jobs
  for delete to authenticated using ((select auth.uid()) = user_id);
create policy "jobs_insert_pro" on public.jobs
  for insert to authenticated
  with check ((select auth.uid()) = user_id and (select private.is_pro()));
create policy "jobs_update_pro" on public.jobs
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id and (select private.is_pro()));

-- 3) SAVED_CALCS: cloud copy of saved calculations.
create table if not exists public.saved_calcs (
  id text not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  job_id text not null,
  calculator_id text not null,
  path text not null,
  title text not null,
  summary text not null,
  result text not null,
  state jsonb not null,
  created_at bigint not null,
  updated_at bigint not null,
  deleted boolean not null default false,
  primary key (user_id, id)
);

alter table public.saved_calcs enable row level security;
create index if not exists saved_calcs_job_id_idx on public.saved_calcs (job_id);
-- Read/delete: any owner. Insert/update (the paid cloud-sync write): Pro only.
create policy "saved_calcs_select_own" on public.saved_calcs
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "saved_calcs_delete_own" on public.saved_calcs
  for delete to authenticated using ((select auth.uid()) = user_id);
create policy "saved_calcs_insert_pro" on public.saved_calcs
  for insert to authenticated
  with check ((select auth.uid()) = user_id and (select private.is_pro()));
create policy "saved_calcs_update_pro" on public.saved_calcs
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id and (select private.is_pro()));

revoke all on public.profiles, public.jobs, public.saved_calcs from anon, authenticated;
grant select on public.profiles to authenticated;
grant select on public.jobs, public.saved_calcs to authenticated;
grant all on public.profiles, public.jobs, public.saved_calcs to service_role;

-- Keep upgrades run through this full schema compatible with the account-
-- scoped conflict target below (the dated migration performs the same change).
alter table public.jobs drop constraint if exists jobs_pkey;
alter table public.jobs add constraint jobs_pkey primary key (user_id, id);
alter table public.saved_calcs drop constraint if exists saved_calcs_pkey;
alter table public.saved_calcs
  add constraint saved_calcs_pkey primary key (user_id, id);
drop index if exists public.jobs_user_id_idx;
drop index if exists public.saved_calcs_user_id_idx;

-- 4) CONFLICT-SAFE SYNC: one transaction applies only newer rows and returns
--    the authoritative snapshot. Direct client writes remain revoked.
create or replace function public.sync_codewire(
  p_job_rows jsonb default '[]'::jsonb,
  p_calc_rows jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  requesting_user_id uuid := auth.uid();
  server_now_ms bigint := floor(
    extract(epoch from clock_timestamp()) * 1000
  )::bigint;
  result jsonb;
begin
  if requesting_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if not (select private.is_pro()) then
    raise exception 'Codewire Pro is required for cloud sync'
      using errcode = '42501';
  end if;
  -- Serialize sync transactions per account so a concurrent parent deletion
  -- and calculation insert cannot each miss the other's uncommitted row.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(requesting_user_id::text, 0)
  );
  if jsonb_typeof(coalesce(p_job_rows, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_calc_rows, '[]'::jsonb)) <> 'array' then
    raise exception 'Sync payloads must be JSON arrays' using errcode = '22023';
  end if;
  if jsonb_array_length(coalesce(p_job_rows, '[]'::jsonb)) > 10000
    or jsonb_array_length(coalesce(p_calc_rows, '[]'::jsonb)) > 10000 then
    raise exception 'Sync payloads are limited to 10000 rows per collection'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(coalesce(p_job_rows, '[]'::jsonb)) as candidate(
      id text, name text, job_number text, phone text, notes text,
      address text, city text, state text, zip text, created_at bigint,
      updated_at bigint, deleted boolean
    )
    where candidate.id is null
      or btrim(candidate.id) = ''
      or candidate.name is null
      or candidate.created_at is null
      or candidate.updated_at is null
      or candidate.deleted is null
      or candidate.created_at < 0
      or candidate.created_at > candidate.updated_at
      or candidate.updated_at > server_now_ms + 300000
      or (not candidate.deleted and btrim(candidate.name) = '')
  ) then
    raise exception 'Invalid job sync row' using errcode = '22023';
  end if;
  if exists (
    select candidate.id
    from jsonb_to_recordset(coalesce(p_job_rows, '[]'::jsonb)) as candidate(
      id text, name text, job_number text, phone text, notes text,
      address text, city text, state text, zip text, created_at bigint,
      updated_at bigint, deleted boolean
    )
    group by candidate.id
    having count(*) > 1
  ) then
    raise exception 'Duplicate job sync row' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(coalesce(p_calc_rows, '[]'::jsonb)) as candidate(
      id text, job_id text, calculator_id text, path text, title text,
      summary text, result text, state jsonb, created_at bigint,
      updated_at bigint, deleted boolean
    )
    where candidate.id is null
      or btrim(candidate.id) = ''
      or candidate.job_id is null
      or candidate.calculator_id is null
      or candidate.path is null
      or candidate.title is null
      or candidate.summary is null
      or candidate.result is null
      or candidate.state is null
      or candidate.created_at is null
      or candidate.updated_at is null
      or candidate.deleted is null
      or candidate.created_at < 0
      or candidate.created_at > candidate.updated_at
      or candidate.updated_at > server_now_ms + 300000
      or (
        not candidate.deleted
        and (
          btrim(candidate.job_id) = ''
          or btrim(candidate.calculator_id) = ''
          or btrim(candidate.path) = ''
          or btrim(candidate.title) = ''
        )
      )
  ) then
    raise exception 'Invalid saved calculation sync row'
      using errcode = '22023';
  end if;
  if exists (
    select candidate.id
    from jsonb_to_recordset(coalesce(p_calc_rows, '[]'::jsonb)) as candidate(
      id text, job_id text, calculator_id text, path text, title text,
      summary text, result text, state jsonb, created_at bigint,
      updated_at bigint, deleted boolean
    )
    group by candidate.id
    having count(*) > 1
  ) then
    raise exception 'Duplicate saved calculation sync row'
      using errcode = '22023';
  end if;

  insert into public.jobs (
    id, user_id, name, job_number, phone, notes, address, city, state, zip,
    created_at, updated_at, deleted
  )
  select
    incoming.id, requesting_user_id, incoming.name, incoming.job_number,
    incoming.phone, incoming.notes, incoming.address, incoming.city,
    incoming.state, incoming.zip, incoming.created_at, incoming.updated_at,
    incoming.deleted
  from jsonb_to_recordset(coalesce(p_job_rows, '[]'::jsonb)) as incoming(
    id text, name text, job_number text, phone text, notes text, address text,
    city text, state text, zip text, created_at bigint, updated_at bigint,
    deleted boolean
  )
  order by incoming.id
  on conflict (user_id, id) do update
  set
    name = excluded.name,
    job_number = excluded.job_number,
    phone = excluded.phone,
    notes = excluded.notes,
    address = excluded.address,
    city = excluded.city,
    state = excluded.state,
    zip = excluded.zip,
    created_at = excluded.created_at,
    updated_at = excluded.updated_at,
    deleted = excluded.deleted
  where public.jobs.user_id = excluded.user_id
    and (
      excluded.updated_at > public.jobs.updated_at
      or (
        excluded.updated_at = public.jobs.updated_at
        and excluded.deleted
        and not public.jobs.deleted
      )
    );

  if exists (
    select 1
    from jsonb_to_recordset(coalesce(p_calc_rows, '[]'::jsonb)) as candidate(
      id text, job_id text, calculator_id text, path text, title text,
      summary text, result text, state jsonb, created_at bigint,
      updated_at bigint, deleted boolean
    )
    where not candidate.deleted
      and not exists (
        select 1
        from public.jobs as parent
        where parent.user_id = requesting_user_id
          and parent.id = candidate.job_id
      )
  ) then
    raise exception 'A saved calculation has no matching job'
      using errcode = '22023';
  end if;

  insert into public.saved_calcs (
    id, user_id, job_id, calculator_id, path, title, summary, result, state,
    created_at, updated_at, deleted
  )
  select
    incoming.id, requesting_user_id, incoming.job_id, incoming.calculator_id,
    incoming.path, incoming.title, incoming.summary, incoming.result,
    incoming.state, incoming.created_at, incoming.updated_at, incoming.deleted
  from jsonb_to_recordset(coalesce(p_calc_rows, '[]'::jsonb)) as incoming(
    id text, job_id text, calculator_id text, path text, title text,
    summary text, result text, state jsonb, created_at bigint,
    updated_at bigint, deleted boolean
  )
  order by incoming.id
  on conflict (user_id, id) do update
  set
    job_id = excluded.job_id,
    calculator_id = excluded.calculator_id,
    path = excluded.path,
    title = excluded.title,
    summary = excluded.summary,
    result = excluded.result,
    state = excluded.state,
    created_at = excluded.created_at,
    updated_at = excluded.updated_at,
    deleted = excluded.deleted
  where public.saved_calcs.user_id = excluded.user_id
    and (
      excluded.updated_at > public.saved_calcs.updated_at
      or (
        excluded.updated_at = public.saved_calcs.updated_at
        and excluded.deleted
        and not public.saved_calcs.deleted
      )
    );

  update public.saved_calcs as child
  set
    deleted = true,
    updated_at = greatest(child.updated_at, parent.updated_at)
  from public.jobs as parent
  where child.user_id = requesting_user_id
    and parent.user_id = requesting_user_id
    and child.job_id = parent.id
    and parent.deleted
    and (not child.deleted or child.updated_at < parent.updated_at);

  select jsonb_build_object(
    'jobs',
    coalesce(
      (
        select jsonb_agg(to_jsonb(job_row) order by job_row.updated_at, job_row.id)
        from public.jobs as job_row
        where job_row.user_id = requesting_user_id
      ),
      '[]'::jsonb
    ),
    'saved_calcs',
    coalesce(
      (
        select jsonb_agg(to_jsonb(calc_row) order by calc_row.updated_at, calc_row.id)
        from public.saved_calcs as calc_row
        where calc_row.user_id = requesting_user_id
      ),
      '[]'::jsonb
    )
  )
  into result;

  return result;
end;
$$;

revoke all on function public.sync_codewire(jsonb, jsonb)
  from public, anon, service_role;
grant execute on function public.sync_codewire(jsonb, jsonb) to authenticated;

-- 5) STRIPE ENTITLEMENT LEDGER: service-role webhook events are deduplicated,
--    ordered, and applied atomically. No client role can read the ledger or
--    invoke the mutation function.
do $$
begin
  if exists (
    select 1
    from public.profiles
    where stripe_customer_id is not null
  ) then
    raise exception
      'This ledger cutover requires zero linked Stripe customers';
  end if;
end;
$$;

create table if not exists private.stripe_entitlement_events (
  event_id text primary key,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  event_created bigint not null,
  event_type text not null,
  stripe_customer_id text not null,
  stripe_subscription_id text not null,
  status text not null,
  plan text,
  current_period_end timestamptz,
  entitled boolean generated always as (
    status in ('active', 'trialing')
    and plan in ('monthly', 'yearly')
    and current_period_end is not null
  ) stored,
  received_at timestamptz not null default clock_timestamp(),
  constraint stripe_entitlement_events_created_check
    check (event_created > 0),
  constraint stripe_entitlement_events_type_check
    check (event_type in (
      'customer.subscription.created',
      'customer.subscription.updated',
      'customer.subscription.deleted',
      'customer.subscription.paused',
      'customer.subscription.resumed'
    )),
  constraint stripe_entitlement_events_status_check
    check (status in ('trialing', 'active', 'canceled', 'past_due')),
  constraint stripe_entitlement_events_plan_check
    check (plan is null or plan in ('monthly', 'yearly')),
  constraint stripe_entitlement_events_pro_fields_check
    check (
      status not in ('active', 'trialing')
      or (plan in ('monthly', 'yearly') and current_period_end is not null)
    )
);

alter table private.stripe_entitlement_events enable row level security;

revoke all on table private.stripe_entitlement_events
  from public, anon, authenticated, service_role;

create index if not exists stripe_entitlement_events_order_idx
  on private.stripe_entitlement_events (
    profile_id,
    stripe_customer_id,
    stripe_subscription_id,
    event_created desc,
    entitled asc,
    event_id desc
  );

create or replace function public.apply_stripe_entitlement_event(
  p_event_id text,
  p_event_created bigint,
  p_event_type text,
  p_customer_id text,
  p_subscription_id text,
  p_status text,
  p_plan text,
  p_current_period_end timestamptz
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid;
  v_inserted_event_id text;
  v_latest_subscription_event_id text;
  v_snapshot record;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_server_now bigint := pg_catalog.floor(
    extract(epoch from v_now)
  )::bigint;
begin
  if p_event_id is null
    or pg_catalog.length(p_event_id) = 0
    or pg_catalog.length(p_event_id) > 255 then
    raise exception using
      errcode = '22023',
      message = 'invalid Stripe event id';
  end if;

  if p_customer_id is null
    or pg_catalog.length(p_customer_id) = 0
    or pg_catalog.length(p_customer_id) > 255 then
    raise exception using
      errcode = '22023',
      message = 'invalid Stripe customer id';
  end if;

  if p_subscription_id is null
    or pg_catalog.length(p_subscription_id) = 0
    or pg_catalog.length(p_subscription_id) > 255 then
    raise exception using
      errcode = '22023',
      message = 'invalid Stripe subscription id';
  end if;

  if p_event_created is null
    or p_event_created <= 0
    or p_event_created > v_server_now + 300 then
    raise exception using
      errcode = '22023',
      message = 'invalid Stripe event timestamp';
  end if;

  if p_event_type not in (
    'customer.subscription.created',
    'customer.subscription.updated',
    'customer.subscription.deleted',
    'customer.subscription.paused',
    'customer.subscription.resumed'
  ) then
    raise exception using
      errcode = '22023',
      message = 'unsupported Stripe event type';
  end if;

  if p_status not in ('trialing', 'active', 'canceled', 'past_due') then
    raise exception using
      errcode = '22023',
      message = 'invalid subscription status';
  end if;

  if p_plan is not null and p_plan not in ('monthly', 'yearly') then
    raise exception using
      errcode = '22023',
      message = 'invalid subscription plan';
  end if;

  if p_status in ('active', 'trialing')
    and (p_plan is null or p_current_period_end is null) then
    raise exception using
      errcode = '22023',
      message = 'entitled subscriptions require a known plan and period end';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_customer_id, 112927087)
  );

  select p.id
  into v_profile_id
  from public.profiles as p
  where p.stripe_customer_id = p_customer_id
  for update;

  if not found then
    return 'missing_profile';
  end if;

  insert into private.stripe_entitlement_events (
    event_id,
    profile_id,
    event_created,
    event_type,
    stripe_customer_id,
    stripe_subscription_id,
    status,
    plan,
    current_period_end
  ) values (
    p_event_id,
    v_profile_id,
    p_event_created,
    p_event_type,
    p_customer_id,
    p_subscription_id,
    p_status,
    p_plan,
    p_current_period_end
  )
  on conflict (event_id) do nothing
  returning event_id into v_inserted_event_id;

  if v_inserted_event_id is null then
    return 'duplicate';
  end if;

  select e.event_id
  into v_latest_subscription_event_id
  from private.stripe_entitlement_events as e
  where e.profile_id = v_profile_id
    and e.stripe_customer_id = p_customer_id
    and e.stripe_subscription_id = p_subscription_id
  order by
    e.event_created desc,
    e.entitled asc,
    e.event_id desc
  limit 1;

  if v_latest_subscription_event_id <> p_event_id then
    return 'stale';
  end if;

  with latest_per_subscription as (
    select distinct on (e.stripe_subscription_id)
      e.event_id,
      e.event_created,
      e.stripe_subscription_id,
      e.status,
      e.plan,
      e.current_period_end,
      e.entitled
    from private.stripe_entitlement_events as e
    where e.profile_id = v_profile_id
      and e.stripe_customer_id = p_customer_id
    order by
      e.stripe_subscription_id,
      e.event_created desc,
      e.entitled asc,
      e.event_id desc
  )
  select
    current.status,
    current.plan,
    current.current_period_end
  into v_snapshot
  from latest_per_subscription as current
  order by
    (
      current.entitled
      and current.current_period_end > v_now
    ) desc,
    case
      when current.entitled
        and current.current_period_end > v_now
      then case current.status
        when 'active' then 2
        when 'trialing' then 1
        else 0
      end
      else 0
    end desc,
    current.event_created desc,
    current.current_period_end desc nulls last,
    current.event_id desc
  limit 1;

  update public.profiles
  set status = v_snapshot.status,
      plan = v_snapshot.plan,
      current_period_end = v_snapshot.current_period_end,
      updated_at = v_now
  where id = v_profile_id;

  return 'applied';
end;
$$;

revoke all on function public.apply_stripe_entitlement_event(
  text,
  bigint,
  text,
  text,
  text,
  text,
  text,
  timestamptz
) from public, anon, authenticated, service_role;

grant execute on function public.apply_stripe_entitlement_event(
  text,
  bigint,
  text,
  text,
  text,
  text,
  text,
  timestamptz
) to service_role;

-- 6) CHECKOUT SINGLE-FLIGHT: reserve one immutable Stripe request per account.
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
