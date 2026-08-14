# Studio — AI Music Producer

Create a beat. Get guided through recording. Assemble and mix a complete song with **your real voice**.

> You bring the voice. Your AI producer helps you make the song.

## Repo status

| Layer | Status |
|-------|--------|
| UI prototype | `studio-app.html` (upload full file if still a stub) |
| Backend scaffold | **Phase 1 done** — Next.js 15 + Supabase schema + project APIs |
| Real audio / AI | Not yet — see `docs/BACKEND_BRIEF.md` |

## Quick start (backend)

```bash
git clone https://github.com/crestack-web/aiproducer.git
cd aiproducer
npm install
cp .env.example .env.local
# Fill Supabase URL + keys
npm run dev
```

1. Create a project at [supabase.com](https://supabase.com)
2. Paste env vars into `.env.local`
3. Run `supabase/migrations/20260814000000_init.sql` in the Supabase SQL editor
4. Create a **private** Storage bucket named `studio`
5. Open http://localhost:3000

## APIs (Phase 1)

- `POST /api/projects` — create project
- `GET /api/projects` — list yours
- `GET /api/projects/:id`
- `GET /api/projects/:id/status`
- `GET /api/jobs/:id`

All require Supabase auth. RLS enforces ownership.

## Product flow (UI)

```
Home → Create → Generate beat → Beat Ready
  → AI analyzes → Song Blueprint
  → Producer Session (guided vocal tasks)
  → Assembly → Final song
```

## Responsive UI

- Mobile (< 900px): bottom tabs
- Desktop (≥ 900px): sidebar + grid

## Brand

- Teal `#7BEBD4` — voice
- Brass `#E7A961` — AI producer

## Docs

- `PHASE1.md` — what shipped in this phase
- `docs/BACKEND_BRIEF.md` — full implementation plan

## Next

Phase 2: beat generation (DEV_MODE mock) + storage signed URLs + real mic upload path.
