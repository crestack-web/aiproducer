/**
 * Focused duck state-machine tests (no browser AudioContext required).
 * Mirrors rules in lib/audio/speaker-monitor-duck.ts
 *
 * Run: node scripts/test-speaker-duck-state.mjs
 */

function isPhoneSpeakerOutput(outputId) {
  const o = (outputId || "").toLowerCase();
  if (!o) return false;
  if (
    o === "__headphones__" ||
    o.includes("headphone") ||
    o.includes("airpod") ||
    o.includes("bluetooth") ||
    o.includes("earpiece")
  ) {
    return false;
  }
  return o === "__speaker__" || o === "speaker" || o.includes("speaker");
}

const CFG = {
  normalVolume: 0.05,
  duckedVolume: 0.028,
  minUsableVolume: 0.02,
  voiceOnThreshold: 0.018,
  voiceOffThreshold: 0.01,
  voiceHoldOnMs: 50,
  voiceHoldOffMs: 220,
  attackMs: 55,
  releaseMs: 350,
};

function createLatch() {
  let duckingLatched = false;
  let aboveSinceMs = null;
  let belowSinceMs = null;
  let currentVol = CFG.normalVolume;
  const duckedFloor = Math.max(
    CFG.minUsableVolume,
    Math.min(CFG.duckedVolume, CFG.normalVolume)
  );

  function step(voiceScore, rms, nowMs, dtMs = 16) {
    const strongRms =
      rms >= CFG.voiceOnThreshold * 1.45 && voiceScore >= CFG.voiceOnThreshold * 0.55;
    if (voiceScore >= CFG.voiceOnThreshold || strongRms) {
      belowSinceMs = null;
      if (aboveSinceMs == null) aboveSinceMs = nowMs;
      if (!duckingLatched && nowMs - aboveSinceMs >= CFG.voiceHoldOnMs) {
        duckingLatched = true;
      }
    } else if (voiceScore <= CFG.voiceOffThreshold && rms <= CFG.voiceOffThreshold * 1.1) {
      aboveSinceMs = null;
      if (belowSinceMs == null) belowSinceMs = nowMs;
      if (duckingLatched && nowMs - belowSinceMs >= CFG.voiceHoldOffMs) {
        duckingLatched = false;
      }
    } else {
      if (duckingLatched) aboveSinceMs = nowMs;
      else belowSinceMs = nowMs;
    }

    const target = duckingLatched ? duckedFloor : CFG.normalVolume;
    const tau = target < currentVol ? CFG.attackMs : CFG.releaseMs;
    const alpha = 1 - Math.exp(-dtMs / Math.max(1, tau));
    currentVol = currentVol + (target - currentVol) * alpha;
    currentVol = Math.min(CFG.normalVolume, Math.max(CFG.minUsableVolume, currentVol));
    return { duckingLatched, currentVol };
  }

  return { step, get: () => ({ duckingLatched, currentVol }) };
}

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) {
    passed++;
    console.log("  PASS", msg);
  } else {
    failed++;
    console.error("  FAIL", msg);
  }
}

console.log("\n1) Route gating");
assert(isPhoneSpeakerOutput("__speaker__") === true, "phone speaker enables duck");
assert(isPhoneSpeakerOutput("speaker") === true, "speaker string enables duck");
assert(isPhoneSpeakerOutput("__headphones__") === false, "headphones disables duck");
assert(isPhoneSpeakerOutput("AirPods Pro") === false, "AirPods disables duck");
assert(isPhoneSpeakerOutput("bluetooth-headphones") === false, "bluetooth disables duck");
assert(isPhoneSpeakerOutput("earpiece") === false, "earpiece disables duck");
assert(isPhoneSpeakerOutput("") === false, "empty disables duck");

console.log("\n2) SILENT → NORMAL BEAT");
{
  const L = createLatch();
  let s;
  for (let t = 0; t < 500; t += 16) {
    s = L.step(0.002, 0.002, t);
  }
  assert(s.duckingLatched === false, "stays unducked when silent");
  assert(Math.abs(s.currentVol - CFG.normalVolume) < 0.002, "volume ≈ normalVolume");
}

