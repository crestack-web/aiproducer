# Phase 2 — Storage, mock beat, recording upload

## Added

| Endpoint | Behavior |
|----------|----------|
| `POST /api/projects/:id/generate-beat` | DEV_MODE writes mock WAV to Storage, creates `beats` row, completes job |
| `GET /api/projects/:id/beat` | Latest beat + signed play URL |
| `GET /api/recording-tasks/:id/recordings` | List takes + signed URLs |
| `POST /api/recording-tasks/:id/recordings` | Multipart `file` upload **or** JSON signed PUT URL |

## Helpers

- `lib/storage.ts` — paths, signed upload/download, server upload
- `lib/dev-mock.ts` — free mock WAV for DEV_MODE

## Test (with auth session)

1. Sign in (Supabase Auth)
2. `POST /api/projects` → `{ "title": "Test", "genre": "R&B", "mood": "Emotional", "tempo": 90 }`
3. `POST /api/projects/{id}/generate-beat` → beat ready (DEV_MODE)
4. `GET /api/projects/{id}/beat` → `audio_url` to play
5. Insert a recording_task manually or via later blueprint API, then:
   - `POST /api/recording-tasks/{taskId}/recordings` with `FormData` field `file`

## Storage layout

```
studio/
  users/{userId}/projects/{projectId}/
    beats/beat-dev.wav
    recordings/{taskId}/take-1.webm
```

Bucket must be **private**; only signed URLs are used.

## Next (Phase 3)

- Seed DEV recording tasks without full LLM
- Analyze + blueprint endpoints
- Wire UI screens to these APIs
