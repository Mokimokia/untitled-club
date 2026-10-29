-- Core tables for the Untitled Club listening session.
create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Untitled Club',
  code_hash text not null unique,
  status text not null default 'draft'
    constraint sessions_status_check check (status in ('draft','open','closed')),
  active_track_id uuid null,
  timer_duration_seconds integer not null default 180
    constraint sessions_timer_duration_seconds_check check (timer_duration_seconds > 0),
  timer_deadline_at timestamptz null,
  timer_running boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.tracks (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  name text not null,
  track_type text not null default 'unreleased'
    constraint tracks_track_type_check check (track_type in ('reference','unreleased')),
  position integer not null
    constraint tracks_position_check check (position > 0),
  status text not null default 'pending'
    constraint tracks_status_check check (status in ('pending','released','closed')),
  created_at timestamptz not null default now(),
  constraint tracks_session_id_position_key unique (session_id, position),
  constraint tracks_id_session_id_key unique (id, session_id)
);

alter table public.sessions
  add constraint sessions_active_track_fk
  foreign key (active_track_id) references public.tracks(id) on delete set null;

create table public.participants (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  display_name text not null
    constraint participants_display_name_check check (char_length(trim(display_name)) between 1 and 80),
  token_hash text not null unique,
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  constraint participants_id_session_id_key unique (id, session_id)
);

create table public.ratings (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  participant_id uuid not null,
  track_id uuid not null,
  initial_impression numeric null,
  melody numeric null,
  composition numeric null,
  production numeric null,
  vocal_performance numeric null,
  originality numeric null,
  emotional_connection numeric null,
  commercial_potential numeric null,
  replay_memorability numeric null,
  overall numeric null,
  liked text null,
  improve text null,
  is_submitted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  submitted_at timestamptz null,
  constraint ratings_participant_id_session_id_fkey
    foreign key (participant_id, session_id)
    references public.participants(id, session_id) on delete cascade,
  constraint ratings_track_id_session_id_fkey
    foreign key (track_id, session_id)
    references public.tracks(id, session_id) on delete cascade,
  constraint ratings_participant_id_track_id_key unique (participant_id, track_id)
);

alter table public.ratings
  add constraint ratings_initial_impression_check check (initial_impression is null or (initial_impression between 0 and 10 and initial_impression * 2 = round(initial_impression * 2))),
  add constraint ratings_melody_check check (melody is null or (melody between 0 and 10 and melody * 2 = round(melody * 2))),
  add constraint ratings_composition_check check (composition is null or (composition between 0 and 10 and composition * 2 = round(composition * 2))),
  add constraint ratings_production_check check (production is null or (production between 0 and 10 and production * 2 = round(production * 2))),
  add constraint ratings_vocal_performance_check check (vocal_performance is null or (vocal_performance between 0 and 10 and vocal_performance * 2 = round(vocal_performance * 2))),
  add constraint ratings_originality_check check (originality is null or (originality between 0 and 10 and originality * 2 = round(originality * 2))),
  add constraint ratings_emotional_connection_check check (emotional_connection is null or (emotional_connection between 0 and 10 and emotional_connection * 2 = round(emotional_connection * 2))),
  add constraint ratings_commercial_potential_check check (commercial_potential is null or (commercial_potential between 0 and 10 and commercial_potential * 2 = round(commercial_potential * 2))),
  add constraint ratings_replay_memorability_check check (replay_memorability is null or (replay_memorability between 0 and 10 and replay_memorability * 2 = round(replay_memorability * 2))),
  add constraint ratings_overall_check check (overall is null or (overall between 0 and 10 and overall * 2 = round(overall * 2)));

create index tracks_session_position_idx on public.tracks(session_id, position);
create index participants_session_idx on public.participants(session_id);
create index ratings_participant_idx on public.ratings(participant_id);
create index ratings_session_track_idx on public.ratings(session_id, track_id);

alter table public.sessions enable row level security;
alter table public.tracks enable row level security;
alter table public.participants enable row level security;
alter table public.ratings enable row level security;

revoke all on table public.sessions, public.tracks, public.participants, public.ratings from anon, authenticated;
grant all on table public.sessions, public.tracks, public.participants, public.ratings to service_role;
