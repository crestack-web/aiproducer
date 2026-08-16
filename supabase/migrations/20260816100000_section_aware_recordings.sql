-- Section-aware vocal recording: additive only. Does not rename/drop existing columns.

-- Musical position on sections (bars). start_ms/end_ms remain source timestamps.
alter table public.song_sections
  add column if not exists start_bar int,
  add column if not exists end_bar int;

comment on column public.song_sections.start_bar is '1-indexed inclusive start bar; derived from BPM + time signature when known';
comment on column public.song_sections.end_bar is '1-indexed inclusive end bar';

-- Project-level meter (optional). BPM remains on projects.tempo / beats.bpm.
alter table public.projects
  add column if not exists time_signature text default '4/4';

alter table public.beats
  add column if not exists time_signature text default '4/4';

-- Recording timeline + alignment (section placement is also mirrored from task)
alter table public.recordings
  add column if not exists timeline_start_ms int,
  add column if not exists timeline_end_ms int,
  add column if not exists original_audio_path text,
  add column if not exists alignment_status text default 'unknown',
  add column if not exists role text;

comment on column public.recordings.timeline_start_ms is 'Intended placement on full-song timeline (ms from 0)';
comment on column public.recordings.timeline_end_ms is 'Intended end on full-song timeline';
comment on column public.recordings.original_audio_path is 'Immutable original upload/recording path before any process/trim';
comment on column public.recordings.alignment_status is 'ok | needs_alignment | unknown';
comment on column public.recordings.role is 'LEAD | DOUBLE | HARMONY | etc — denormalized from task type';

-- Helpful indexes
create index if not exists recordings_timeline_start_idx on public.recordings (project_id, timeline_start_ms);
create index if not exists song_sections_bars_idx on public.song_sections (project_id, start_bar, end_bar);
