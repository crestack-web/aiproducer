# AP — Next.js web + shared image for production worker
FROM node:20-bookworm-slim AS base
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    ca-certificates \
    curl \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# --- dependencies (full install for Next build; Railway often sets NODE_ENV=production) ---
FROM base AS deps
COPY package.json package-lock.json ./
# --include=dev keeps typescript/types available even when NODE_ENV=production
RUN npm ci --include=dev \
  && test -e node_modules/next/package.json \
  && test -x node_modules/.bin/next

# --- build Next.js ---
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package.json ./package.json
COPY --from=deps /app/package-lock.json ./package-lock.json
COPY . .
# next must resolve from local node_modules
ENV PATH="/app/node_modules/.bin:${PATH}"
RUN npm run build

# --- production runner (web + worker share this image) ---
FROM base AS runner
ENV NODE_ENV=production
ENV PATH="/app/node_modules/.bin:${PATH}"
ENV FFMPEG_PATH=/usr/bin/ffmpeg

# Production node_modules only (smaller image)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
  && test -e node_modules/next/package.json

COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/package.json ./package.json
# App source needed by worker (tsx) and any server files outside .next
COPY --from=builder /app/app ./app
COPY --from=builder /app/components ./components
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/workers ./workers
COPY --from=builder /app/middleware.ts ./middleware.ts

EXPOSE 3000
# Default: web. Worker service overrides command to:
# node --import tsx workers/production-worker.ts
CMD ["npm", "run", "start"]
