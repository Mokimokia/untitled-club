create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;
create table if not exists private.rate_limit_buckets (
  bucket_key text primary key,
  window_started_at timestamptz not null,
  hits integer not null check (hits >= 0)
);
revoke all on table private.rate_limit_buckets from public, anon, authenticated;
grant select, insert, update, delete on table private.rate_limit_buckets to service_role;
create or replace function public.consume_rate_limit(p_key text,p_limit integer,p_window_seconds integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare allowed boolean;
begin
  if p_key is null or length(p_key) < 32 or p_limit < 1 or p_window_seconds < 1 then
    raise exception 'Invalid rate limit parameters';
  end if;
  insert into private.rate_limit_buckets(bucket_key,window_started_at,hits)
  values(p_key,clock_timestamp(),1)
  on conflict(bucket_key) do update set
    window_started_at=case when private.rate_limit_buckets.window_started_at+make_interval(secs=>p_window_seconds)<=clock_timestamp() then clock_timestamp() else private.rate_limit_buckets.window_started_at end,
    hits=case when private.rate_limit_buckets.window_started_at+make_interval(secs=>p_window_seconds)<=clock_timestamp() then 1 else private.rate_limit_buckets.hits+1 end
  returning hits<=p_limit into allowed;
  return allowed;
end; $$;
revoke all on function public.consume_rate_limit(text,integer,integer) from public,anon,authenticated;
grant execute on function public.consume_rate_limit(text,integer,integer) to service_role;
