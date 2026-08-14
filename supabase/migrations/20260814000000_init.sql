-- Studio AI Producer — initial schema
-- Requires: Supabase Auth (auth.users)

-- Profiles (extends auth.users)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id);
create policy "profiles_insert_own" on public.profiles
  for insert with check (auth.uid() = id);

-- Projects
create type public.project_status as enum (
  'draft', 'generating_beat', 'beat_ready', 'analyzing',
  'blueprint_ready', 'recording', 'processing', 'mixing',
  'mastering', 'complete', 'failed'
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Untitled',
  genre text,
  mood text,
  tempo int,
  prompt text,
  status public.project_status not null default 'draft',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index projects_user_id_idx on public.projects(user_id);
alter table public.projects enable row level security;

create policy "projects_all_own" on public.projects
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Beats
create type public.beat_status as enum ('pending', 'generating', 'ready', 'failed');

create table if not exists public.beats (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  audio_path text,
  duration_ms int,
  bpm numeric,
  key text,
  source text default 'ai',
  generation_prompt text,
  status public.beat_status not null default 'pending',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index beats_project_id_idx on public.beats(project_id);
alter table public.beats enable row level security;

create policy "beats_via_project" on public.beats
  for all using (
    exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid())
  ) with check (
    exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid())
  );

-- Song sections
create table if not exists public.song_sections (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  type text not null,
  label text,
  start_ms int not null default 0,
  end_ms int not null default 0,
  order_index int not null default 0,
  energy text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index song_sections_project_id_idx on public.song_sections(project_id);
alter table public.song_sections enable row level security;

create policy "sections_via_project" on public.song_sections
  for all using (
    exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid())
  ) with check (
    exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid())
  );

-- Recording tasks (AI producer plan)
create type public.task_status as enum ('pending', 'in_progress', 'completed', 'skipped');

create table if not exists public.recording_tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  section_id uuid references public.song_sections(id) on delete set null,
  type text not null,
  instruction text not null default '',
  start_ms int,
  end_ms int,
  required boolean not null default true,
  priority int not null default 0,
  status public.task_status not null default 'pending',
  guide_audio_path text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index recording_tasks_project_id_idx on public.recording_tasks(project_id);
alter table public.recording_tasks enable row level security;

create policy "tasks_via_project" on public.recording_tasks
  for all using (
    exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid())
  ) with check (
    exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid())
  );

-- Recordings (user takes)
create type public.recording_status as enum ('uploaded', 'processing', 'ready', 'rejected', 'failed');

create table if not exists public.recordings (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  task_id uuid not null references public.recording_tasks(id) on delete cascade,
  audio_path text not null,
  duration_ms int,
  take_number int not null default 1,
  status public.recording_status not null default 'uploaded',
  quality_score numeric,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index recordings_task_id_idx on public.recordings(task_id);
create index recordings_project_id_idx on public.recordings(project_id);
alter table public.recordings enable row level security;

create policy "recordings_via_project" on public.recordings
  for all using (
    exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid())
  ) with check (
    exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid())
  );

-- Songs (final output)
create type public.song_status as enum ('assembling', 'mixing', 'mastering', 'ready', 'failed');

create table if not exists public.songs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  audio_path text,
  status public.song_status not null default 'assembling',
  duration_ms int,
  version int not null default 1,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index songs_project_id_idx on public.songs(project_id);
alter table public.songs enable row level security;

create policy "songs_via_project" on public.songs
  for all using (
    exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid())
  ) with check (
    exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid())
  );

-- Jobs (async work)
create type public.job_type as enum (
  'GENERATE_BEAT', 'ANALYZE_BEAT', 'CREATE_BLUEPRINT',
  'PROCESS_VOCAL', 'ANALYZE_TAKE', 'ASSEMBLE_SONG',
  'MIX_SONG', 'MASTER_SONG'
);

create type public.job_status as enum (
  'queued', 'processing', 'complete', 'failed', 'cancelled'
);

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  type public.job_type not null,
  status public.job_status not null default 'queued',
  progress int not null default 0 check (progress >= 0 and progress <= 100),
  stage text,
  input_data jsonb not null default '{}'::jsonb,
  output_data jsonb not null default '{}'::jsonb,
  error text,
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);

create index jobs_project_id_idx on public.jobs(project_id);
create index jobs_status_idx on public.jobs(status);
alter table public.jobs enable row level security;

create policy "jobs_via_project" on public.jobs
  for all using (
    exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid())
  ) with check (
    exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid())
  );

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- updated_at helper
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger projects_updated_at before update on public.projects
  for each row execute function public.set_updated_at();
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
