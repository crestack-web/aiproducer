-- Booth ⇄ Console one-way hand-off: which side owns a song.
alter table public.projects
  add column if not exists edit_mode text not null default 'booth';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'projects_edit_mode_check'
  ) then
    alter table public.projects
      add constraint projects_edit_mode_check check (edit_mode in ('booth', 'console'));
  end if;
end $$;

comment on column public.projects.edit_mode is
  'booth | console. Once console, the AI plan and analyze routes never edit the song again.';

-- Backfill: songs that already have Console tracks are owned by Console.
update public.projects p
set edit_mode = 'console'
where p.edit_mode = 'booth'
  and exists (
    select 1 from public.recording_tasks t
    where t.project_id = p.id
      and t.plan_source in ('console', 'scratch')
  );

create index if not exists recording_tasks_project_plan_source_idx
  on public.recording_tasks (project_id, plan_source);
