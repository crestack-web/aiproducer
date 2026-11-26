/**
 * Booth ⇄ Console ownership rule: the AI plan never touches Console parts.
 * Run: npx tsx scripts/test-edit-ownership.mts
 */
import assert from "node:assert/strict";
import {
  canAiPlanRun,
  canAiPlanTouch,
  canConsoleTouch,
  filterAiTouchable,
  normalizeEditMode,
  partOwner,
} from "../lib/edit-ownership.ts";

let n = 0;
function test(name: string, fn: () => void) {
  fn();
  n += 1;
  console.log(`ok - ${name}`);
}

test("console and scratch parts are owned by Console", () => {
  assert.equal(partOwner("console"), "console");
  assert.equal(partOwner("scratch"), "console");
});

test("ai, restored_ai, artist and missing sources are owned by Booth", () => {
  for (const src of ["ai", "restored_ai", "artist", null, "", undefined]) {
    assert.equal(partOwner(src), "booth");
  }
});

test("the AI plan never touches a Console part, even in booth mode", () => {
  assert.equal(canAiPlanTouch("booth", "console"), false);
  assert.equal(canAiPlanTouch("booth", "scratch"), false);
  assert.equal(canAiPlanTouch("booth", "ai"), true);
});

test("the AI plan refuses to run once a song is in Console", () => {
  assert.equal(canAiPlanRun("console"), false);
  assert.equal(canAiPlanTouch("console", "ai"), false);
  assert.equal(canAiPlanRun("booth"), true);
  assert.equal(canAiPlanRun(null), true); // default edit_mode is booth
});

test("Console only edits its own parts, and only after the hand-off", () => {
  assert.equal(canConsoleTouch("console", "console"), true);
  assert.equal(canConsoleTouch("console", "ai"), false);
  assert.equal(canConsoleTouch("booth", "console"), false);
});

test("a plan refresh over a mixed song keeps every Console part out", () => {
  const tasks = [
    { id: "1", plan_source: "ai" },
    { id: "2", plan_source: "console" },
    { id: "3", plan_source: null, metadata: { plan_source: "scratch" } },
    { id: "4", plan_source: "artist" },
  ];
  assert.deepEqual(filterAiTouchable("booth", tasks).map((t) => t.id), ["1", "4"]);
  assert.deepEqual(filterAiTouchable("console", tasks), []);
});

test("unknown edit_mode values fall back to booth", () => {
  assert.equal(normalizeEditMode("CONSOLE"), "console");
  assert.equal(normalizeEditMode("whatever"), "booth");
});

console.log(`\n${n} edit-ownership tests passed`);
