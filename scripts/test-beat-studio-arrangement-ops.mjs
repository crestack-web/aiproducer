/**
 * Arrangement mutation tests (clip add/move/dup/delete, sections, snap).
 */
const PPQ = 960;
const BAR = 4 * PPQ;

function assert(c, m) { if (!c) throw new Error(m); }

function quantizeTick(tick, g) {
  return Math.round(tick / g) * g;
}

function snapTick(tick, barTicks, mode = "bar") {
  if (mode === "none") return Math.max(0, Math.round(tick));
  return Math.max(0, quantizeTick(tick, barTicks));
}

function addClip(doc, trackId, patternId, startTick) {
  const pattern = doc.patterns[patternId];
  if (!pattern) return doc;
  const start = snapTick(startTick, BAR, "bar");
  const clip = {
    id: "clip_" + Math.random().toString(36).slice(2, 8),
    patternId,
    startTick: start,
    durationTicks: pattern.lengthTicks,
  };
  return {
    ...doc,
    tracks: doc.tracks.map((t) =>
      t.id === trackId
        ? { ...t, clips: [...(t.clips || []), clip].sort((a, b) => a.startTick - b.startTick) }
        : t
    ),
    songLengthTicks: Math.max(doc.songLengthTicks, start + pattern.lengthTicks),
  };
}

function moveClip(doc, trackId, clipId, newStart) {
  const start = snapTick(newStart, BAR, "bar");
  return {
    ...doc,
    tracks: doc.tracks.map((t) => {
      if (t.id !== trackId) return t;
      return {
        ...t,
        clips: (t.clips || []).map((c) => (c.id === clipId ? { ...c, startTick: start } : c)),
      };
    }),
  };
}

function duplicateClip(doc, trackId, clipId) {
  const track = doc.tracks.find((t) => t.id === trackId);
  const clip = track?.clips?.find((c) => c.id === clipId);
  if (!clip) return doc;
  const dur = clip.durationTicks || BAR;
  return addClip(doc, trackId, clip.patternId, clip.startTick + dur);
}

function deleteClip(doc, trackId, clipId) {
  return {
    ...doc,
    tracks: doc.tracks.map((t) =>
      t.id === trackId ? { ...t, clips: (t.clips || []).filter((c) => c.id !== clipId) } : t
    ),
  };
}

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log("  ✓", name); passed++; }
  catch (e) { console.error("  ✗", name + ":", e.message); failed++; }
}

const base = {
  version: 2,
  tempoBpm: 120,
  timeSignature: [4, 4],
  ppq: PPQ,
  bars: 8,
  songLengthTicks: 8 * BAR,
  loop: false,
  patterns: {
    p1: { id: "p1", name: "Drums", lengthTicks: 2 * BAR, notes: [], kind: "drum" },
    p2: { id: "p2", name: "Bass", lengthTicks: 2 * BAR, notes: [], kind: "melodic" },
  },
  tracks: [
    { id: "t1", name: "Drums", instrumentId: "drum_kit", clips: [] },
    { id: "t2", name: "Bass", instrumentId: "synth_bass", clips: [] },
  ],
  sections: [],
};

console.log("\nArrangement ops tests\n");

test("add clip snaps to bar", () => {
  let d = addClip(base, "t1", "p1", BAR * 0.4);
  const c = d.tracks[0].clips[0];
  assert(c.startTick === 0, "snapped to 0, got " + c.startTick);
  assert(c.patternId === "p1", "pattern");
});

test("move clip", () => {
  let d = addClip(base, "t1", "p1", 0);
  const id = d.tracks[0].clips[0].id;
  d = moveClip(d, "t1", id, 4 * BAR + 10);
  assert(d.tracks[0].clips[0].startTick === 4 * BAR, "moved to bar 5");
});

test("duplicate places after original", () => {
  let d = addClip(base, "t1", "p1", 0);
  const id = d.tracks[0].clips[0].id;
  d = duplicateClip(d, "t1", id);
  assert(d.tracks[0].clips.length === 2, "2 clips");
  assert(d.tracks[0].clips[1].startTick === 2 * BAR, "after first");
});

test("delete clip", () => {
  let d = addClip(base, "t1", "p1", 0);
  const id = d.tracks[0].clips[0].id;
  d = deleteClip(d, "t1", id);
  assert(d.tracks[0].clips.length === 0, "empty");
});

test("song length extends", () => {
  let d = { ...base, songLengthTicks: 2 * BAR };
  d = addClip(d, "t1", "p1", 6 * BAR);
  assert(d.songLengthTicks >= 8 * BAR, "extended");
});

test("chorus repeat = second clip same pattern", () => {
  let d = addClip(base, "t1", "p1", 0);
  d = addClip(d, "t1", "p1", 8 * BAR);
  assert(d.tracks[0].clips.length === 2, "two placements");
  assert(d.tracks[0].clips.every((c) => c.patternId === "p1"), "same pattern");
});

test("missing pattern rejected", () => {
  const d = addClip(base, "t1", "nope", 0);
  assert((d.tracks[0].clips || []).length === 0, "no clip");
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
