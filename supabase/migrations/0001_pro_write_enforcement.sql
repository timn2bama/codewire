-- Codewire migration 0001 — enforce Pro entitlement for cloud-sync WRITES at the
-- database level (RLS), so the paywall cannot be bypassed by a modified client.
--
-- Model:
--   SELECT / DELETE  -> allowed for any signed-in owner (a downgraded user must
--                       never lose read access to, or the ability to clean up,
--                       data they already synced).
--   INSERT / UPDATE  -> allowed only for owners whose subscription is Pro
--                       ('active' or 'trialing'). Uploading/changing cloud rows
--                       is the paid action.
--
-- Idempotent: safe to run more than once. Run in the Supabase SQL editor.

-- Bootstrap the sync tables when replaying migrations into a fresh project.
-- The original schema lived only in schema.sql, which made migration replay
-- fail before this policy migration could run.
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  stripe_customer_id text unique,
  plan text,
  status text not null default 'free',
  current_period_end timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.jobs (
  id text primary key,
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
  deleted boolean not null default false
);

create table if not exists public.saved_calcs (
  id text primary key,
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
  deleted boolean not null default false
);

alter table public.profiles enable row level security;
alter table public.jobs enable row level security;
alter table public.saved_calcs enable row level security;

-- 1) Entitlement helper. SECURITY DEFINER so the check reads profiles.status
--    regardless of the caller's RLS; it only ever returns a boolean.
create or replace function public.is_pro(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = uid
      and p.status in ('active', 'trialing')
  );
$$;

-- 2) JOBS — replace the single "for all" policy with per-command policies.
drop policy if exists "jobs_all_own"     on public.jobs;
drop policy if exists "jobs_select_own"  on public.jobs;
drop policy if exists "jobs_delete_own"  on public.jobs;
drop policy if exists "jobs_insert_pro"  on public.jobs;
drop policy if exists "jobs_update_pro"  on public.jobs;

create policy "jobs_select_own" on public.jobs
  for select using (auth.uid() = user_id);

create policy "jobs_delete_own" on public.jobs
  for delete using (auth.uid() = user_id);

create policy "jobs_insert_pro" on public.jobs
  for insert with check (auth.uid() = user_id and public.is_pro(auth.uid()));

create policy "jobs_update_pro" on public.jobs
  for update using (auth.uid() = user_id)
  with check (auth.uid() = user_id and public.is_pro(auth.uid()));

-- 3) SAVED_CALCS — same split.
drop policy if exists "saved_calcs_all_own"    on public.saved_calcs;
drop policy if exists "saved_calcs_select_own" on public.saved_calcs;
drop policy if exists "saved_calcs_delete_own" on public.saved_calcs;
drop policy if exists "saved_calcs_insert_pro" on public.saved_calcs;
drop policy if exists "saved_calcs_update_pro" on public.saved_calcs;

create policy "saved_calcs_select_own" on public.saved_calcs
  for select using (auth.uid() = user_id);

create policy "saved_calcs_delete_own" on public.saved_calcs
  for delete using (auth.uid() = user_id);

create policy "saved_calcs_insert_pro" on public.saved_calcs
  for insert with check (auth.uid() = user_id and public.is_pro(auth.uid()));

create policy "saved_calcs_update_pro" on public.saved_calcs
  for update using (auth.uid() = user_id)
  with check (auth.uid() = user_id and public.is_pro(auth.uid()));
