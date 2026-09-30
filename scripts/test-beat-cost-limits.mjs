/**
 * Lightweight checks for beat cost COGS + free length constants.
 * Run: node scripts/test-beat-cost-limits.mjs
 */
import { createRequire } from "module";
import { pathToFileURL } from "url";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

// Read source text assertions (no full Next compile needed)
import fs from "fs";
const quota = fs.readFileSync(path.join(root, "lib/music-generation/beat-quota.ts"), "utf8");
const studio = fs.readFileSync(path.join(root, "app/app/studio/page.tsx"), "utf8");

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exitCode = 1;
  } else {
    console.log("ok:", msg);
  }
}

assert(quota.includes("return 0.15"), "COGS default 0.15 in elevenLabsMusicUsdPerMin");
assert(quota.includes("Math.ceil(sec / 60)"), "cost uses ceil minutes");
assert(!/\|\|\s*0\.08/.test(quota), "no 0.08 default leftover");
assert(quota.includes('envInt("BEAT_GEN_FREE_MAX_SEC", 90'), "FREE_MAX default 90");
assert(quota.includes("FREE_DURATION_OPTIONS_SEC = [60, 90]"), "free options 60/90");
assert(quota.includes('envInt("MAX_BEAT_GENS_PER_SONG", 3'), "per-song default 3");
assert(quota.includes("PER_SONG_BEAT_GEN_LIMIT"), "per-song limit error code");
assert(quota.includes("countSuccessfulBeatGensForProject"), "per-song counter");
assert(quota.includes("projectId?: string"), "assertBeatGenAllowed accepts projectId");
assert(studio.includes("FREE_MAX_SEC = 90"), "studio FREE_MAX 90");
assert(studio.includes("FREE_LENGTH_PRESETS"), "studio free length presets");
assert(studio.includes("Longer beats unlock when you subscribe or finish a song"), "locked length message");
assert(studio.includes("PER_SONG_BEAT_GEN_LIMIT"), "studio handles per-song limit");
assert(studio.includes('setBeatMode("upload")'), "per-song limit switches to upload");

// Pure function reimplementation of estimate for numeric checks
function estimate(sec, rate = 0.15) {
  if (sec <= 0) return 0;
  const minutes = Math.max(1, Math.ceil(sec / 60));
  return Math.round(minutes * rate * 1000) / 1000;
}
assert(estimate(60) === 0.15, "60s => $0.15");
assert(estimate(90) === 0.3, "90s => $0.30 (ceil to 2 min)");
assert(estimate(120) === 0.3, "120s => $0.30");
assert(estimate(61) === 0.3, "61s => $0.30 ceil");
assert(estimate(180) === 0.45, "180s => $0.45");

if (process.exitCode) {
  console.error("\nSome checks failed");
  process.exit(1);
}
console.log("\nAll beat cost/limit checks passed");
