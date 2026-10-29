-- Entry code is stored as a SHA-256 digest, never as plain text.
ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS entry_code_hash text NULL;
