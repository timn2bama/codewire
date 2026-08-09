-- Remove legacy broad default grants before granting the minimum Data API
-- privileges needed by the client. RLS remains the row-level authority.
revoke all on public.profiles, public.jobs, public.saved_calcs
  from anon, authenticated;
grant select on public.profiles to authenticated;
grant select, insert, update, delete on public.jobs, public.saved_calcs
  to authenticated;
