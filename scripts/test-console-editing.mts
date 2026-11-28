import assert from "node:assert/strict";
import {
  buildLyricTimeline,
  currentLyricLine,
  makeCountInPlan,
  scheduleClipEdgeFades,
  scoreTakeAssessment,
} from "../lib/audio/console-editing";

const plan = makeCountInPlan(120, 4);
assert(plan, "120 BPM must produce a count-in");
assert.equal(plan.beatMs, 500);
assert.equal(plan.durationMs, 2000);
assert.deepEqual(plan.clickOffsetsMs, [0, 500, 1000, 1500]);
assert.equal(makeCountInPlan(null), null);
assert.equal(makeCountInPlan(0), null);

const events: Array<[string, number, number]> = [];
const param = {
  cancelScheduledValues: (time: number) => events.push(["cancel", time, 0]),
  setValueAtTime: (value: number, time: number) => events.push(["set", time, value]),
  linearRampToValueAtTime: (value: number, time: number) => events.push(["ramp", time, value]),
} as unknown as AudioParam;
scheduleClipEdgeFades(param, 2, 1);
assert.deepEqual(events[0], ["cancel", 2, 0]);
assert.deepEqual(events[1], ["set", 2, 0]);
assert.deepEqual(events[2], ["ramp", 2.008, 1]);
assert.deepEqual(events.at(-1), ["ramp", 3, 0]);

const lyrics = buildLyricTimeline([
  { id: "verse", startMs: 1000, endMs: 5000, lyric: "First line\nSecond line" },
]);
assert.equal(lyrics.length, 2);
assert.equal(currentLyricLine(lyrics, 1500)?.text, "First line");
assert.equal(currentLyricLine(lyrics, 3500)?.text, "Second line");
assert.equal(currentLyricLine(lyrics, 5000), null);

assert(scoreTakeAssessment({ action: "KEEP", confidence: 0.8 }) > scoreTakeAssessment({ action: "RETAKE", confidence: 0.8 }));
assert(scoreTakeAssessment({ action: "KEEP", clippingDetected: true }) < scoreTakeAssessment({ action: "TRIM", clippingDetected: false }));
assert(scoreTakeAssessment({ action: "KEEP", silenceDetected: true }) < 50);

console.log("console-editing: ok");
