-- Keep billing fields server-managed and move the entitlement helper out of
-- the exposed public schema. The helper derives identity from auth.uid(), so a
-- caller cannot ask about another account's subscription.

drop policy if exists "profiles_update_own" on public.profiles;

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
    where p.id = (select auth.uid())
      and p.status in ('active', 'trialing')
  );
$$;

revoke all on function private.is_pro() from public, anon;
grant execute on function private.is_pro() to authenticated, service_role;

drop policy if exists "jobs_insert_pro" on public.jobs;
drop policy if exists "jobs_update_pro" on public.jobs;
drop policy if exists "saved_calcs_insert_pro" on public.saved_calcs;
drop policy if exists "saved_calcs_update_pro" on public.saved_calcs;

create policy "jobs_insert_pro" on public.jobs
  for insert to authenticated
  with check ((select auth.uid()) = user_id and (select private.is_pro()));
create policy "jobs_update_pro" on public.jobs
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id and (select private.is_pro()));
create policy "saved_calcs_insert_pro" on public.saved_calcs
  for insert to authenticated
  with check ((select auth.uid()) = user_id and (select private.is_pro()));
create policy "saved_calcs_update_pro" on public.saved_calcs
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id and (select private.is_pro()));

drop function if exists public.is_pro(uuid);
