-- Make Stripe entitlement updates atomic, idempotent, and order-safe.
-- This migration is additive for the existing webhook and must be deployed
-- before the RPC-based webhook client.

create schema if not exists private;

-- This migration intentionally starts a new event-ordering ledger and only
-- supports a zero-linked-customer cutover. Recheck that precondition again
-- immediately before promoting the RPC-based webhook.
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

  -- Serialize all subscription events for a Stripe customer. Hash collisions
  -- only cause harmless extra serialization.
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

  -- Stripe event timestamps have one-second precision. At an exact tie,
  -- non-entitled state wins; event_id is only a deterministic tie-breaker
  -- inside the same entitlement class, not a claim of chronology.
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

  -- Keep the account entitled while any of its current Codewire
  -- subscriptions is entitled. This prevents cancellation of an older
  -- subscription from revoking a newer active subscription.
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
