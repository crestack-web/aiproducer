-- Cost-review log for Try It (clone + generate). Isolated from Record.
create table if not exists public.try_it_usage_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid references public.try_it_sessions(id) on delete set null,
  event text not null check (event in ('clone', 'generate', 'generate_retry')),
  model_tier text,
  duration_sec int,
  success boolean not null default true,
  error_snippet text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists try_it_usage_log_user_id_idx
  on public.try_it_usage_log (user_id, created_at desc);
create index if not exists try_it_usage_log_event_idx
  on public.try_it_usage_log (event, created_at desc);

alter table public.try_it_usage_log enable row level security;

-- Service role writes; users can read their own for transparency
create policy "try_it_usage_own_select" on public.try_it_usage_log
  for select using (auth.uid() = user_id);

comment on table public.try_it_usage_log is
  'Try It cost review: every ElevenLabs clone/generate with user_id, model tier, duration.';
