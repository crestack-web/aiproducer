alter table public.beats
  add column if not exists source text not null default 'ai',
  add column if not exists original_filename text;

create table if not exists public.samples (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null default 'loop',
  title text,
  audio_path text not null,
  original_filename text,
  duration_ms int,
  bpm int,
  key_note text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists samples_project_id_idx on public.samples(project_id);
create index if not exists samples_user_id_idx on public.samples(user_id);

alter table public.samples enable row level security;

drop policy if exists "samples_owner" on public.samples;
create policy "samples_owner" on public.samples
  for all using (user_id = auth.uid())
  with check (user_id = auth.uid());
