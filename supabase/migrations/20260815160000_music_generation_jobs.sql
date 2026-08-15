create table if not exists public.music_generation_jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'CREATED',
  kind text not null default 'preview',
  provider text not null default 'mock',
  mode text not null default 'mock',
  prompt text,
  genre text,
  mood text,
  bpm int,
  duration_sec int,
  duration_ms int,
  progress int not null default 0,
  stage text,
  audio_path text,
  beat_id uuid references public.beats(id) on delete set null,
  provider_prediction_id text,
  provider_model text,
  idempotency_key text,
  error_type text,
  error_message text,
  input_data jsonb not null default '{}'::jsonb,
  processing_ms int,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create unique index if not exists music_generation_jobs_idempotency_uidx
  on public.music_generation_jobs (idempotency_key)
  where idempotency_key is not null;

create index if not exists music_generation_jobs_user_id_idx on public.music_generation_jobs (user_id);
create index if not exists music_generation_jobs_project_id_idx on public.music_generation_jobs (project_id);
create index if not exists music_generation_jobs_status_idx on public.music_generation_jobs (status);

alter table public.music_generation_jobs enable row level security;

drop policy if exists "music_gen_jobs_owner" on public.music_generation_jobs;
create policy "music_gen_jobs_owner" on public.music_generation_jobs
  for all using (user_id = auth.uid())
  with check (user_id = auth.uid());
