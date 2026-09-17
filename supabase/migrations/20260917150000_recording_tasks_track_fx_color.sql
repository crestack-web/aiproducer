-- Producer View: per-task FX rack + display color
alter table public.recording_tasks
  add column if not exists track_fx jsonb not null default '{}'::jsonb;
alter table public.recording_tasks
  add column if not exists track_color text;
comment on column public.recording_tasks.track_fx is
  'Producer View per-track FX parameters (json). Empty object = defaults.';
comment on column public.recording_tasks.track_color is
  'Optional UI color hex for Producer View track chrome, e.g. #E7A961.';
