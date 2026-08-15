-- Production task fields (AI Producer session — not a DAW)
alter table public.recording_tasks
  add column if not exists title text,
  add column if not exists reason text,
  add column if not exists depends_on uuid references public.recording_tasks(id) on delete set null;

comment on column public.recording_tasks.title is 'Human-facing task title (e.g. Make it bigger)';
comment on column public.recording_tasks.reason is 'Why the producer is asking for this performance';
comment on column public.recording_tasks.instruction is 'Plain-language recording instruction — never DAW jargon';
