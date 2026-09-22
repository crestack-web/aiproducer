-- Try It: temporary voice-clone previews (isolated from Record pipeline)
create table if not exists public.try_it_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  scope text not null default 'trial' check (scope = 'trial'),
  status text not null default 'created'
    check (status in ('created', 'sample_ready', 'voice_ready', 'generating', 'preview_ready', 'expired', 'failed')),
  eleven_voice_id text,
  sample_path text,
  sample_duration_ms int,
  beat_path text,
  vocal_path text,
  mix_path text,
  genre text,
  tempo int,
  lyrics text,
  error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '48 hours'),
  updated_at timestamptz not null default now()
);

create index if not exists try_it_sessions_user_id_idx on public.try_it_sessions (user_id);
create index if not exists try_it_sessions_expires_at_idx on public.try_it_sessions (expires_at);

alter table public.try_it_sessions enable row level security;

create policy "try_it_own_rows" on public.try_it_sessions
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

comment on table public.try_it_sessions is
  'Isolated Try It previews. Never merge eleven_voice_id into permanent artist voice profiles.';
