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

-- Pro entitlement helper: true when the user's subscription is active/trialing.
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
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.status in ('active', 'trialing')
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
