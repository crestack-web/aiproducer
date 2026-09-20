# AP — Next.js web + shared image for production worker
# Node 22: @supabase/* packages require engines.node >= 22
FROM node:22-bookworm-slim AS base
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    ca-certificates \
    curl \
    python3 \
    make \
    g++ \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# Reduce flaky npm “Exit handler never called!” on constrained builders
ENV NODE_OPTIONS="--max-old-space-size=4096"
ENV npm_config_audit=false
ENV npm_config_fund=false
ENV npm_config_fetch_retries=5
ENV npm_config_fetch_retry_mintimeout=20000
ENV npm_config_fetch_retry_maxtimeout=120000
ENV npm_config_fetch_timeout=300000
ENV npm_config_progress=false
ENV npm_config_loglevel=warn

# --- dependencies ---
FROM base AS deps
# Newer npm is more stable than the image default for large trees / long installs
RUN npm install -g npm@11.6.2
COPY package.json package-lock.json ./
# Prefer lockfile install; fall back to npm install if npm crashes mid-ci
RUN npm ci --include=dev \
  || (echo "npm ci failed — retrying with npm install" && rm -rf node_modules && npm install --include=dev) \
  && test -e node_modules/next/package.json \
  && test -x node_modules/.bin/next

# --- build Next.js ---
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package.json ./package.json
COPY --from=deps /app/package-lock.json ./package-lock.json
COPY . .
ENV PATH="/app/node_modules/.bin:${PATH}"
RUN npm run build

# --- production runner (web + worker share this image) ---
FROM base AS runner
ENV NODE_ENV=production
ENV PATH="/app/node_modules/.bin:${PATH}"
ENV FFMPEG_PATH=/usr/bin/ffmpeg

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package.json ./package.json
COPY --from=deps /app/package-lock.json ./package-lock.json
RUN npm prune --omit=dev \
  && test -e node_modules/next/package.json

COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/app ./app
COPY --from=builder /app/components ./components
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/workers ./workers
COPY --from=builder /app/middleware.ts ./middleware.ts

EXPOSE 3000
CMD ["npm", "run", "start"]
