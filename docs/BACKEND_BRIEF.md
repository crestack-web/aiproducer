# Studio — Backend Implementation Brief

## Context

Lead backend engineer brief for **Studio**, an AI Music Producer product.

**What already exists**
- Complete frontend UI prototype (React) with full product flow
- Design system, screens, guided recording UX
- **No backend, database, auth, storage, real audio, or AI APIs yet**

**Core idea**
Not a pure AI music generator. The user brings their **real voice**. The AI acts as a **producer**: analyzes the beat, plans structure, guides section-by-section recording, then assembles, processes, mixes, and masters.

Promise: *You bring the voice. Your AI producer helps you make the song.*

## Frontend flow (built)

Home → Create → Generate beat → Beat Ready → Analyze → Song Blueprint → Producer Session → Assembly → Final

All AI and recording in the UI is currently **mock**. No MediaRecorder, uploads, or API calls.

## Target architecture (MVP)

```
Browser (Studio UI)
  → Next.js (API routes / server actions)
  → Supabase (Auth, Postgres + RLS, Storage, Realtime)
  → Background worker
       Beat gen | Analysis | LLM blueprint | Vocal process | Assembly | Mix/Master
```

Avoid for V1: Kubernetes, microservices, multiple DBs, custom GPU infra.

## Database entities

profiles, projects, beats, song_sections, recording_tasks, recordings, songs, jobs

Protect all user data with Row Level Security.

## Storage

```
users/{userId}/projects/{projectId}/
  beats/ recordings/ processed-vocals/ mixes/ masters/ guides/
```

Signed URLs only. Never public private user audio.

## Core APIs (MVP)

POST/GET projects, generate-beat, beat, analyze, blueprint, recording-tasks,
recordings upload, assemble, mix, master, jobs/:id, status

## Rules

1. Do not hardcode musical structure in the frontend — backend owns recording_tasks.
2. User real voice is primary — do not replace with AI vocals by default.
3. Long work is async via jobs table.
4. DEV_MODE must exist (mock beat/blueprint/mix) to avoid burning API credits.
5. Budget control: cache analysis/blueprints, cheap LLM for planning, idempotent expensive ops.
6. Security: server-side auth; provider keys never on the client.

## Implementation order

1. Scaffold Next.js + Supabase + env
2. Auth + projects schema + RLS
3. Storage + signed URLs
4. Project APIs
5. Beat generation (or DEV mock)
6. Real mic record + upload + replay
7. Audio analysis
8. LLM song blueprint (Zod-validated JSON)
9. Recording task engine
10. Vocal processing (FFmpeg-first)
11. Assembly
12. Mix / Master (adapter pattern)
13. Wire UI to APIs
14. Error handling + observability

**First milestone:** one complete R&B song path — generate → analyze → blueprint → record lead (+ one layer) → assemble → basic mix → playable result.

## External services to evaluate

| Need | Options |
|------|---------|
| Instrumental | Stable Audio, MusicGen (Replicate), instrumental-only providers |
| LLM blueprint | GPT-4o-mini / Claude Haiku / Gemini Flash |
| Vocal process | FFmpeg first |
| Mix / Master | RoEx Tonn, LANDR, or local FFmpeg — use provider adapter |
| Jobs | Supabase Edge, Inngest, or simple Node worker |

Priority: working product > sophisticated architecture. Budget-constrained.
