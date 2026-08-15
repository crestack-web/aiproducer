# Phase 5 — Production Blueprint & AI Producer tasks

## Principle

This is **not** a DAW. Users never see tracks, stems, EQ, or routing.

They experience:

> Listen → Perform → Listen → Perform → Finish

## Two blueprints

| Blueprint | Answers |
|-----------|---------|
| **Song** | What are the sections? |
| **Production** | What does each section need to sound professional? |

## ProductionPlanner (`lib/production-planner.ts`)

Genre/energy-aware tasks with human titles, instructions, reasons.
Priority types: LEAD, DOUBLE, HIGH_HARMONY, BACKGROUND, ADLIB, CALL_RESPONSE.

## API

`POST /api/projects/:id/analyze` returns song + production blueprints.

## SQL

```sql
alter table public.recording_tasks
  add column if not exists title text,
  add column if not exists reason text,
  add column if not exists depends_on uuid references public.recording_tasks(id) on delete set null;
```
