/**
 * Lightweight self-check for normalizeOutputDevices (no test runner required).
 * Run: node scripts/test-output-devices.mjs
 */
import {
  normalizeOutputDevices,
  normalizeOutputLabel,
  isDefaultAliasId,
} from "../lib/audio/output-devices.ts";

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exitCode = 1;
  } else {
    console.log("PASS:", msg);
  }
}

// 1. Duplicate device IDs → one entry
{
  const r = normalizeOutputDevices([
    { deviceId: "1", label: "Speaker", groupId: "A", kind: "audiooutput" },
    { deviceId: "1", label: "Speaker", groupId: "A", kind: "audiooutput" },
  ]);
  assert(r.length === 1, "duplicate deviceIds collapse");
}

// 2. Same groupId + different labels → one entry, better label wins
{
  const r = normalizeOutputDevices([
    { deviceId: "1", label: "iPhone Speaker", groupId: "A", kind: "audiooutput" },
    { deviceId: "2", label: "Speaker", groupId: "A", kind: "audiooutput" },
    { deviceId: "3", label: "AirPods", groupId: "B", kind: "audiooutput" },
    { deviceId: "4", label: "AirPods", groupId: "B", kind: "audiooutput" },
  ]);
  assert(r.length === 2, "same groupId collapses; two physical devices remain");
  assert(
    r.some((d) => /airpods/i.test(d.label)),
    "AirPods label preserved"
  );
  assert(
    r.some((d) => d.label === "Speaker" || /speaker/i.test(d.label)),
    "built-in normalized to Speaker"
  );
}

// 3. Same label + different groupId → keep both
{
  const r = normalizeOutputDevices([
    { deviceId: "a", label: "Headphones", groupId: "G1", kind: "audiooutput" },
    { deviceId: "b", label: "Headphones", groupId: "G2", kind: "audiooutput" },
  ]);
  assert(r.length === 2, "same label different groupId kept separate");
}

// 4. default alias dropped when concrete peer in group
{
  const r = normalizeOutputDevices([
    { deviceId: "default", label: "Default", groupId: "A", kind: "audiooutput" },
    { deviceId: "real", label: "iPhone Speaker", groupId: "A", kind: "audiooutput" },
  ]);
  assert(r.length === 1, "default alias dropped when concrete peer exists");
  assert(r[0].deviceId === "real", "concrete device kept");
  assert(r[0].label === "Speaker", "iPhone Speaker → Speaker");
}

// 5. default alone → System Default
{
  const r = normalizeOutputDevices([
    { deviceId: "default", label: "Default", groupId: "", kind: "audiooutput" },
  ]);
  assert(r.length === 1, "lone default kept");
  assert(r[0].label === "System Default", "lone default labeled System Default");
  assert(isDefaultAliasId("default"), "default is alias id");
}

// 6. AirPods duplicates same group
{
  const r = normalizeOutputDevices([
    { deviceId: "ap1", label: "AirPods", groupId: "BT", kind: "audiooutput" },
    { deviceId: "ap2", label: "AirPods Pro", groupId: "BT", kind: "audiooutput" },
  ]);
  assert(r.length === 1, "AirPods same group → one");
  assert(/airpods/i.test(r[0].label), "AirPods name recognizable");
}

// 7. Zero output devices
{
  const r = normalizeOutputDevices([]);
  assert(r.length === 0, "zero devices → empty list");
}

// 8. Non-output kinds ignored
{
  const r = normalizeOutputDevices([
    { deviceId: "mic", label: "Mic", groupId: "A", kind: "audioinput" },
    { deviceId: "spk", label: "Speaker", groupId: "A", kind: "audiooutput" },
  ]);
  assert(r.length === 1 && r[0].deviceId === "spk", "audioinput excluded");
}

// 9. communications + default collapse
{
  const r = normalizeOutputDevices([
    { deviceId: "default", label: "Default", groupId: "", kind: "audiooutput" },
    { deviceId: "communications", label: "Communications", groupId: "", kind: "audiooutput" },
  ]);
  assert(r.length === 1, "default + communications → one System Default");
}

// 10. label helper
{
  assert(normalizeOutputLabel("Built-in Audio Output", false) === "Speaker", "built-in → Speaker");
  assert(normalizeOutputLabel("John's AirPods", false) === "John's AirPods", "BT name preserved");
}

if (process.exitCode) {
  console.error("\nSome checks failed.");
  process.exit(1);
}
console.log("\nAll output-device checks passed.");
