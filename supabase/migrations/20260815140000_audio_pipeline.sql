-- Audio pipeline tables and columns
alter table public.recordings
  add column if not exists is_selected boolean not null default false,
  add column if not exists original_path text,
  add column if not exists processed_path text;

update public.recordings set original_path = audio_path
where original_path is null and audio_path is not null;

create unique index if not exists recordings_one_selected_per_task
  on public.recordings (task_id) where is_selected = true;

alter table public.jobs
  add column if not exists idempotency_key text,
  add column if not exists provider text,
  add column if not exists provider_task_id text,
  add column if not exists parent_job_id uuid references public.jobs(id) on delete set null;

create unique index if not exists jobs_idempotency_key_uidx
  on public.jobs (idempotency_key) where idempotency_key is not null;

do $$ begin alter type public.job_type add value if not exists 'PROCESS_VOCAL'; exception when duplicate_object then null; end $$;
do $$ begin alter type public.job_type add value if not exists 'ARRANGE_VOCALS'; exception when duplicate_object then null; end $$;
do $$ begin alter type public.job_type add value if not exists 'RENDER_STEMS'; exception when duplicate_object then null; end $$;
do $$ begin alter type public.job_type add value if not exists 'ANALYZE_MIX'; exception when duplicate_object then null; end $$;
do $$ begin alter type public.job_type add value if not exists 'FINAL_QC'; exception when duplicate_object then null; end $$;
do $$ begin alter type public.job_type add value if not exists 'PRODUCE_SONG'; exception when duplicate_object then null; end $$;

create table if not exists public.audio_stems (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  kind text not null,
  audio_path text not null,
  duration_ms int,
  sample_rate int default 44100,
  channels int default 2,
  bit_depth int default 16,
  order_index int not null default 0,
  source_recording_ids uuid[] default '{}',
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists audio_stems_project_id_idx on public.audio_stems(project_id);
alter table public.audio_stems enable row level security;
drop policy if exists "stems_via_project" on public.audio_stems;
create policy "stems_via_project" on public.audio_stems for all using (
  exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid())
) with check (
  exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid())
);

create table if not exists public.audio_versions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  kind text not null check (kind in ('mix', 'master', 'preview_mix', 'preview_master')),
  version int not null default 1,
  audio_path text not null,
  duration_ms int,
  job_id uuid references public.jobs(id) on delete set null,
  provider text,
  provider_task_id text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (project_id, kind, version)
);
create index if not exists audio_versions_project_id_idx on public.audio_versions(project_id);
alter table public.audio_versions enable row level security;
drop policy if exists "versions_via_project" on public.audio_versions;
create policy "versions_via_project" on public.audio_versions for all using (
  exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid())
) with check (
  exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid())
);

create table if not exists public.quality_checks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  audio_version_id uuid references public.audio_versions(id) on delete cascade,
  stage text not null,
  status text not null check (status in ('pass', 'fail', 'needs_review')),
  metrics jsonb not null default '{}',
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists quality_checks_project_id_idx on public.quality_checks(project_id);
alter table public.quality_checks enable row level security;
drop policy if exists "qc_via_project" on public.quality_checks;
create policy "qc_via_project" on public.quality_checks for all using (
  exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid())
) with check (
  exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid())
);
