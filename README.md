# Studio — AI Music Producer

Create a beat. Get guided through recording. Finish a real song with **your real voice**.

## Product path (wired)

```
/  welcome
 → /auth          Supabase email auth
 → /onboarding    profile setup
 → /app           create project → generate-beat → analyze
 → /app/projects/:id   beat + recording tasks from API
```

## Setup

```bash
npm install
cp .env.example .env.local
# fill NEXT_PUBLIC_SUPABASE_URL, ANON KEY, SERVICE_ROLE_KEY
# DEV_MODE=true
npm run dev
```

### Supabase

1. Run migrations in SQL editor (init + profile_onboarding)
2. Storage bucket **studio** (private)
3. Auth → Email provider enabled

## Static design prototypes

`/welcome.html`, `/auth.html`, `/onboarding.html`

## Phases

- PHASE1–3: schema, beat mock, analyze/blueprint
- PHASE4: auth + onboarding + app shell wired to APIs
