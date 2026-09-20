
## Produce quality modes

| Env | Behavior |
|-----|----------|
| **`PRODUCE_FULL_QUALITY=1`** (default) | Full AP engine: restoration, analysis, Producer Mind, fullness, mix, master, QC. Multi-tick checkpoints. Can take several minutes. |
| **`PRODUCE_FULL_QUALITY=0`** or **`PRODUCE_FAST=1`** | Fast mix only (timeline assemble + light polish). Explicit opt-in for debugging or low-latency experiments — **not** the product default. |

The Railway worker and `docker-compose` worker service must set `PRODUCE_FULL_QUALITY=1` unless you intentionally want the fast path.

Web (Vercel) must set `PRODUCE_EXECUTION=worker` so produce is enqueued for the worker instead of running inline on Vercel time limits.
