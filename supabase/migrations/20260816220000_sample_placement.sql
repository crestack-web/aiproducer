-- Placement of loops/samples on the song timeline (ms)
alter table public.samples
  add column if not exists start_ms int,
  add column if not exists end_ms int,
  add column if not exists gain_db real not null default 0,
  add column if not exists include_in_produce boolean not null default true;

comment on column public.samples.start_ms is 'Where the sample begins on the song timeline (ms). Null = start of song.';
comment on column public.samples.end_ms is 'Optional end on song timeline (ms). Null = start_ms + duration.';
comment on column public.samples.include_in_produce is 'When true, sample is sent to mix/master with the arrangement.';
