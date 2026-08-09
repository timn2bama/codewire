-- This version is already recorded in production. The profiles bootstrap was
-- added locally so a clean `supabase db reset` can replay the historical body
-- against an empty database; production already had this table when it ran.
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  stripe_customer_id text unique,
  plan text,
  status text not null default 'free',
  current_period_end timestamptz,
  updated_at timestamptz not null default now()
);

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

revoke execute on function public.handle_new_user()
  from public, anon, authenticated;

create or replace function public.is_pro(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = uid and p.status in ('active', 'trialing')
  );
$$;

revoke execute on function public.is_pro(uuid)
  from public, anon, authenticated;
