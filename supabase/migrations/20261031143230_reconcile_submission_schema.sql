alter table public.tracks
  add column if not exists internal_comment text;

alter table public.sessions
  add column if not exists submission_mode boolean not null default false;

create table if not exists public.music_submissions (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 100),
  email text not null check (char_length(trim(email)) between 3 and 254),
  social text not null check (char_length(trim(social)) between 1 and 160),
  track1_name text not null check (char_length(trim(track1_name)) between 1 and 160),
  track1_artists text not null check (char_length(trim(track1_artists)) between 1 and 200),
  track1_genre text not null check (char_length(trim(track1_genre)) between 1 and 100),
  track1_file_path text not null,
  track1_file_name text not null,
  track1_file_size bigint not null check (track1_file_size > 0),
  track1_mime_type text not null,
  track2_name text null,
  track2_artists text null,
  track2_genre text null,
  track2_file_path text null,
  track2_file_name text null,
  track2_file_size bigint null,
  track2_mime_type text null,
  submitted_at timestamptz not null default now()
);

create unique index if not exists music_submissions_email_unique
  on public.music_submissions (lower(email));

alter table public.music_submissions enable row level security;
revoke all on table public.music_submissions from anon, authenticated;
grant all on table public.music_submissions to service_role;
