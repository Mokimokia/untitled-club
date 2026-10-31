alter table public.sessions
  add column if not exists submission_mode boolean not null default false;
