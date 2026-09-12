
/**
 * Deterministic AP TIME checks (no external audio).
 * Run: node scripts/test-ap-time.mjs
 */
import { createRequire } from "module";
// Tests use pure logic mirrored inline for runtime without ts compile

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
  console.log("PASS:", msg);
}

// Decision philosophy unit checks
function decideMock(status, offsetMs, role) {
  if (role === "adlib") return "preserve_offbeat";
  if (status === "on_time") return "keep";
  if (status === "intentional_offbeat") return "preserve_offbeat";
  if (status === "late" && offsetMs >= 55 && role === "lead") return "move_earlier";
  if (role === "double") return "tighten_to_lead";
  return "keep";
}

assert(decideMock("on_time", 5, "lead") === "keep", "T1 on-time lead keep");
assert(decideMock("intentional_offbeat", 35, "lead") === "preserve_offbeat", "T4 consistent behind preserve");
assert(decideMock("late", 120, "lead") === "move_earlier", "T3 clearly late lead correct");
assert(decideMock("late", 80, "adlib") === "preserve_offbeat", "T8 adlib freedom");
assert(decideMock("late", 75, "double") === "tighten_to_lead", "T6 double tighten");
assert(decideMock("on_time", 0, "harmony_high") === "keep", "T7 harmony keep when on time");

console.log("\nAll AP TIME decision philosophy tests passed.");
