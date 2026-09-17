#!/usr/bin/env bash
# Run on the VPS after docker compose up -d
set -euo pipefail
echo "== compose ps =="
docker compose ps
echo "== health =="
curl -sf http://127.0.0.1:3000/api/health | head -c 500
echo
echo "== ffmpeg in worker =="
docker compose exec -T worker which ffmpeg
docker compose exec -T worker ffmpeg -version | head -3
echo "== worker logs (tail) =="
docker compose logs --tail=30 worker
echo "OK — static checks passed. Run a real Produce in the UI next."
