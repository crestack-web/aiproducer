# AP Reference Mastering Service

Isolated **Matchering 2.0** (GPL-3.0) microservice for tonal/loudness/width matching.

## Why separate?

Matchering is GPL-3.0. Running it in its own container and calling it over HTTP keeps the main AP Studio (proprietary) codebase free of GPL linkage.

## API

- `GET /health`
- `POST /master` — form fields: `target_audio_url` and/or `target_file`, `reference_audio_url` and/or `reference_file` → `{ job_id, status }`
- `GET /master/:job_id` → `{ status, error, result_ready }`
- `GET /master/:job_id/result` → matched WAV

## Deploy

```bash
docker build -t ap-reference-master .
docker run --rm -p 8080:8080 ap-reference-master
```

Set on the **production worker** (not Vercel public):

```
REF_MASTER_URL=http://reference-master:8080
REF_MASTER_ENABLED=1
```

Network: private only (VPC / Fly private / Cloud Run ingress internal).

## Reference library

Upload commercial WAVs to R2 under:

```
ap-system/references/{genre_key}/{name}.wav
```

Genre keys are defined in `lib/ap-engine/master/reference-library.ts`.
