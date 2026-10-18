/**
 * Unit tests for Beat Studio time math + serialize round-trip (no Web Audio).
 * Run: node scripts/test-beat-studio.mjs
 */

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exitCode = 1;
  } else {
    console.log("ok:", msg);
  }
}

const DEFAULT_PPQ = 96;

function secondsPerTick(tempoBpm, ppq = DEFAULT_PPQ) {
  const bpm = Math.max(20, Math.min(300, tempoBpm || 120));
  const p = Math.max(1, ppq || DEFAULT_PPQ);
  return 60 / bpm / p;
}

function ticksToSeconds(ticks, tempoBpm, ppq = DEFAULT_PPQ) {
  return Math.max(0, ticks) * secondsPerTick(tempoBpm, ppq);
}

function secondsToTicks(seconds, tempoBpm, ppq = DEFAULT_PPQ) {
  const spt = secondsPerTick(tempoBpm, ppq);
  if (spt <= 0) return 0;
  return Math.round(Math.max(0, seconds) / spt);
}

function patternLengthTicks(bars, timeSignature, ppq = DEFAULT_PPQ) {
  const [num, den] = timeSignature;
  const beatsPerBar = num * (4 / Math.max(1, den));
  return Math.max(1, Math.round(bars * beatsPerBar * ppq));
}

function quantizeTick(tick, gridTicks) {
  const g = Math.max(1, gridTicks);
  return Math.round(tick / g) * g;
}

// --- time ---
assert(Math.abs(ticksToSeconds(DEFAULT_PPQ, 60) - 1) < 1e-9, "1 quarter at 60bpm = 1s");
assert(Math.abs(ticksToSeconds(DEFAULT_PPQ, 120) - 0.5) < 1e-9, "1 quarter at 120bpm = 0.5s");
assert(secondsToTicks(1, 60) === DEFAULT_PPQ, "1s at 60bpm = 1 quarter in ticks");
assert(patternLengthTicks(2, [4, 4], 96) === 2 * 4 * 96, "2 bars 4/4 length");
assert(quantizeTick(50, 24) === 48, "quantize to 24");

// --- serialize (inline minimal parse) ---
function parseBeatStudioDoc(raw) {
  if (!raw || typeof raw !== "object") {
    return { version: 1, tempoBpm: 90, timeSignature: [4, 4], ppq: 96, bars: 2, tracks: [{ id: "t", name: "Lead", instrumentId: "synth_lead", notes: [] }] };
  }
  const o = raw;
  const notes = Array.isArray(o.tracks?.[0]?.notes) ? o.tracks[0].notes : [];
  return {
    version: 1,
    tempoBpm: typeof o.tempoBpm === "number" ? o.tempoBpm : 90,
    timeSignature: Array.isArray(o.timeSignature) ? o.timeSignature : [4, 4],
    ppq: typeof o.ppq === "number" ? o.ppq : 96,
    bars: typeof o.bars === "number" ? o.bars : 2,
    tracks: [
      {
        id: o.tracks?.[0]?.id || "t",
        name: "Lead",
        instrumentId: "synth_lead",
        notes: notes
          .filter((n) => n && typeof n.pitch === "number" && n.durationTicks > 0)
          .map((n, i) => ({
            id: n.id || `n${i}`,
            pitch: n.pitch,
            startTick: n.startTick || 0,
            durationTicks: n.durationTicks,
            velocity: n.velocity || 100,
          })),
      },
    ],
  };
}

const sample = {
  version: 1,
  tempoBpm: 100,
  timeSignature: [4, 4],
  ppq: 96,
  bars: 2,
  tracks: [
    {
      id: "lead",
      name: "Lead",
      instrumentId: "synth_lead",
      notes: [
        { id: "a", pitch: 60, startTick: 0, durationTicks: 24, velocity: 100 },
        { id: "b", pitch: 64, startTick: 48, durationTicks: 24, velocity: 90 },
      ],
    },
  ],
};

const round = parseBeatStudioDoc(JSON.parse(JSON.stringify(sample)));
assert(round.tempoBpm === 100, "tempo preserved");
assert(round.tracks[0].notes.length === 2, "notes preserved");
assert(round.tracks[0].notes[1].pitch === 64, "pitch preserved");

const junk = parseBeatStudioDoc({ version: 1, tracks: [{ notes: [{ pitch: 999 }] }] });
assert(junk.tracks[0].notes.length === 0, "invalid notes dropped");

const empty = parseBeatStudioDoc(null);
assert(empty.tracks.length >= 1, "null → empty doc with track");

if (process.exitCode) {
  console.error("\nSome tests failed");
  process.exit(1);
}
console.log("\nAll beat-studio tests passed");
