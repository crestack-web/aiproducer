# Phase 3 — Analyze + blueprint + recording tasks

## Endpoints

| Method | Path | DEV_MODE |
|--------|------|----------|
| POST | `/api/projects/:id/analyze` | Deterministic analysis + sections + tasks |
| GET | `/api/projects/:id/blueprint` | Sections with nested tasks |
| GET | `/api/projects/:id/recording-tasks` | Flat ordered task list for Producer Session |

## Flow

```
generate-beat (Phase 2)
  → POST .../analyze
  → sections + recording_tasks in DB
  → GET .../blueprint  (UI song plan)
  → GET .../recording-tasks  (session)
  → POST .../recording-tasks/:id/recordings  (upload voice)
```

## lib/blueprint.ts

Genre-aware templates (Afrobeats / Hip-Hop / R&B default) with lead, double, harmony, adlib, hum — same idea as the frontend mock.

## Next

- Wire `studio-app` UI to these APIs
- Real MediaRecorder in the client
- Optional: cheap LLM blueprint when DEV_MODE=false
