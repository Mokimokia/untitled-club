-- Allow zero seconds when the shared countdown has expired.
alter table public.sessions
  drop constraint if exists sessions_timer_duration_seconds_check;
alter table public.sessions
  add constraint sessions_timer_duration_seconds_check
  check (timer_duration_seconds >= 0);

-- This Supabase-managed DDL event-trigger helper must not be callable via the public Data API.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
