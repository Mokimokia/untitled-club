-- One shared session and six tracks used by the Pages API.
with session_row as (
  insert into public.sessions (name, code_hash, status, timer_duration_seconds, timer_running)
  values ('Untitled Club', 'untitled-club-sync-session-v1', 'open', 180, false)
  on conflict (code_hash) do update set name = excluded.name
  returning id
), selected_session as (
  select id from session_row
  union all
  select id from public.sessions where code_hash = 'untitled-club-sync-session-v1'
  limit 1
), track_seed(position, name, track_type) as (
  values
    (1, 'Referência 01', 'reference'),
    (2, 'Referência 02', 'reference'),
    (3, 'Referência 03', 'reference'),
    (4, 'Inédita 01', 'unreleased'),
    (5, 'Inédita 02', 'unreleased'),
    (6, 'Inédita 03', 'unreleased')
)
insert into public.tracks (session_id, name, track_type, position, status)
select selected_session.id, track_seed.name, track_seed.track_type, track_seed.position, 'pending'
from selected_session cross join track_seed
on conflict (session_id, position)
do update set name = excluded.name, track_type = excluded.track_type;
