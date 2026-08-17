/**
 * Active-plan membership for session preview (mirrors lib/audio/active-plan-membership).
 * Run: node scripts/test-session-preview-membership.mjs
 */

function isActivePlanTask(t) {
  if (t.active === false) return false;
  if (t.selected_in_plan === false) return false;
  if (t.status === "skipped") return false;
  return true;
}

function hasPlanMembershipFlags(tasks) {
  return tasks.some((t) => t.active != null || t.selected_in_plan != null);
}

function activePlanTaskIds(tasks) {
  if (!hasPlanMembershipFlags(tasks)) return new Set(tasks.map((t) => t.id));
  return new Set(tasks.filter(isActivePlanTask).map((t) => t.id));
}

function matchRecordingsToActivePlan(planTasks, recordings) {
  const hasFlags = hasPlanMembershipFlags(planTasks);
  const activeIds = activePlanTaskIds(planTasks);
  return recordings.filter((r) => {
    if (!hasFlags) return true;
    if (activeIds.size === 0) return false;
    return Boolean(r.task_id) && activeIds.has(r.task_id);
  });
}

function oneTakePerTask(recordings) {
  const byTask = new Map();
  for (const t of recordings) {
    const tid = t.task_id || t.id;
    const prev = byTask.get(tid);
    if (!prev) {
      byTask.set(tid, t);
      continue;
    }
    if (t.is_selected && !prev.is_selected) byTask.set(tid, t);
  }
  return [...byTask.values()];
}

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

const intro = { id: "t-intro", start_ms: 0, end_ms: 12000, selected_in_plan: true, active: true };
const verse = { id: "t-verse", start_ms: 32000, end_ms: 64000, selected_in_plan: true, active: true };
const chorus = {
  id: "t-chorus",
  start_ms: 65000,
  end_ms: 90000,
  selected_in_plan: false,
  active: false,
  status: "skipped",
};

const tasks = [intro, verse, chorus];
const selected = [...activePlanTaskIds(tasks)];
assert(selected.length === 2 && selected.includes("t-intro") && selected.includes("t-verse"), "Intro+Verse selected");
assert(!selected.includes("t-chorus"), "Chorus excluded");

const recs = [
  { id: "r1", task_id: "t-intro", is_selected: true, audio_path: "a.wav" },
  { id: "r2", task_id: "t-verse", is_selected: true, audio_path: "b.wav" },
  { id: "r3", task_id: "t-chorus", is_selected: true, audio_path: "c.wav" },
];

const matched = matchRecordingsToActivePlan(tasks, recs);
assert(matched.length === 2, "matched recordings = 2");
assert(!matched.some((r) => r.task_id === "t-chorus"), "chorus recording excluded");

const takes = oneTakePerTask(matched);
assert(takes.length === 2, "one take per task → 2");

const verseOnlyTasks = [
  { ...intro, selected_in_plan: false, active: false },
  verse,
  chorus,
];
const verseOnlyIds = [...activePlanTaskIds(verseOnlyTasks)];
assert(verseOnlyIds.length === 1 && verseOnlyIds[0] === "t-verse", "verse-only selection");
const place = resolvePlacementStartMs({ sectionStartMs: 32000, recordingOffsetMs: 40 });
assert(place === 32040, "verse placement stays ~32040 not zero-based");

const noRecMatch = matchRecordingsToActivePlan(tasks, [
  { id: "r1", task_id: "t-intro", is_selected: true },
]);
assert(noRecMatch.length === 1, "only intro recording matched when verse missing");

if (process.exitCode) {
  console.error("\nSession preview membership tests failed.");
  process.exit(1);
}
console.log("\nAll session-preview membership tests passed.");
