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
  on public.profiles for select using (auth.uid() = id);
create policy "profiles_update_own"
  on public.profiles for update using (auth.uid() = id);

-- Auto-create a free profile when a user signs up.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id) values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Pro entitlement helper: true when the user's subscription is active/trialing.
-- Used by the jobs/saved_calcs WRITE policies so the paywall is enforced in the
-- database, not just the client. SECURITY DEFINER so it can read profiles.status.
create or replace function public.is_pro(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = uid and p.status in ('active', 'trialing')
  );
$$;

-- 2) JOBS: cloud copy of on-device jobs (Pro sync). Client-generated text ids
--    so local and cloud rows line up. `deleted` is a tombstone for sync.
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

alter table public.jobs enable row level security;
-- Read/delete: any owner. Insert/update (the paid cloud-sync write): Pro only.
create policy "jobs_select_own" on public.jobs
  for select using (auth.uid() = user_id);
create policy "jobs_delete_own" on public.jobs
  for delete using (auth.uid() = user_id);
create policy "jobs_insert_pro" on public.jobs
  for insert with check (auth.uid() = user_id and public.is_pro(auth.uid()));
create policy "jobs_update_pro" on public.jobs
  for update using (auth.uid() = user_id)
  with check (auth.uid() = user_id and public.is_pro(auth.uid()));

-- 3) SAVED_CALCS: cloud copy of saved calculations.
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

alter table public.saved_calcs enable row level security;
-- Read/delete: any owner. Insert/update (the paid cloud-sync write): Pro only.
create policy "saved_calcs_select_own" on public.saved_calcs
  for select using (auth.uid() = user_id);
create policy "saved_calcs_delete_own" on public.saved_calcs
  for delete using (auth.uid() = user_id);
create policy "saved_calcs_insert_pro" on public.saved_calcs
  for insert with check (auth.uid() = user_id and public.is_pro(auth.uid()));
create policy "saved_calcs_update_pro" on public.saved_calcs
  for update using (auth.uid() = user_id)
  with check (auth.uid() = user_id and public.is_pro(auth.uid()));
