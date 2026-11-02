/**
 * Unit checks for console transport mixer helpers (no browser AudioContext).
 */
function isTrackAudible(trackId, mixer) {
  if (mixer.muted.has(trackId)) return false;
  if (mixer.soloed.size > 0) return mixer.soloed.has(trackId);
  return true;
}

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL", msg);
    failed++;
  } else console.log("ok", msg);
}

assert(
  isTrackAudible("a", { muted: new Set(["a"]), soloed: new Set() }) === false,
  "mute silences track"
);
assert(
  isTrackAudible("b", { muted: new Set(["a"]), soloed: new Set() }) === true,
  "unmuted track plays"
);
assert(
  isTrackAudible("lead", {
    muted: new Set(),
    soloed: new Set(["lead", "harm"]),
  }) === true,
  "multi-solo includes lead"
);
assert(
  isTrackAudible("beat", {
    muted: new Set(),
    soloed: new Set(["lead", "harm"]),
  }) === false,
  "multi-solo excludes others"
);

if (failed) {
  console.error(failed, "failed");
  process.exit(1);
}
console.log("console-transport mixer checks passed");
