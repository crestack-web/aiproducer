/**
 * Console timeline correctness (no browser).
 * Run: node scripts/test-console-timeline.mjs
 */

function resolveClipStartMs(input) {
  if (typeof input.placementStartMs === "number" && Number.isFinite(input.placementStartMs)) {
    return Math.max(0, Math.round(input.placementStartMs));
  }
  if (typeof input.timelineStartMs === "number" && Number.isFinite(input.timelineStartMs)) {
    return Math.max(0, Math.round(input.timelineStartMs));
  }
  const section =
    typeof input.sectionStartMs === "number" && Number.isFinite(input.sectionStartMs)
      ? Math.round(input.sectionStartMs)
      : 0;
  const offset =
    typeof input.recordingOffsetMs === "number" && Number.isFinite(input.recordingOffsetMs)
      ? Math.round(input.recordingOffsetMs)
      : 0;
  return Math.max(0, section + offset);
}

function resolveClipEndMs(input) {
  const start = Math.max(0, Math.round(input.startMs));
  if (typeof input.decodedDurationMs === "number" && input.decodedDurationMs > 0) {
    return start + Math.round(input.decodedDurationMs);
  }
  const minD = input.minDurationMs ?? 500;
  if (typeof input.planEndMs === "number" && Number.isFinite(input.planEndMs)) {
    return Math.max(start + minD, Math.round(input.planEndMs));
  }
  return start + minD;
}

function timelineToSourceOffsetSec(timelineMs, clipStartMs) {
  return (timelineMs - clipStartMs) / 1000;
}

function isPlayheadInClip(timelineMs, clipStartMs, decodedDurationMs) {
  const local = timelineMs - clipStartMs;
  return local >= 0 && local < decodedDurationMs;
}

function playheadFromAudioContext(input) {
  const elapsed =
    (input.contextCurrentTime - input.startedAt) * 1000 + input.offsetMs;
  return Math.min(input.totalMs, Math.max(0, elapsed));
}

function playheadFromHtmlAudio(currentTimeSec, totalMs) {
  return Math.min(totalMs, Math.max(0, currentTimeSec * 1000));
}

function softPeakNorm(peakMax) {
  if (!(peakMax > 1e-4)) return 1;
  return 1 / Math.max(peakMax, 0.12);
}

function computePeaksFromChannels(channels, buckets) {
  const n = channels[0]?.length || 0;
  const peaks = new Float32Array(Math.max(1, buckets));
  if (!n || !channels.length) return peaks;
  const block = Math.max(1, Math.floor(n / peaks.length));
  for (let i = 0; i < peaks.length; i++) {
    let max = 0;
    const start = i * block;
    const end = Math.min(n, start + block);
    for (let j = start; j < end; j++) {
      for (const ch of channels) {
        const v = Math.abs(ch[j] || 0);
        if (v > max) max = v;
      }
    }
    peaks[i] = max;
  }
  return peaks;
}

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    failed++;
  } else {
    console.log("PASS:", msg);
  }
}

// --- Placement ---
assert(
  resolveClipStartMs({ sectionStartMs: 14312, recordingOffsetMs: 51 }) === 14363,
  "section + offset placement"
);
assert(
  resolveClipStartMs({ placementStartMs: 65000 }) === 65000,
  "explicit placement wins"
);
assert(
  resolveClipStartMs({ timelineStartMs: 20000, sectionStartMs: 10000 }) === 20000,
  "timeline_start_ms preferred over section"
);

// --- Clip geometry from decoded duration (root cause fix) ---
assert(
  resolveClipEndMs({ startMs: 20000, decodedDurationMs: 8000, planEndMs: 45000 }) === 28000,
  "decoded duration wins over plan section end"
);
assert(
  resolveClipEndMs({ startMs: 20000, planEndMs: 28000 }) === 28000,
  "plan end used when no decode yet"
);
assert(
  resolveClipEndMs({ startMs: 20000, decodedDurationMs: 8000 }) === 28000,
  "end = start + decoded"
);

// --- Timeline ↔ source mapping ---
assert(
  Math.abs(timelineToSourceOffsetSec(24000, 20000) - 4) < 1e-9,
  "at 24s into song, vocal at start 20s plays buffer 4s"
);
assert(
  Math.abs(timelineToSourceOffsetSec(20000, 20000) - 0) < 1e-9,
  "at clip start, source offset 0"
);
assert(isPlayheadInClip(24000, 20000, 8000) === true, "inside clip");
assert(isPlayheadInClip(28000, 20000, 8000) === false, "at/after clip end silent");
assert(isPlayheadInClip(19999, 20000, 8000) === false, "before clip silent");

