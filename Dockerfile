# AP — Next.js web + shared image for production worker
# Node 22: @supabase/* packages require engines.node >= 22
FROM node:22-bookworm-slim AS base
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    ca-certificates \
    curl \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# --- dependencies (full install for Next build) ---
FROM base AS deps
COPY package.json package-lock.json ./
# Railway may inject NODE_ENV=production; still install devDeps for `next build`
RUN npm ci --include=dev \
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

# Reuse deps install and prune — avoids a second full `npm ci` (Railway npm crash / timeout)
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
# App source needed by worker (tsx) and server routes outside the standalone bundle
COPY --from=builder /app/app ./app
COPY --from=builder /app/components ./components
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/workers ./workers
COPY --from=builder /app/middleware.ts ./middleware.ts

EXPOSE 3000
# Default: web. Worker service overrides command, e.g.:
# npx tsx workers/production-worker.ts
CMD ["npm", "run", "start"]
