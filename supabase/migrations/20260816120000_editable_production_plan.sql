-- Editable production plan: AI suggests, artist decides.
-- Preserve AI recommendations; artist plan is a selection over tasks.

alter table public.recording_tasks
  add column if not exists active boolean not null default true,
  add column if not exists selected_in_plan boolean not null default true,
  add column if not exists plan_source text not null default 'ai',
  add column if not exists recommendation text not null default 'optional';

comment on column public.recording_tasks.active is 'false = removed from artist plan; row kept for history/restore';
comment on column public.recording_tasks.selected_in_plan is 'Artist included this task in the active production plan';
comment on column public.recording_tasks.plan_source is 'ai | artist | restored_ai';
comment on column public.recording_tasks.recommendation is 'AI signal only: recommended | optional — never blocks produce';

-- Soft-remove index helpers
create index if not exists recording_tasks_active_plan_idx
  on public.recording_tasks (project_id, active, selected_in_plan)
  where active = true;

-- Snapshot of original AI plan lives on projects.metadata.ai_plan (jsonb, no schema change).
-- plan_mode: ai | customize | scratch lives on projects.metadata.plan_mode.
