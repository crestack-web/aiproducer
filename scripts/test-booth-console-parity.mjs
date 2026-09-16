/**
 * Booth ↔ Console completion-state consistency helpers.
 * Pure logic tests (no DB): status + membership rules both pages must share.
 */
import assert from "node:assert/strict";

/** Mirrors isTaskOpen / completed used by session + console filters */
function isCompletedStatus(status) {
  const s = (status || "").trim().toLowerCase();
  return ["completed", "complete", "done", "recorded", "produced"].includes(s);
}

function isOpenStatus(status) {
  const s = (status || "").trim().toLowerCase();
  if (!s) return true;
  if (["pending", "in_progress", "ready", "open", "todo", "new"].includes(s)) return true;
  if (["completed", "complete", "done", "recorded", "produced", "skipped", "skip"].includes(s)) {
    return false;
  }
  return true;
}

/** Console layer list filter (approx): show non-skipped with window or pending/completed */
function consoleIncludesTask(t) {
  const st = (t.status || "").toLowerCase();
  if (st === "skipped" || st === "cancelled") return false;
  return t.start_ms != null || st === "completed" || st === "pending";
}

/** Booth: completed tasks should not be "open" for continue */
function boothTreatsAsDone(t) {
  return isCompletedStatus(t.status) || (t.status || "").toLowerCase() === "skipped";
}

function run() {
  // Console record marks completed → Booth must see done
  const fromConsole = { id: "1", status: "completed", start_ms: 0, end_ms: 8000 };
  assert.equal(boothTreatsAsDone(fromConsole), true);
  assert.equal(isOpenStatus(fromConsole.status), false);
  assert.equal(consoleIncludesTask(fromConsole), true);

  // Booth record completed → Console still lists layer
  const fromBooth = { id: "2", status: "completed", start_ms: 1000, end_ms: 9000 };
  assert.equal(consoleIncludesTask(fromBooth), true);
  assert.equal(boothTreatsAsDone(fromBooth), true);

  // Pending planned layer: open in Booth, shown in Console as slot
  const planned = { id: "3", status: "pending", start_ms: 0, end_ms: 8000 };
  assert.equal(isOpenStatus(planned.status), true);
  assert.equal(consoleIncludesTask(planned), true);
  assert.equal(boothTreatsAsDone(planned), false);

  // Skipped: neither active
  const skipped = { id: "4", status: "skipped", start_ms: 0 };
  assert.equal(consoleIncludesTask(skipped), false);
  assert.equal(boothTreatsAsDone(skipped), true);

  console.log("test-booth-console-parity: all PASS");
}

run();
