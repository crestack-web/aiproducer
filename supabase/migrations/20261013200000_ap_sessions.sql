-- AP Sessions: remote collaboration on existing projects
-- Does not duplicate projects; sessions reference projects.id

create type public.ap_session_status as enum (
  'active',
  'paused',
  'ended'
);

create type public.ap_session_role as enum (
  'owner',
  'producer',
  'artist',
  'listener'
);

create table if not exists public.ap_sessions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  name text not null default 'AP Session',
  status public.ap_session_status not null default 'active',
  -- transport state for best-effort sync (Phase 4); kept here for single source of truth
  transport jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index ap_sessions_project_id_idx on public.ap_sessions(project_id);
create index ap_sessions_created_by_idx on public.ap_sessions(created_by);
create index ap_sessions_status_idx on public.ap_sessions(status);

create table if not exists public.ap_session_members (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.ap_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.ap_session_role not null default 'artist',
  -- presence is updated by clients; last_seen_at drives online detection
  last_seen_at timestamptz not null default now(),
  is_recording boolean not null default false,
  is_playing boolean not null default false,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  unique (session_id, user_id)
);

create index ap_session_members_session_id_idx on public.ap_session_members(session_id);
create index ap_session_members_user_id_idx on public.ap_session_members(user_id);

create table if not exists public.ap_session_invites (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.ap_sessions(id) on delete cascade,
  token text not null unique,
  role public.ap_session_role not null default 'artist',
  created_by uuid not null references auth.users(id) on delete cascade,
  invited_email text,
  expires_at timestamptz,
  revoked_at timestamptz,
  accepted_by uuid references auth.users(id) on delete set null,
  accepted_at timestamptz,
  max_uses int not null default 1,
  use_count int not null default 0,
  created_at timestamptz not null default now()
);

create index ap_session_invites_session_id_idx on public.ap_session_invites(session_id);
create index ap_session_invites_token_idx on public.ap_session_invites(token);

-- Chat messages (Phase 3 foundation)
create table if not exists public.ap_session_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.ap_sessions(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  kind text not null default 'user', -- user | system
  body text not null,
  created_at timestamptz not null default now()
);

create index ap_session_messages_session_id_created_idx
  on public.ap_session_messages(session_id, created_at);

-- Contributions / remote takes (Phase 5 foundation)
create type public.ap_contribution_status as enum (
  'uploading',
  'ready',
  'approved',
  'rejected',
  'failed'
);

create table if not exists public.ap_session_contributions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.ap_sessions(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  contributor_id uuid not null references auth.users(id) on delete cascade,
  audio_path text,
  duration_ms int,
  sample_rate int,
  channels int,
  intended_part text,
  take_number int not null default 1,
  status public.ap_contribution_status not null default 'uploading',
  notes text,
  review_notes text,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  recording_task_id uuid references public.recording_tasks(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index ap_session_contributions_session_id_idx on public.ap_session_contributions(session_id);
create index ap_session_contributions_project_id_idx on public.ap_session_contributions(project_id);

-- Activity / revision log (Phase 7 foundation)
create table if not exists public.ap_session_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.ap_sessions(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index ap_session_events_session_id_created_idx
  on public.ap_session_events(session_id, created_at);

-- RLS: members can read session they belong to; owners manage
alter table public.ap_sessions enable row level security;
alter table public.ap_session_members enable row level security;
alter table public.ap_session_invites enable row level security;
alter table public.ap_session_messages enable row level security;
alter table public.ap_session_contributions enable row level security;
alter table public.ap_session_events enable row level security;

-- Helper: is member of session
create or replace function public.is_ap_session_member(sid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.ap_session_members m
    where m.session_id = sid
      and m.user_id = auth.uid()
      and m.left_at is null
  );
$$;

create or replace function public.ap_session_role_of(sid uuid)
returns public.ap_session_role
language sql
stable
security definer
set search_path = public
as $$
  select m.role from public.ap_session_members m
  where m.session_id = sid and m.user_id = auth.uid() and m.left_at is null
  limit 1;
$$;

-- Sessions: project owner can create; members can select active
create policy "ap_sessions_select_member" on public.ap_sessions
  for select using (
    public.is_ap_session_member(id)
    or created_by = auth.uid()
    or exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid())
  );

create policy "ap_sessions_insert_owner" on public.ap_sessions
  for insert with check (
    created_by = auth.uid()
    and exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid())
  );

create policy "ap_sessions_update_owner_producer" on public.ap_sessions
  for update using (
    created_by = auth.uid()
    or public.ap_session_role_of(id) in ('owner', 'producer')
  );

create policy "ap_session_members_select" on public.ap_session_members
  for select using (public.is_ap_session_member(session_id) or user_id = auth.uid());

create policy "ap_session_members_update_self" on public.ap_session_members
  for update using (user_id = auth.uid() or public.ap_session_role_of(session_id) = 'owner');

create policy "ap_session_invites_select" on public.ap_session_invites
  for select using (
    public.ap_session_role_of(session_id) in ('owner', 'producer')
    or created_by = auth.uid()
  );

create policy "ap_session_invites_insert" on public.ap_session_invites
  for insert with check (
    public.ap_session_role_of(session_id) in ('owner', 'producer')
    or exists (
      select 1 from public.ap_sessions s
      where s.id = session_id and s.created_by = auth.uid()
    )
  );

create policy "ap_session_messages_select" on public.ap_session_messages
  for select using (public.is_ap_session_member(session_id));

create policy "ap_session_messages_insert" on public.ap_session_messages
  for insert with check (
    public.is_ap_session_member(session_id)
    and (user_id is null or user_id = auth.uid())
  );

create policy "ap_session_contributions_select" on public.ap_session_contributions
  for select using (public.is_ap_session_member(session_id));

create policy "ap_session_contributions_insert" on public.ap_session_contributions
  for insert with check (
    public.is_ap_session_member(session_id)
    and contributor_id = auth.uid()
  );

create policy "ap_session_events_select" on public.ap_session_events
  for select using (public.is_ap_session_member(session_id));

-- updated_at
create trigger ap_sessions_updated_at before update on public.ap_sessions
  for each row execute function public.set_updated_at();
create trigger ap_session_contributions_updated_at before update on public.ap_session_contributions
  for each row execute function public.set_updated_at();
