CREATE OR REPLACE FUNCTION public.replace_listening_session(
  p_session_id uuid,
  p_session_name text,
  p_entry_code_hash text,
  p_tracks jsonb,
  p_participants jsonb,
  p_ratings jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.sessions
    WHERE id = p_session_id
      AND code_hash = 'untitled-club-sync-session-v1'
  ) THEN
    RAISE EXCEPTION 'Session not found';
  END IF;

  IF jsonb_typeof(p_tracks) <> 'array'
     OR jsonb_typeof(p_participants) <> 'array'
     OR jsonb_typeof(p_ratings) <> 'array' THEN
    RAISE EXCEPTION 'Invalid session backup payload';
  END IF;

  DELETE FROM public.ratings WHERE session_id = p_session_id;
  DELETE FROM public.participants WHERE session_id = p_session_id;
  DELETE FROM public.tracks WHERE session_id = p_session_id;

  UPDATE public.sessions
  SET name = left(coalesce(nullif(trim(p_session_name), ''), 'Untitled Club'), 120),
      status = 'open',
      active_track_id = NULL,
      timer_duration_seconds = 180,
      timer_deadline_at = NULL,
      timer_running = false,
      entry_code_hash = p_entry_code_hash,
      updated_at = now()
  WHERE id = p_session_id;

  INSERT INTO public.tracks (id, session_id, name, track_type, position, status)
  SELECT
    (item->>'id')::uuid,
    p_session_id,
    left(coalesce(nullif(trim(item->>'name'), ''), 'Faixa'), 120),
    CASE WHEN item->>'track_type' = 'reference' THEN 'reference' ELSE 'unreleased' END,
    (item->>'position')::integer,
    CASE WHEN item->>'status' IN ('released','closed') THEN item->>'status' ELSE 'pending' END
  FROM pg_catalog.jsonb_array_elements(p_tracks) AS item
  ORDER BY (item->>'position')::integer;

  UPDATE public.sessions
  SET active_track_id = (
    SELECT t.id FROM public.tracks t
    WHERE t.session_id = p_session_id AND t.status = 'released'
    ORDER BY t.position LIMIT 1
  )
  WHERE id = p_session_id;

  INSERT INTO public.participants (id, session_id, display_name, token_hash, joined_at, last_seen_at)
  SELECT
    (item->>'id')::uuid,
    p_session_id,
    left(coalesce(nullif(trim(item->>'display_name'), ''), 'Participante'), 80),
    item->>'token_hash',
    coalesce(nullif(item->>'joined_at','')::timestamptz, now()),
    coalesce(nullif(item->>'last_seen_at','')::timestamptz, now())
  FROM pg_catalog.jsonb_array_elements(p_participants) AS item;

  INSERT INTO public.ratings (
    id, session_id, participant_id, track_id,
    initial_impression, melody, composition, production, vocal_performance,
    originality, emotional_connection, commercial_potential, replay_memorability, overall,
    liked, improve, is_submitted, created_at, updated_at, submitted_at
  )
  SELECT
    (item->>'id')::uuid,
    p_session_id,
    (item->>'participant_id')::uuid,
    (item->>'track_id')::uuid,
    nullif(item->>'initial_impression','')::numeric,
    nullif(item->>'melody','')::numeric,
    nullif(item->>'composition','')::numeric,
    nullif(item->>'production','')::numeric,
    nullif(item->>'vocal_performance','')::numeric,
    nullif(item->>'originality','')::numeric,
    nullif(item->>'emotional_connection','')::numeric,
    nullif(item->>'commercial_potential','')::numeric,
    nullif(item->>'replay_memorability','')::numeric,
    nullif(item->>'overall','')::numeric,
    left(coalesce(item->>'liked',''),2000),
    left(coalesce(item->>'improve',''),2000),
    coalesce((item->>'is_submitted')::boolean,false),
    coalesce(nullif(item->>'created_at','')::timestamptz,now()),
    coalesce(nullif(item->>'updated_at','')::timestamptz,now()),
    nullif(item->>'submitted_at','')::timestamptz
  FROM pg_catalog.jsonb_array_elements(p_ratings) AS item;
END;
$$;

REVOKE ALL ON FUNCTION public.replace_listening_session(uuid,text,text,jsonb,jsonb,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_listening_session(uuid,text,text,jsonb,jsonb,jsonb) TO service_role;
