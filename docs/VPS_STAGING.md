# AP — VPS staging (Phase 3)

Infrastructure only. Supabase stays managed. Vercel remains rollback until staging E2E passes.

## Architecture

```
Internet → Cloudflare → VPS → Caddy (HTTPS) → Docker: web:3000
                                              Docker: worker (internal)
                                                      ↓ FFmpeg
                                                      ↓ Supabase (DB/Auth/Storage)
```

Worker has **no public ports**.

## Server preparation

1. Ubuntu 22.04+ (or similar) VPS — start modest (2–4 vCPU, 4–8 GB RAM).
2. Install Docker Engine + Compose plugin.
3. Open firewall: **80**, **443** (and SSH). Do **not** publish worker ports.
4. Point a **staging** hostname (e.g. `staging.your-domain.com`) at the VPS IP in Cloudflare (proxy optional).

## Environment

```bash
git clone https://github.com/crestack-web/aiproducer.git
cd aiproducer
cp .env.example .env
# Edit .env — fill secrets (never commit .env)
```

### Variable groups (names only)

**Public / browser**

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

**Server secrets**

- `SUPABASE_SERVICE_ROLE_KEY`
- `STORAGE_BUCKET` (optional)
- `MISTRAL_API_KEY`, `MISTRAL_MODEL`, `MISTRAL_TRANSCRIBE_MODEL`
- `REPLICATE_API_TOKEN` / related Replicate vars
- `ELEVENLABS_*`, `OPENAI_API_KEY` (if used)
- `PAYSTACK_SECRET_KEY`, `PAYSTACK_PUBLIC_KEY`
- `ROEX_*` (if used)

**Runtime**

- `NODE_ENV=production`
- `FFMPEG_PATH=/usr/bin/ffmpeg` (set in Compose; matches image)

**Worker (optional)**

- `WORKER_ID`, `WORKER_POLL_MS`, `WORKER_TICK_MS`

## Deploy

```bash
docker compose build
docker compose up -d
docker compose ps
```

Expected: **web** and **worker** both `running` / `restart: unless-stopped`.

### Caddy (HTTPS) on the host

Install Caddy on the VPS (or run a Caddy container). Use `deploy/Caddyfile`:

- Replace `staging.example.com` with your staging host.
- Proxy to `127.0.0.1:3000` if Caddy is on the host, or to `web:3000` if Caddy is on the Compose network.

Example host Caddyfile snippet:

```
staging.your-domain.com {
  encode gzip
  reverse_proxy 127.0.0.1:3000
}
```

Do **not** reverse-proxy the worker.

## Verification checklist

```bash
# Health (on VPS)
curl -i http://localhost:3000/api/health

# FFmpeg inside worker
docker compose exec worker which ffmpeg
docker compose exec worker ffmpeg -version

# Logs
docker compose logs --tail=100 web
docker compose logs --tail=100 worker
```

Worker logs should show JSON events like `WORKER_STARTED` and idle polling (no crash loop).

### Real Produce E2E (required before production DNS)

1. Sign in on the staging origin.
2. Project + beat + at least one vocal take.
3. Tap **Produce**.
4. Confirm: `POST /produce` → **202** + job id → job **queued** → worker **claims** → **processing** → **complete** → audio in **Supabase Storage** → UI play/download.

### Worker restart recovery

```bash
docker compose restart worker
docker compose logs --tail=200 worker
```

In-flight jobs should resume via checkpoint / stale reclaim (15 min threshold). Do not intentionally corrupt jobs.

## Supabase Auth (manual)

When the staging domain exists, in Supabase Dashboard:

**Authentication → URL configuration**

- **Site URL**: `https://staging.your-domain.com` (or keep production Site URL and only add redirects)
- **Redirect URLs**: add  
  - `https://staging.your-domain.com/**`  
  - `https://staging.your-domain.com/auth/callback` (and any app-specific auth paths you use)

Do **not** remove production URLs until cutover.

## Update

```bash
git pull
docker compose build
docker compose up -d
```

Brief downtime is acceptable for staging.

## Rollback

```bash
git checkout <previous-good-sha>
docker compose build
docker compose up -d
```

Or point Cloudflare DNS back to **Vercel** and leave the VPS running for debug.

## Restart after reboot

Compose uses `restart: unless-stopped` for **web** and **worker**. Ensure Docker starts on boot (`systemctl enable docker`).

## Resource notes

- **CPU-heavy**: FFmpeg convert/export, DSP produce ticks.
- **RAM-heavy**: Next.js + decode/mix buffers for one song.
- **Concurrency**: one worker process; jobs claimed one-at-a-time (serialized production). Reliability over throughput for first VPS.

## Cloudflare

- Create **A/AAAA** (or CNAME) for staging → VPS IP.
- Proxy orange-cloud optional; if proxied, ensure HTTPS/SSL mode compatible with Caddy (Full or Full strict).
- **Do not** change production apex/DNS until staging E2E is green.

## What not to do yet

- Cancel Vercel  
- Change production DNS  
- Migrate Supabase  
- Expose worker ports  
- Store permanent audio on VPS disk  
