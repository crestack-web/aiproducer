# Phase 4 — Auth, onboarding, app shell wired to backend

## Product path

```
/ (welcome)
  → /auth?mode=login|signup   (Supabase Auth)
  → /onboarding               (profile: name, role, genre, level)
  → /app                      (create project → generate-beat → analyze)
  → /app/projects/:id         (beat player + recording tasks from API)
```

## Required Supabase SQL

```sql
alter table public.profiles
  add column if not exists role text,
  add column if not exists genre text,
  add column if not exists experience_level text,
  add column if not exists onboarding_completed_at timestamptz;
```

Enable Email auth. Set `DEV_MODE=true` for free mock beat/blueprint.
