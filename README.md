# Studio — AI Music Producer

Create a beat. Get guided through recording. Assemble and mix a complete song with **your real voice**.

> You bring the voice. Your AI producer helps you make the song.

## What's here

| File | Description |
|------|-------------|
| `studio-app.html` | **Runnable UI** — open in a browser (React via CDN). Full product flow + responsive desktop layout. |
| `studio-app.tsx` | Same UI as source module (mirrors the HTML, desktop breakpoint at 900px). |
| `docs/BACKEND_BRIEF.md` | Architecture + implementation plan for the backend. |

## Product flow (UI)

```
Home → Create → Generate beat → Beat Ready
  → AI analyzes → Song Blueprint
  → Producer Session (guided vocal tasks)
  → Assembly → Final song
```

## Responsive layout

- **Mobile** (< 900px): full-screen, bottom tab bar, mini player
- **Desktop** (≥ 900px): left sidebar nav, spacious home grid, centered create/producer flows, desktop mini-player bar

## Run the UI now

Open `studio-app.html` in a modern browser. No build step required.

## Backend status

Frontend is a complete interactive prototype. Backend (Supabase, jobs, real audio, AI) is **not** implemented yet.

See `docs/BACKEND_BRIEF.md` for the phased plan.

## Brand

- **Teal** `#7BEBD4` — voice / signal  
- **Brass** `#E7A961` — AI / producer  
- Deep charcoal backgrounds  

## Repo

Private app repo for Studio (AI Producer Session).
