-- Measured capture offset relative to musical section start.
-- Convention: recording_offset_ms = actualRecorderStart - expectedMusicalStart
-- placement_start_ms = section_start + recording_offset_ms (vocal file t=0)

alter table public.recordings
  add column if not exists recording_offset_ms int not null default 0;

comment on column public.recordings.recording_offset_ms is
  'Measured ms: actual MediaRecorder start minus expected musical section start. Positive = recorder late. placement = musical_start + recording_offset_ms';
