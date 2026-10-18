/**
 * Beat Studio Phase A — document model tests.
 * Run: node scripts/test-beat-studio-v2.mjs
 * Or:  npx tsx scripts/test-beat-studio-v2.mjs  (if importing TS modules)
 *
 * Self-contained reimplementation of core rules so tests run without a TS loader.
 * Mirrors lib/beat-studio/* behavior.
 */

import assert from "node:assert/strict";

const PPQ = 960;

function newId(prefix = "bs") {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function barsToTicks(bars, ts = [4, 4], ppq = PPQ) {
  const [num, den] = ts;
  const quartersPerBar = num * (4 / den);
  return Math.max(0, Math.round(bars * quartersPerBar * ppq));
}

function clampTick(n, fb = 0) {
  const v = typeof n === "number" && Number.isFinite(n) ? Math.round(n) : fb;
  return Math.max(0, v);
}
function clampPitch(n, fb = 60) {
  const v = typeof n === "number" && Number.isFinite(n) ? Math.round(n) : fb;
  return Math.max(0, Math.min(127, v));
}
function clampVelocity(n, fb = 100) {
  const v = typeof n === "number" && Number.isFinite(n) ? Math.round(n) : fb;
  return Math.max(0, Math.min(127, v));
}

function isV1(doc) {
  return !!doc && typeof doc === "object" && doc.version === 1 && Array.isArray(doc.tracks);
}
function isV2(doc) {
  return (
    !!doc &&
    typeof doc === "object" &&
    doc.version === 2 &&
    Array.isArray(doc.patterns) &&
    Array.isArray(doc.tracks)
  );
}

function migrateV1ToV2(v1) {
  const ppq = typeof v1.ppq === "number" && v1.ppq > 0 ? Math.round(v1.ppq) : PPQ;
  const tempoBpm = typeof v1.tempoBpm === "number" && v1.tempoBpm > 0 ? v1.tempoBpm : 90;
  const ts =
    Array.isArray(v1.timeSignature) && v1.timeSignature.length === 2
      ? [Math.max(1, Math.round(v1.timeSignature[0])), Math.max(1, Math.round(v1.timeSignature[1]))]
      : [4, 4];
  const bars = typeof v1.bars === "number" && v1.bars > 0 ? Math.max(1, Math.round(v1.bars)) : 4;
  const loop = v1.loop !== false;
  const patterns = [];
  const tracks = [];
  let lengthTicks = barsToTicks(bars, ts, ppq);

  for (let i = 0; i < (v1.tracks || []).length; i++) {
    const t = v1.tracks[i];
    if (!t || typeof t !== "object") continue;
    const notes = (Array.isArray(t.notes) ? t.notes : [])
      .map((n, j) => {
        if (!n || typeof n !== "object") return null;
        return {
          id: typeof n.id === "string" && n.id.trim() ? n.id.trim() : newId(`note${j}`),
          pitch: clampPitch(n.pitch, 60),
          startTick: clampTick(n.startTick, 0),
          durationTicks: Math.max(1, clampTick(n.durationTicks, 1)),
          velocity: clampVelocity(n.velocity, 100),
        };
      })
      .filter(Boolean);
    let patternLength = lengthTicks;
    for (const n of notes) patternLength = Math.max(patternLength, n.startTick + n.durationTicks);
    lengthTicks = Math.max(lengthTicks, patternLength);
    const patternId = typeof t.id === "string" && t.id.trim() ? `pat_${t.id.trim()}` : newId("pat");
    const trackId = typeof t.id === "string" && t.id.trim() ? t.id.trim() : newId("trk");
    const name = typeof t.name === "string" && t.name.trim() ? t.name.trim() : `Track ${i + 1}`;
    const instrumentId =
      typeof t.instrumentId === "string" && t.instrumentId.trim() ? t.instrumentId.trim() : "default";
    const kind =
      /drum|kick|snare|hat|perc/i.test(name) || /drum/i.test(instrumentId)
        ? "drums"
        : /bass/i.test(name) || /bass/i.test(instrumentId)
          ? "bass"
          : "melody";
    patterns.push({
      id: patternId,
      name: `${name} Pattern`,
      lengthTicks: patternLength,
      notes,
      kind,
    });
    tracks.push({
      id: trackId,
      name,
      instrumentId,
      mute: t.mute === true,
      solo: t.solo === true,
      params: t.params && typeof t.params === "object" ? { ...t.params } : undefined,
      clips: [{ id: newId("clip"), patternId, startTick: 0, durationTicks: patternLength }],
    });
  }

  return {
    version: 2,
    tempoBpm,
    timeSignature: ts,
    ppq,
    lengthTicks,
    loop,
    patterns,
    tracks,
    sections: [{ id: newId("sec"), name: "Song", kind: "custom", startTick: 0, lengthTicks }],
    selectedPatternId: patterns[0]?.id,
  };
}

function ensureV2(doc) {
  if (!doc) {
    return {
      version: 2,
      tempoBpm: 90,
      timeSignature: [4, 4],
      ppq: PPQ,
      lengthTicks: barsToTicks(4),
      loop: true,
      patterns: [],
      tracks: [],
      sections: [],
    };
  }
  if (isV2(doc)) return doc;
  if (isV1(doc)) return migrateV1ToV2(doc);
  return ensureV2(null);
}

function duplicatePattern(pattern, nameSuffix = " Copy") {
  return {
    id: newId("pat"),
    name: `${pattern.name}${nameSuffix}`,
    lengthTicks: pattern.lengthTicks,
    kind: pattern.kind,
    notes: pattern.notes.map((n, i) => ({
      id: newId(`note${i}`),
      pitch: n.pitch,
      startTick: n.startTick,
      durationTicks: n.durationTicks,
      velocity: n.velocity,
    })),
  };
}

function normalizeV2(raw) {
  const ppq = typeof raw.ppq === "number" && raw.ppq > 0 ? Math.round(raw.ppq) : PPQ;
  const tempoBpm = typeof raw.tempoBpm === "number" && raw.tempoBpm > 0 ? raw.tempoBpm : 90;
  const ts =
    Array.isArray(raw.timeSignature) && raw.timeSignature.length === 2
      ? [Math.max(1, Math.round(raw.timeSignature[0])), Math.max(1, Math.round(raw.timeSignature[1]))]
      : [4, 4];

  const seenPat = new Set();
  let patterns = (Array.isArray(raw.patterns) ? raw.patterns : [])
    .map((p, i) => {
      if (!p || typeof p !== "object") return null;
      let id = typeof p.id === "string" && p.id.trim() ? p.id.trim() : newId(`pat${i}`);
      if (seenPat.has(id)) id = newId(`pat${i}`);
      seenPat.add(id);
      const notes = (Array.isArray(p.notes) ? p.notes : [])
        .map((n, j) => {
          if (!n || typeof n !== "object") return null;
          return {
            id: typeof n.id === "string" && n.id.trim() ? n.id.trim() : newId(`note${j}`),
            pitch: clampPitch(n.pitch, 60),
            startTick: clampTick(n.startTick, 0),
            durationTicks: Math.max(1, clampTick(n.durationTicks, 1)),
            velocity: clampVelocity(n.velocity, 100),
          };
        })
        .filter(Boolean);
      return {
        id,
        name: typeof p.name === "string" && p.name.trim() ? p.name.trim() : `Pattern ${i + 1}`,
        lengthTicks: Math.max(1, clampTick(p.lengthTicks, barsToTicks(1))),
        notes,
        kind: p.kind,
      };
    })
    .filter(Boolean);

  const patternIds = new Set(patterns.map((p) => p.id));

  let tracks = (Array.isArray(raw.tracks) ? raw.tracks : []).map((t, ti) => {
    const clips = (Array.isArray(t?.clips) ? t.clips : [])
      .map((c, ci) => {
        if (!c || typeof c !== "object") return null;
        const patternId = typeof c.patternId === "string" ? c.patternId.trim() : "";
        if (!patternId || !patternIds.has(patternId)) return null;
        return {
          id: typeof c.id === "string" && c.id.trim() ? c.id.trim() : newId(`clip${ci}`),
          patternId,
          startTick: clampTick(c.startTick, 0),
          durationTicks:
            c.durationTicks === undefined || c.durationTicks === null
              ? undefined
              : Math.max(1, clampTick(c.durationTicks, 1)),
          transpose:
            typeof c.transpose === "number" && Number.isFinite(c.transpose)
              ? Math.round(c.transpose)
              : undefined,
          velocityScale:
            typeof c.velocityScale === "number" && Number.isFinite(c.velocityScale)
              ? Math.max(0, Math.min(4, c.velocityScale))
              : undefined,
          mute: c.mute === true ? true : undefined,
        };
      })
      .filter(Boolean);
    return {
      id: typeof t?.id === "string" && t.id.trim() ? t.id.trim() : newId(`trk${ti}`),
      name: typeof t?.name === "string" && t.name.trim() ? t.name.trim() : `Track ${ti + 1}`,
      instrumentId:
        typeof t?.instrumentId === "string" && t.instrumentId.trim()
          ? t.instrumentId.trim()
          : "default",
      mute: t?.mute === true ? true : undefined,
      solo: t?.solo === true ? true : undefined,
      params: t?.params && typeof t.params === "object" ? { ...t.params } : undefined,
      clips,
    };
  });

  // uniquify track ids
  const seenTrk = new Set();
  tracks = tracks.map((t, i) => {
    let id = t.id;
    if (seenTrk.has(id)) id = newId(`trk${i}`);
    seenTrk.add(id);
    return id === t.id ? t : { ...t, id };
  });

  let sections = (Array.isArray(raw.sections) ? raw.sections : [])
    .map((s, i) => {
      if (!s || typeof s !== "object") return null;
      return {
        id: typeof s.id === "string" && s.id.trim() ? s.id.trim() : newId(`sec${i}`),
        name: typeof s.name === "string" && s.name.trim() ? s.name.trim() : `Section ${i + 1}`,
        kind: s.kind || "custom",
        startTick: clampTick(s.startTick, 0),
        lengthTicks: Math.max(1, clampTick(s.lengthTicks, barsToTicks(4))),
        color: typeof s.color === "string" ? s.color : undefined,
      };
    })
    .filter(Boolean);

  let lengthTicks =
    typeof raw.lengthTicks === "number" && raw.lengthTicks > 0
      ? Math.round(raw.lengthTicks)
      : barsToTicks(4, ts, ppq);
  for (const tr of tracks) {
    for (const c of tr.clips) {
      const dur = c.durationTicks ?? patterns.find((p) => p.id === c.patternId)?.lengthTicks ?? 0;
      lengthTicks = Math.max(lengthTicks, c.startTick + dur);
    }
  }
  for (const s of sections) lengthTicks = Math.max(lengthTicks, s.startTick + s.lengthTicks);
  if (sections.length === 0) {
    sections = [{ id: newId("sec"), name: "Song", kind: "custom", startTick: 0, lengthTicks }];
  }

  let selectedPatternId =
    typeof raw.selectedPatternId === "string" ? raw.selectedPatternId : undefined;
  if (selectedPatternId && !patternIds.has(selectedPatternId)) selectedPatternId = patterns[0]?.id;
  else if (!selectedPatternId && patterns[0]) selectedPatternId = patterns[0].id;

  return {
    version: 2,
    tempoBpm,
    timeSignature: ts,
    ppq,
    lengthTicks,
    loop: raw.loop !== false,
    patterns,
    tracks,
    sections,
    selectedPatternId,
  };
}

function parseBeatStudioDoc(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (raw.version === 1 && Array.isArray(raw.tracks)) return raw;
  if (raw.version === 2) return normalizeV2(raw);
  if (Array.isArray(raw.patterns) && Array.isArray(raw.tracks))
    return normalizeV2({ ...raw, version: 2 });
  if (Array.isArray(raw.tracks) && !Array.isArray(raw.patterns))
    return { ...raw, version: 1 };
  return null;
}

function serializeBeatStudioDoc(doc) {
  if (isV2(doc)) return normalizeV2(doc);
  if (isV1(doc)) return normalizeV2(migrateV1ToV2(doc));
  return ensureV2(null);
}

function metadataWithBeatStudio(prev, doc) {
  const out = prev && typeof prev === "object" ? { ...prev } : {};
  out.beat_studio = serializeBeatStudioDoc(doc);
  return out;
}

function setPatternNotes(doc, patternId, notes) {
  const patterns = doc.patterns.map((p) => {
    if (p.id !== patternId) return p;
    let lengthTicks = p.lengthTicks;
    for (const n of notes) lengthTicks = Math.max(lengthTicks, n.startTick + n.durationTicks);
    return { ...p, notes: notes.map((n) => ({ ...n })), lengthTicks };
  });
  return { ...doc, patterns };
}

function toPlaybackDoc(doc) {
  const d = ensureV2(doc);
  const bars = Math.max(1, Math.ceil(d.lengthTicks / (d.timeSignature[0] * (4 / d.timeSignature[1]) * d.ppq)));
  const tracks = [];
  for (const track of d.tracks) {
    if (track.mute) continue;
    const notes = [];
    for (const clip of track.clips) {
      if (clip.mute) continue;
      const pattern = d.patterns.find((p) => p.id === clip.patternId);
      if (!pattern) continue;
      const transpose = clip.transpose ?? 0;
      const velScale = clip.velocityScale ?? 1;
      const clipDur = clip.durationTicks ?? pattern.lengthTicks;
      for (const n of pattern.notes) {
        if (n.startTick >= clipDur) continue;
        const dur = Math.min(n.durationTicks, clipDur - n.startTick);
        if (dur <= 0) continue;
        notes.push({
          id: `${clip.id}_${n.id}`,
          pitch: Math.max(0, Math.min(127, n.pitch + transpose)),
          startTick: clip.startTick + n.startTick,
          durationTicks: dur,
          velocity: Math.max(0, Math.min(127, Math.round(n.velocity * velScale))),
        });
      }
    }
    tracks.push({
      id: track.id,
      name: track.name,
      instrumentId: track.instrumentId,
      mute: track.mute,
      solo: track.solo,
      params: track.params,
      notes,
    });
  }
  return {
    version: 1,
    tempoBpm: d.tempoBpm,
    timeSignature: d.timeSignature,
    ppq: d.ppq,
    bars,
    loop: d.loop,
    tracks,
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const v1Fixture = {
  version: 1,
  tempoBpm: 92,
  timeSignature: [4, 4],
  ppq: 960,
  bars: 8,
  loop: true,
  tracks: [
    {
      id: "trk_drums",
      name: "Drums",
      instrumentId: "drum-kit",
      mute: false,
      solo: false,
      params: { gain: 0.8 },
      notes: [
        { id: "n1", pitch: 36, startTick: 0, durationTicks: 120, velocity: 110 },
        { id: "n2", pitch: 38, startTick: 480, durationTicks: 120, velocity: 100 },
        { id: "n3", pitch: 42, startTick: 240, durationTicks: 60, velocity: 90 },
      ],
    },
    {
      id: "trk_melody",
      name: "Melody",
      instrumentId: "synth-lead",
      notes: [
        { id: "m1", pitch: 60, startTick: 0, durationTicks: 480, velocity: 100 },
        { id: "m2", pitch: 64, startTick: 480, durationTicks: 480, velocity: 95 },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(`    ${e.message}`);
  }
}

console.log("Beat Studio Phase A — document model tests\n");

// 1. Parsing existing v1 fixtures
test("1. parse existing v1 fixture", () => {
  const parsed = parseBeatStudioDoc(v1Fixture);
  assert.ok(parsed);
  assert.equal(parsed.version, 1);
  assert.equal(parsed.tracks.length, 2);
  assert.equal(parsed.tempoBpm, 92);
});

// 2. Migrating v1 → v2
test("2. migrate v1 to v2", () => {
  const v2 = migrateV1ToV2(v1Fixture);
  assert.equal(v2.version, 2);
  assert.equal(v2.patterns.length, 2);
  assert.equal(v2.tracks.length, 2);
  assert.ok(v2.sections.length >= 1);
  assert.equal(v2.tempoBpm, 92);
  assert.equal(v2.ppq, 960);
});

// 3. Preserve every track and note
test("3. preserve every track and note", () => {
  const v2 = migrateV1ToV2(v1Fixture);
  const allNotes = v2.patterns.flatMap((p) => p.notes);
  assert.equal(allNotes.length, 5);
  const pitches = allNotes.map((n) => n.pitch).sort((a, b) => a - b);
  assert.deepEqual(pitches, [36, 38, 42, 60, 64]);
  // Note IDs preserved
  assert.ok(allNotes.some((n) => n.id === "n1"));
  assert.ok(allNotes.some((n) => n.id === "m1"));
});

// 4. Preserve track instrument settings
test("4. preserve track instrument settings", () => {
  const v2 = migrateV1ToV2(v1Fixture);
  const drums = v2.tracks.find((t) => t.id === "trk_drums");
  assert.ok(drums);
  assert.equal(drums.instrumentId, "drum-kit");
  assert.equal(drums.params?.gain, 0.8);
  const melody = v2.tracks.find((t) => t.id === "trk_melody");
  assert.equal(melody.instrumentId, "synth-lead");
});

// 5. Saving and reloading v2
test("5. save and reload v2", () => {
  const v2 = migrateV1ToV2(v1Fixture);
  const serialized = serializeBeatStudioDoc(v2);
  const json = JSON.parse(JSON.stringify(serialized));
  const reloaded = parseBeatStudioDoc(json);
  assert.ok(isV2(reloaded));
  assert.equal(reloaded.patterns.length, 2);
  assert.equal(reloaded.tracks.length, 2);
});

// 6. Round-trip serialization
test("6. round-trip serialization", () => {
  const v2 = migrateV1ToV2(v1Fixture);
  const a = serializeBeatStudioDoc(v2);
  const b = serializeBeatStudioDoc(a);
  assert.equal(a.patterns.length, b.patterns.length);
  assert.equal(a.tracks[0].clips[0].patternId, b.tracks[0].clips[0].patternId);
  assert.equal(
    a.patterns[0].notes.map((n) => n.pitch).join(","),
    b.patterns[0].notes.map((n) => n.pitch).join(",")
  );
});

// 7. Invalid pattern references dropped
test("7. invalid pattern references dropped", () => {
  const v2 = migrateV1ToV2(v1Fixture);
  v2.tracks[0].clips.push({
    id: "bad_clip",
    patternId: "does_not_exist",
    startTick: 0,
  });
  const normalized = normalizeV2(v2);
  const allClipIds = normalized.tracks.flatMap((t) => t.clips.map((c) => c.id));
  assert.ok(!allClipIds.includes("bad_clip"));
});

// 8. Duplicate IDs repaired
test("8. duplicate IDs repaired", () => {
  const v2 = migrateV1ToV2(v1Fixture);
  // Force duplicate pattern id
  if (v2.patterns.length >= 2) {
    v2.patterns[1] = { ...v2.patterns[1], id: v2.patterns[0].id };
  }
  const normalized = normalizeV2(v2);
  const ids = normalized.patterns.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
});

// 9. Empty patterns and empty projects
test("9. empty projects", () => {
  const empty = ensureV2(null);
  assert.equal(empty.version, 2);
  assert.equal(empty.patterns.length, 0);
  assert.equal(empty.tracks.length, 0);
  const emptyV1 = migrateV1ToV2({
    version: 1,
    tempoBpm: 100,
    timeSignature: [4, 4],
    ppq: 960,
    bars: 4,
    loop: true,
    tracks: [],
  });
  assert.equal(emptyV1.patterns.length, 0);
  assert.ok(emptyV1.lengthTicks > 0);
});

// 10. Clip positions and durations
test("10. clip positions and durations", () => {
  const v2 = migrateV1ToV2(v1Fixture);
  for (const tr of v2.tracks) {
    for (const c of tr.clips) {
      assert.ok(c.startTick >= 0);
      if (c.durationTicks !== undefined) assert.ok(c.durationTicks > 0);
    }
  }
  // Negative start clamped on normalize
  v2.tracks[0].clips[0] = { ...v2.tracks[0].clips[0], startTick: -100 };
  const n = normalizeV2(v2);
  assert.equal(n.tracks[0].clips[0].startTick, 0);
});

// 11. Pattern duplication without modifying original
test("11. pattern duplication without modifying original", () => {
  const v2 = migrateV1ToV2(v1Fixture);
  const original = v2.patterns[0];
  const originalNotesJson = JSON.stringify(original.notes);
  const copy = duplicatePattern(original);
  assert.notEqual(copy.id, original.id);
  assert.ok(copy.name.includes("Copy"));
  assert.equal(copy.notes.length, original.notes.length);
  // New note IDs
  assert.notEqual(copy.notes[0].id, original.notes[0].id);
  // Original untouched
  assert.equal(JSON.stringify(original.notes), originalNotesJson);
});

// 12. Multiple clips referencing the same pattern
test("12. multiple clips referencing same pattern", () => {
  const v2 = migrateV1ToV2(v1Fixture);
  const patternId = v2.patterns[0].id;
  const len = v2.patterns[0].lengthTicks;
  v2.tracks[0].clips.push({
    id: newId("clip"),
    patternId,
    startTick: len,
    durationTicks: len,
  });
  const normalized = normalizeV2(v2);
  const clipsForPat = normalized.tracks[0].clips.filter((c) => c.patternId === patternId);
  assert.equal(clipsForPat.length, 2);
  const playback = toPlaybackDoc(normalized);
  // Notes should appear twice (once per clip), shifted
  const drumTrack = playback.tracks.find((t) => t.id === "trk_drums");
  assert.ok(drumTrack);
  assert.ok(drumTrack.notes.length >= 6); // 3 notes × 2 clips
});

// 13. Sibling metadata preservation
test("13. sibling metadata preservation", () => {
  const prev = {
    production_direction: { mood: "dark" },
    other_key: 42,
  };
  const v2 = migrateV1ToV2(v1Fixture);
  const merged = metadataWithBeatStudio(prev, v2);
  assert.equal(merged.other_key, 42);
  assert.deepEqual(merged.production_direction, { mood: "dark" });
  assert.ok(merged.beat_studio);
  assert.equal(merged.beat_studio.version, 2);
});

// 14. Drum-grid style conversion (notes preserved through setPatternNotes)
test("14. drum-grid note update on selected pattern only", () => {
  const v2 = migrateV1ToV2(v1Fixture);
  const targetId = v2.patterns[0].id;
  const otherId = v2.patterns[1].id;
  const otherNotesBefore = JSON.stringify(v2.patterns[1].notes);
  const newNotes = [
    { id: "x1", pitch: 36, startTick: 0, durationTicks: 100, velocity: 120 },
  ];
  const updated = setPatternNotes(v2, targetId, newNotes);
  assert.equal(updated.patterns.find((p) => p.id === targetId).notes.length, 1);
  assert.equal(
    JSON.stringify(updated.patterns.find((p) => p.id === otherId).notes),
    otherNotesBefore
  );
});

// 15. Playback conversion preserves instrument + tempo
test("15. toPlaybackDoc preserves instrument and tempo", () => {
  const v2 = migrateV1ToV2(v1Fixture);
  const pb = toPlaybackDoc(v2);
  assert.equal(pb.version, 1);
  assert.equal(pb.tempoBpm, 92);
  assert.ok(pb.tracks.some((t) => t.instrumentId === "drum-kit"));
  assert.ok(pb.tracks.some((t) => t.instrumentId === "synth-lead"));
});

// 16. Malformed document handling
test("16. malformed documents do not throw", () => {
  assert.equal(parseBeatStudioDoc(null), null);
  assert.equal(parseBeatStudioDoc(undefined), null);
  assert.equal(parseBeatStudioDoc("string"), null);
  assert.equal(parseBeatStudioDoc(42), null);
  const empty = ensureV2(parseBeatStudioDoc({ version: 99 }));
  assert.equal(empty.version, 2);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
