-- Complete, idempotent production baseline for Codewire accounts and sync.
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

create index if not exists jobs_user_id_idx on public.jobs (user_id);
create index if not exists saved_calcs_user_id_idx on public.saved_calcs (user_id);
create index if not exists saved_calcs_job_id_idx on public.saved_calcs (job_id);

revoke all on public.profiles, public.jobs, public.saved_calcs from anon, authenticated;
grant select on public.profiles to authenticated;
grant select, insert, update, delete on public.jobs, public.saved_calcs to authenticated;
grant all on public.profiles, public.jobs, public.saved_calcs to service_role;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id) values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;
create or replace function private.is_pro()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.status in ('active', 'trialing')
  );
$$;
revoke all on function private.is_pro() from public, anon;
grant execute on function private.is_pro() to authenticated, service_role;

drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select to authenticated using ((select auth.uid()) = id);

drop policy if exists "jobs_all_own" on public.jobs;
drop policy if exists "jobs_select_own" on public.jobs;
drop policy if exists "jobs_delete_own" on public.jobs;
drop policy if exists "jobs_insert_pro" on public.jobs;
drop policy if exists "jobs_update_pro" on public.jobs;
create policy "jobs_select_own" on public.jobs
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "jobs_delete_own" on public.jobs
  for delete to authenticated using ((select auth.uid()) = user_id);
create policy "jobs_insert_pro" on public.jobs
  for insert to authenticated
  with check ((select auth.uid()) = user_id and (select private.is_pro()));
create policy "jobs_update_pro" on public.jobs
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id and (select private.is_pro()));

drop policy if exists "saved_calcs_all_own" on public.saved_calcs;
drop policy if exists "saved_calcs_select_own" on public.saved_calcs;
drop policy if exists "saved_calcs_delete_own" on public.saved_calcs;
drop policy if exists "saved_calcs_insert_pro" on public.saved_calcs;
drop policy if exists "saved_calcs_update_pro" on public.saved_calcs;
create policy "saved_calcs_select_own" on public.saved_calcs
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "saved_calcs_delete_own" on public.saved_calcs
  for delete to authenticated using ((select auth.uid()) = user_id);
create policy "saved_calcs_insert_pro" on public.saved_calcs
  for insert to authenticated
  with check ((select auth.uid()) = user_id and (select private.is_pro()));
create policy "saved_calcs_update_pro" on public.saved_calcs
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id and (select private.is_pro()));

-- Remove the exposed legacy helper only after every dependent policy has been
-- replaced with private.is_pro().
drop function if exists public.is_pro(uuid);
