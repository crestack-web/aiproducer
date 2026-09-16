# Booth vs Console — product split & anti-drift

## Names (canonical)

| Name | Route | Role |
|------|--------|------|
| **Studio** | `/app/studio` | Product hub: create session, list projects (top-level nav) |
| **Booth** | `/app/studio/[id]` | Guided, non-technical recording flow |
| **Console** | `/app/console/[id]` | AI-DAW timeline (record, trim, arrange, monitor) |

**Route note:** Booth stays at `/app/studio/[id]` (not renamed to `/app/booth/[id]`).
Reason: existing deep links, paystack callbacks, and less migration risk.
The *label* is Booth; the *path segment* `studio` means “in the Studio product.”

Do **not** call Console “Studio” in UI — that collides with the hub nav item.

---

## Shared source of truth (both pages)

- `recording_tasks` (plan layers, status, start/end)
- Recordings / takes under each task
- Song sections / beat
- Produce pipeline (`/api/projects/:id/analyze` → `planProduction()`, produce job)

A take recorded in either page must appear completed in the other.

---

## Feature parity log

| Capability | Booth | Console | Notes |
|------------|-------|---------|-------|
| Guided section-by-section prompts | ✅ | — | Booth-only by design |
| Plan editor / AI recommendations UI | ✅ | partial (timeline markers) | |
| Live vocal capture (mic → MediaRecorder) | ✅ | ✅ | **Same** `openRecordingStream` / `createVocalRecorder` |
| Beat monitor while recording | ✅ | ✅ | Separate from capture stream |
| Upload audio file as take | — | ✅ | Console Add Track → Audio |
| Upload beat + run analyze/plan | create flow | ✅ empty state | **Same** `/beat` + `/analyze` |
| Timeline clip trim / move | — | ✅ | Console-only by design |
| Mute/solo waveform monitor | — | ✅ | Console-only |
| Track FX sheet (monitor) | — | ✅ | Monitor only; not offline AP |
| Produce / master | ✅ | via project | **Same** produce job |
| Mobile bottom nav project switch | ✅ | * | Console is full-screen; use header Booth link |

\* Console currently mounts full-viewport without AppShell; Booth uses AppShell.

---

## Completion-state consistency

Automated: `npm run test:booth-console` (membership + status round-trip helpers).

Manual:

1. Record a take in **Booth** → open **Console** → layer shows waveform / completed.
2. Record a take in **Console** → open **Booth** → task status completed, not still open.
3. Produce on a mix of Booth + Console takes → job succeeds.

---

## Shared-pipeline rule (for PRs)

Any change to recording, plan generation, or mix/master **must** note which shared system it uses, e.g.:

- `// uses planProduction() via POST /api/projects/:id/analyze (same as Booth)`
- `// uses openRecordingStream (Booth live path) — not a parallel recorder`

If you cannot point at an existing module, stop and reuse or extract shared code first.
