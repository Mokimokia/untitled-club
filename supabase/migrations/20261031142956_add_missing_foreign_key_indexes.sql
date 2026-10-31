-- Cover the three foreign keys flagged by the Supabase Performance Advisor.
create index if not exists ratings_participant_session_fk_idx on public.ratings (participant_id, session_id);
create index if not exists ratings_track_session_fk_idx on public.ratings (track_id, session_id);
create index if not exists sessions_active_track_fk_idx on public.sessions (active_track_id);
