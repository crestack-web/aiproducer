/** Unit tests for FX automation interpolation — no Web Audio required. */

function sampleLane(lane, timeMs) {
  if (lane.enabled === false) return null;
  const pts = lane.points;
  if (!pts.length) return null;
  if (timeMs <= pts[0].timeMs) return pts[0].value;
  if (timeMs >= pts[pts.length - 1].timeMs) return pts[pts.length - 1].value;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    if (timeMs >= a.timeMs && timeMs <= b.timeMs) {
      const t = (timeMs - a.timeMs) / Math.max(1, b.timeMs - a.timeMs);
      return a.value + (b.value - a.value) * t;
    }
  }
  return pts[pts.length - 1].value;
}

let fail = 0;
function assert(name, cond) {
  if (cond) console.log("  OK", name);
  else {
    console.error("  FAIL", name);
    fail++;
  }
}

const lane = {
  enabled: true,
  points: [
    { timeMs: 0, value: 0 },
    { timeMs: 1000, value: -12 },
  ],
};
assert("midpoint", Math.abs(sampleLane(lane, 500) - -6) < 0.01);
assert("before", sampleLane(lane, -100) === 0);
assert("after", sampleLane(lane, 2000) === -12);
assert("disabled", sampleLane({ ...lane, enabled: false }, 500) === null);
assert("empty", sampleLane({ enabled: true, points: [] }, 0) === null);

if (fail) process.exit(1);
console.log("All automation unit tests passed.");
