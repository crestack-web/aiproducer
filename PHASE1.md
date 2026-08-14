# Phase 1 complete — Scaffold

## What was added

- Next.js 15 App Router + TypeScript
- Supabase clients (browser + server + service role)
- Auth helper (`requireUser`)
- Initial SQL migration with full MVP schema + RLS
- Project APIs: create, list, get, status
- Job status API
- DEV_MODE flag via `.env.example`

## Your setup steps

1. Clone the repo and `npm install`
2. Create a Supabase project at https://supabase.com
3. Copy `.env.example` → `.env.local` and fill keys
4. Run the migration in Supabase SQL editor (or `supabase db push` if CLI linked)
5. Create a private Storage bucket `studio` (paths: users/{userId}/projects/...)
6. `npm run dev` → http://localhost:3000

## Schema tables

profiles, projects, beats, song_sections, recording_tasks, recordings, songs, jobs

All protected with RLS (user owns projects; related rows via project ownership).

## Next phase

Phase 2 / Step 5–6: beat generation endpoint + DEV_MODE mock beat + storage signed URLs.