// --- Playhead clock (Web Audio) ---
// startedAt=10, context=11 → 1s elapsed + offset 0
assert(
  Math.abs(
    playheadFromAudioContext({
      contextCurrentTime: 11,
      startedAt: 10,
      offsetMs: 0,
      totalMs: 60000,
    }) - 1000
  ) < 0.5,
  "playhead ~1s after 1s of context"
);
assert(
  Math.abs(
    playheadFromAudioContext({
      contextCurrentTime: 15,
      startedAt: 10,
      offsetMs: 0,
      totalMs: 60000,
    }) - 5000
  ) < 0.5,
  "playhead ~5s after 5s of context"
);
// Pause freeze: offset becomes frozen position; startedAt reset on resume
assert(
  Math.abs(
    playheadFromAudioContext({
      contextCurrentTime: 100,
      startedAt: 100,
      offsetMs: 6000,
      totalMs: 60000,
    }) - 6000
  ) < 0.5,
  "resume from frozen 6s"
);
assert(
  playheadFromAudioContext({
    contextCurrentTime: 999,
    startedAt: 0,
    offsetMs: 0,
    totalMs: 30000,
  }) === 30000,
  "clamped to totalMs"
);

// --- HTMLAudio fallback clock ---
assert(
  Math.abs(playheadFromHtmlAudio(12.5, 60000) - 12500) < 0.5,
  "html audio currentTime drives playhead"
);

// --- Waveform TEST A: silence / audio / silence / audio ---
const sr = 1000; // 1 sample = 1ms for easy buckets
const total = 10000;
const ch = new Float32Array(total);
for (let i = 2000; i < 4000; i++) ch[i] = 0.5;
for (let i = 6000; i < 10000; i++) ch[i] = 0.4;
const peaks = computePeaksFromChannels([ch], 10); // 1s buckets
assert(peaks[0] < 0.01 && peaks[1] < 0.01, "TEST A: 0–2s silence in peaks");
assert(peaks[2] > 0.3 && peaks[3] > 0.3, "TEST A: 2–4s energy");
assert(peaks[4] < 0.01 && peaks[5] < 0.01, "TEST A: 4–6s silence");
assert(peaks[6] > 0.3, "TEST A: 6s+ energy");

// --- TEST B: only energy near 7s ---
const chB = new Float32Array(10000);
for (let i = 7000; i < 7200; i++) chB[i] = 0.6;
const peaksB = computePeaksFromChannels([chB], 10);
let activeBuckets = 0;
for (let i = 0; i < peaksB.length; i++) if (peaksB[i] > 0.1) activeBuckets++;
assert(activeBuckets <= 2, "TEST B: not continuously active");
assert(peaksB[7] > 0.3, "TEST B: energy around 7s");

// --- Soft norm preserves relative silence ---
assert(Math.abs(softPeakNorm(1) - 1) < 1e-9, "loud peak norm ~1");
assert(softPeakNorm(0.05) < 10, "quiet peak not infinite boost");
const silenceDisplay = 0.001 * softPeakNorm(0.5);
assert(silenceDisplay < 0.05, "true silence stays near zero after soft norm");

// --- Stereo: channel 1 only energy must still appear ---
const L = new Float32Array(1000);
const R = new Float32Array(1000);
for (let i = 100; i < 200; i++) R[i] = 0.8;
const peaksStereo = computePeaksFromChannels([L, R], 10);
assert(peaksStereo[1] > 0.5, "stereo peak uses max across channels");

// --- After vocal ends: geometry ---
const start = 20000;
const dur = 8000;
const end = resolveClipEndMs({ startMs: start, decodedDurationMs: dur });
assert(end === 28000, "vocal ends 28s");
assert(!isPlayheadInClip(28000, start, dur), "no vocal content at end boundary");
assert(!isPlayheadInClip(30000, start, dur), "no vocal content after end");
assert(isPlayheadInClip(27999, start, dur), "still in clip just before end");

if (failed) {
  console.error("\n" + failed + " failure(s)");
  process.exit(1);
}
console.log("\nAll console timeline tests passed.");
