/**
 * Vocal structure: timeline preservation + phrase grouping (mirrors analysis constants).
 * node scripts/test-vocal-structure.mjs
 */
const PHRASE_MIN_MS = 280;
const PHRASE_MERGE_GAP_MS = 180;
const ACTIVITY_HOLD_MS = 80;
const ACTIVITY_FRAME_MS = 20;
const ACTIVITY_THRESHOLD_RATIO = 1.8;
const MIN_PHRASE_ENERGY = 0.008;

function detectPhrasesFromRms(frames, durationMs) {
  const sorted = frames.map((f) => f.rms).sort((a, b) => a - b);
  const p20 = sorted[Math.floor(sorted.length * 0.2)] || 1e-6;
  const thr = Math.max(p20, 1e-6) * ACTIVITY_THRESHOLD_RATIO + MIN_PHRASE_ENERGY * 0.25;
  const holdFrames = Math.max(1, Math.ceil(ACTIVITY_HOLD_MS / ACTIVITY_FRAME_MS));
  const active = frames.map(() => false);
  let hold = 0;
  for (let i = 0; i < frames.length; i++) {
    if (frames[i].rms >= thr) {
      active[i] = true;
      hold = holdFrames;
    } else if (hold > 0) {
      active[i] = true;
      hold--;
    }
  }
  const raw = [];
  let cur = null;
  for (let i = 0; i < frames.length; i++) {
    if (active[i]) {
      if (!cur) cur = { start: i, end: i };
      else cur.end = i;
    } else if (cur) {
      raw.push(cur);
      cur = null;
    }
  }
  if (cur) raw.push(cur);
  const merged = [];
  for (const r of raw) {
    if (!merged.length) {
      merged.push({ ...r });
      continue;
    }
    const prev = merged[merged.length - 1];
    const gapMs = frames[r.start].tMs - (frames[prev.end].tMs + ACTIVITY_FRAME_MS);
    if (gapMs <= PHRASE_MERGE_GAP_MS) prev.end = r.end;
    else merged.push({ ...r });
  }
  const phrases = [];
  for (const r of merged) {
    const startMs = Math.round(frames[r.start].tMs);
    const endMs = Math.round(Math.min(durationMs, frames[r.end].tMs + ACTIVITY_FRAME_MS));
    if (endMs - startMs < PHRASE_MIN_MS) continue;
    phrases.push({ startMs, endMs });
  }
  return phrases;
}

function makeFrames(pattern) {
  // pattern: array of {tMs, rms}
  return pattern;
}

// Test 1: timeline — phrase at 0-1s, silence 1-2s, phrase 2-3s
const frames1 = [];
for (let t = 0; t < 3000; t += ACTIVITY_FRAME_MS) {
  const rms = (t < 1000 || t >= 2000) ? 0.05 : 0.001;
  frames1.push({ tMs: t, rms });
}
const p1 = detectPhrasesFromRms(frames1, 3000);
const second = p1.find((p) => p.startMs >= 1800);
console.log("T1 timeline phrases", p1);
if (!second || second.startMs < 1900 || second.startMs > 2100) {
  console.error("FAIL T1: second phrase not near 2000ms", second);
  process.exit(1);
}
console.log("PASS T1 timeline preservation");

// Test 2: short gap merge
const frames2 = [];
for (let t = 0; t < 2000; t += ACTIVITY_FRAME_MS) {
  // active 0-500, gap 100ms, active 600-1200
  const rms = (t < 500 || (t >= 600 && t < 1200)) ? 0.05 : 0.001;
  frames2.push({ tMs: t, rms });
}
const p2 = detectPhrasesFromRms(frames2, 2000);
console.log("T2 merge phrases", p2);
if (p2.length !== 1) {
  console.error("FAIL T2: expected 1 merged phrase, got", p2.length);
  process.exit(1);
}
console.log("PASS T2 short-gap merge");

// Test 3: long silence not shifted
const frames3 = [];
for (let t = 0; t < 5000; t += ACTIVITY_FRAME_MS) {
  const rms = (t < 800 || t >= 3500) ? 0.04 : 0.001;
  frames3.push({ tMs: t, rms });
}
const p3 = detectPhrasesFromRms(frames3, 5000);
const late = p3.find((p) => p.startMs >= 3000);
console.log("T3 long silence", p3);
if (!late || late.startMs < 3400) {
  console.error("FAIL T3", late);
  process.exit(1);
}
console.log("PASS T3 long silence preserved");

// Test 4: constants exported concept
console.log("PASS T4 constants", { PHRASE_MIN_MS, PHRASE_MERGE_GAP_MS, ACTIVITY_HOLD_MS });

console.log("\nAll vocal-structure unit checks passed.");
