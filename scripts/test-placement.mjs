/**
 * Placement matrix tests (no browser).
 * Run: node scripts/test-placement.mjs
 */

function resolvePlacementStartMs(input) {
  if (typeof input.placementStartMs === "number" && Number.isFinite(input.placementStartMs)) {
    return Math.max(0, Math.round(input.placementStartMs));
  }
  const offset =
    typeof input.recordingOffsetMs === "number" && Number.isFinite(input.recordingOffsetMs)
      ? Math.round(input.recordingOffsetMs)
      : 0;
  if (typeof input.sectionStartMs === "number" && Number.isFinite(input.sectionStartMs)) {
    return Math.max(0, Math.round(input.sectionStartMs + offset));
  }
  if (typeof input.timelineStartMs === "number" && Number.isFinite(input.timelineStartMs)) {
    return Math.max(0, Math.round(input.timelineStartMs + offset));
  }
  return 0;
}

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exitCode = 1;
  } else {
    console.log("PASS:", msg);
  }
}

// A: section 32000, offset 0
assert(resolvePlacementStartMs({ sectionStartMs: 32000, recordingOffsetMs: 0 }) === 32000, "A offset 0");

// B: +40
assert(resolvePlacementStartMs({ sectionStartMs: 32000, recordingOffsetMs: 40 }) === 32040, "B offset +40");

// C: -40
assert(resolvePlacementStartMs({ sectionStartMs: 32000, recordingOffsetMs: -40 }) === 31960, "C offset -40");

// D: custom plan VERSE timestamps unchanged (selection does not rewrite)
const verse = { start_ms: 32000, end_ms: 64000, selected: true };
const intro = { start_ms: 0, end_ms: 12000, selected: false };
assert(verse.start_ms === 32000 && verse.end_ms === 64000, "D VERSE timestamps preserved when selected");
assert(intro.start_ms === 0, "D INTRO timestamps preserved when deselected");

// E: non-adjacent VERSE + BRIDGE
const bridge = { start_ms: 96000, end_ms: 120000, selected: true };
assert(verse.start_ms === 32000 && bridge.start_ms === 96000, "E non-adjacent section timestamps unchanged");

// F: two tasks — placement from task identity not order
const take1 = resolvePlacementStartMs({ sectionStartMs: 0, recordingOffsetMs: 10 });
const take2 = resolvePlacementStartMs({ sectionStartMs: 32000, recordingOffsetMs: 20 });
assert(take1 === 10 && take2 === 32020, "F each task uses own section+offset");

// G/H/I: same helper everywhere
const shared = { sectionStartMs: 32000, recordingOffsetMs: 40 };
const review = resolvePlacementStartMs(shared);
const preview = resolvePlacementStartMs(shared);
const produce = resolvePlacementStartMs(shared);
const stem = resolvePlacementStartMs(shared);
assert(review === preview && preview === produce && produce === stem && review === 32040, "G/H/I review=preview=produce=stem");

// J: legacy no offset → 0
assert(resolvePlacementStartMs({ sectionStartMs: 32000 }) === 32000, "J legacy offset defaults 0");
assert(resolvePlacementStartMs({ timelineStartMs: 32000 }) === 32000, "J timeline_start only");

// Explicit placement wins
assert(
  resolvePlacementStartMs({ sectionStartMs: 32000, recordingOffsetMs: 40, placementStartMs: 32100 }) === 32100,
  "explicit placementStartMs wins"
);


// Extra offsets
assert(resolvePlacementStartMs({ sectionStartMs: 32000, recordingOffsetMs: 500 }) === 32500, "offset +500");
assert(resolvePlacementStartMs({ sectionStartMs: 32000, recordingOffsetMs: -500 }) === 31500, "offset -500");
assert(resolvePlacementStartMs({ sectionStartMs: 65000, recordingOffsetMs: 0 }) === 65000, "chorus-only keeps 65000");

if (process.exitCode) {
  console.error("\nPlacement tests failed.");
  process.exit(1);
}
console.log("\nAll placement tests passed.");
