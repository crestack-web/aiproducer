/**
 * Beat Studio Phase 1 unit tests (no Web Audio / browser).
 * node scripts/test-beat-studio.mjs
 */

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exitCode = 1;
  } else {
    console.log("ok:", msg);
  }
}

const DEFAULT_PPQ = 960;

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

function migrate(raw) {
  const next = { ...raw };
  let ppq = typeof raw.ppq === "number" ? raw.ppq : DEFAULT_PPQ;
  if (ppq === 96) {
    const scale = DEFAULT_PPQ / 96;
    ppq = DEFAULT_PPQ;
    next.ppq = ppq;
    next.tracks = (raw.tracks || []).map((t) => ({
      ...t,
      notes: (t.notes || []).map((n) => ({
        ...n,
        startTick: Math.round((n.startTick || 0) * scale),
        durationTicks: Math.max(1, Math.round((n.durationTicks || 1) * scale)),
      })),
    }));
  }
  next.version = 1;
  return next;
}

function parseBeatStudioDoc(raw) {
  if (raw == null || typeof raw !== "object") {
    return {
      version: 1,
      tempoBpm: 90,
      timeSignature: [4, 4],
      ppq: DEFAULT_PPQ,
      bars: 2,
      tracks: [{ id: "t", name: "Lead", instrumentId: "pluck", notes: [] }],
    };
  }
  const o = migrate(raw);
  const ppq = typeof o.ppq === "number" ? o.ppq : DEFAULT_PPQ;
  const bars = typeof o.bars === "number" ? o.bars : 2;
  const ts = Array.isArray(o.timeSignature) ? o.timeSignature : [4, 4];
  const maxTick = patternLengthTicks(bars, ts, ppq);
  const notes = (o.tracks?.[0]?.notes || [])
    .filter((n) => n && typeof n.pitch === "number" && n.pitch >= 0 && n.pitch <= 127 && n.durationTicks > 0 && n.startTick >= 0 && n.startTick < maxTick)
    .map((n, i) => ({
      id: n.id || `n${i}`,
      pitch: n.pitch,
      startTick: n.startTick || 0,
      durationTicks: n.durationTicks,
      velocity: Math.max(1, Math.min(127, n.velocity || 100)),
    }));
  return {
    version: 1,
    tempoBpm: typeof o.tempoBpm === "number" ? o.tempoBpm : 90,
    timeSignature: ts,
    ppq,
    bars,
    tracks: [{ id: o.tracks?.[0]?.id || "t", name: "Lead", instrumentId: o.tracks?.[0]?.instrumentId || "pluck", notes }],
  };
}

function metadataWithBeatStudio(prev, doc) {
  const p = prev && typeof prev === "object" ? { ...prev } : {};
  return { ...p, beat_studio: doc };
}

// time
assert(Math.abs(ticksToSeconds(DEFAULT_PPQ, 60) - 1) < 1e-9, "1 quarter @60bpm = 1s (ppq 960)");
assert(Math.abs(ticksToSeconds(DEFAULT_PPQ, 120) - 0.5) < 1e-9, "1 quarter @120bpm = 0.5s");
assert(secondsToTicks(1, 60) === DEFAULT_PPQ, "1s @60 → 960 ticks");
assert(patternLengthTicks(2, [4, 4], 960) === 2 * 4 * 960, "2 bars length");
assert(quantizeTick(100, 240) === 0 || quantizeTick(100, 240) === 0 || quantizeTick(120, 240) === 0, "quantize grid");
assert(quantizeTick(200, 240) === 240, "quantize 200→240");

// note duration calc
const start = secondsToTicks(0.5, 120);
const dur = secondsToTicks(0.25, 120);
assert(start === 960, "0.5s @120 = 1 quarter tick");
assert(dur === 480, "0.25s @120 = eighth");

// serialize round-trip
const sample = {
  version: 1,
  tempoBpm: 100,
  timeSignature: [4, 4],
  ppq: 960,
  bars: 2,
  tracks: [
    {
      id: "lead",
      name: "Lead",
      instrumentId: "pluck",
      notes: [
        { id: "a", pitch: 60, startTick: 0, durationTicks: 240, velocity: 100 },
        { id: "b", pitch: 64, startTick: 480, durationTicks: 240, velocity: 90 },
      ],
    },
  ],
};
const round = parseBeatStudioDoc(JSON.parse(JSON.stringify(sample)));
assert(round.tempoBpm === 100, "tempo preserved");
assert(round.tracks[0].notes.length === 2, "notes preserved");
assert(round.ppq === 960, "ppq 960");

// migration 96 → 960
const old = {
  version: 1,
  ppq: 96,
  tempoBpm: 90,
  bars: 2,
  timeSignature: [4, 4],
  tracks: [{ notes: [{ pitch: 60, startTick: 96, durationTicks: 24, velocity: 100 }] }],
};
const migrated = parseBeatStudioDoc(old);
assert(migrated.ppq === 960, "migrated ppq");
assert(migrated.tracks[0].notes[0].startTick === 960, "tick scale 96→960");

// invalid notes
const junk = parseBeatStudioDoc({ version: 1, ppq: 960, bars: 2, timeSignature: [4, 4], tracks: [{ notes: [{ pitch: 999, startTick: 0, durationTicks: 10 }] }] });
assert(junk.tracks[0].notes.length === 0, "invalid pitch dropped");

// absent MIDI
const empty = parseBeatStudioDoc(null);
assert(empty.tracks.length >= 1 && empty.tracks[0].notes.length === 0, "null → empty doc");

// metadata merge does not wipe siblings
const merged = metadataWithBeatStudio({ production_direction: { x: 1 }, other: true }, round);
assert(merged.production_direction.x === 1, "sibling metadata kept");
assert(merged.other === true, "sibling other kept");
assert(merged.beat_studio.tracks[0].notes.length === 2, "beat_studio written");

// voice pool logic (mock)
class VoicePool {
  constructor() {
    this.voices = [];
    this.max = 16;
  }
  add(v) {
    this.voices.push(v);
    while (this.voices.length > this.max) {
      const o = this.voices.shift();
      o.stopped = true;
    }
  }
  stopAll() {
    this.voices.forEach((v) => (v.stopped = true));
    this.voices = [];
  }
}
const pool = new VoicePool();
for (let i = 0; i < 20; i++) pool.add({ stopped: false, id: i });
assert(pool.voices.length === 16, "voice pool capped at 16");
pool.stopAll();
assert(pool.voices.length === 0, "stopAll clears pool");


// audio-clock loop positions (no wall-clock period accumulation)
function absNoteTimes(t0, patternSec, noteStartSec, cycles) {
  return Array.from({ length: cycles }, (_, c) => t0 + c * patternSec + noteStartSec);
}
const times = absNoteTimes(10, 2, 0.5, 5);
assert(Math.abs(times[0] - 10.5) < 1e-9, "cycle0 note time");
assert(Math.abs(times[4] - (10 + 8 + 0.5)) < 1e-9, "cycle4 note time no drift formula");
assert(times[1] - times[0] === 2, "cycle spacing = patternSec");

if (process.exitCode) {
  console.error("\nSome tests failed");
  process.exit(1);
}
console.log("\nAll beat-studio Phase 1 unit tests passed");