console.log("\n3) VOICE START → DUCKED BEAT");
{
  const L = createLatch();
  let s = L.step(0.05, 0.05, 0);
  s = L.step(0.05, 0.05, 60);
  assert(s.duckingLatched === true, "latches after hold-on");
  for (let t = 70; t < 400; t += 16) s = L.step(0.05, 0.05, t);
  assert(s.currentVol <= CFG.duckedVolume + 0.005 && s.currentVol >= CFG.minUsableVolume - 1e-6, "volume in audible ducked range");
  assert(s.currentVol >= CFG.minUsableVolume - 1e-6, "never below minUsableVolume");
}

console.log("\n4) VOICE CONTINUES → STAYS DUCKED");
{
  const L = createLatch();
  let s;
  for (let t = 0; t < 200; t += 16) s = L.step(0.04, 0.04, t);
  assert(s.duckingLatched === true, "ducked while voice continues");
  const v1 = s.currentVol;
  for (let t = 200; t < 800; t += 16) s = L.step(0.04, 0.04, t);
  assert(s.duckingLatched === true, "still ducked");
  assert(Math.abs(s.currentVol - v1) < 0.005, "stable ducked level (no pump)");
}

console.log("\n5) VOICE STOPS → RELEASE");
{
  const L = createLatch();
  let s;
  for (let t = 0; t < 200; t += 16) s = L.step(0.05, 0.05, t);
  assert(s.duckingLatched === true, "was ducked");
  s = L.step(0.001, 0.001, 250);
  assert(s.duckingLatched === true, "still ducked during hold-off window");
  for (let t = 260; t < 500; t += 16) s = L.step(0.001, 0.001, t);
  assert(s.duckingLatched === false, "released after hold-off");
  // Deeper duck needs more release time to approach normal (releaseMs ~350)
  for (let t = 500; t < 2200; t += 16) s = L.step(0.001, 0.001, t);
  assert(Math.abs(s.currentVol - CFG.normalVolume) < 0.005, "smoothly returned to normal");
}

console.log("\n6) RAPID SPEECH → NO PUMPING");
{
  const L = createLatch();
  let s;
  for (let t = 0; t < 100; t += 16) s = L.step(0.05, 0.05, t);
  const volumes = [];
  for (let t = 100; t < 600; t += 30) {
    const voice = Math.floor(t / 30) % 2 === 0;
    s = L.step(voice ? 0.05 : 0.002, voice ? 0.05 : 0.002, t, 30);
    volumes.push(s.currentVol);
  }
  assert(s.duckingLatched === true, "rapid gaps do not release (hysteresis)");
  const minV = Math.min(...volumes);
  const maxV = Math.max(...volumes);
  assert(maxV - minV < 0.02, "volume does not pump widely during rapid speech");
  assert(minV >= CFG.minUsableVolume - 1e-6, "never mutes during rapid speech");
}

console.log("\n7) NEVER FULL MUTE");
{
  const L = createLatch();
  let s;
  for (let t = 0; t < 500; t += 16) s = L.step(0.1, 0.1, t);
  assert(s.currentVol >= CFG.minUsableVolume - 1e-6, "ducked volume ≥ minUsable");
  assert(s.currentVol > 0, "never zero");
}

console.log("\n8) Config targets");
assert(CFG.normalVolume >= 0.04 && CFG.normalVolume <= 0.06, "normalVolume in 0.04–0.06");
assert(CFG.duckedVolume >= 0.02 && CFG.duckedVolume <= 0.035, "duckedVolume in 0.02–0.035 (audible, not near-silent)");
assert(CFG.minUsableVolume <= CFG.duckedVolume, "floor ≤ ducked target");
assert(CFG.attackMs >= 40 && CFG.attackMs <= 70, "attack 40–70ms");
assert(CFG.releaseMs >= 250 && CFG.releaseMs <= 400, "release 250–400ms");

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
