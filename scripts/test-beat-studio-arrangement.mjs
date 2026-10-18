/**
 * Deterministic tests for Beat Studio arrangement scheduling (Phase B math).
 * Pure tick math — does not claim audible Web Audio verification.
 *
 * Run: node scripts/test-beat-studio-arrangement.mjs
 */

const PPQ = 960;
const BAR = 4 * PPQ; // 4/4 bar

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// --- Inline minimal reimplementation matching schedule.ts contracts ---
// (Node tests stay dependency-free; logic mirrors lib/beat-studio/schedule.ts)

function expandClipNotes(patternNotes, patternLengthTicks, clip, opts = {}) {
  const loop = opts.loopPatternsInClip !== false;
  const patternLen = Math.max(1, patternLengthTicks);
  const clipDur = Math.max(0, clip.durationTicks);
  if (clipDur <= 0) return [];
  const transpose = clip.transpose ?? 0;
  const velScale = clip.velocityScale ?? 1;
  const out = [];
  const iterations = loop ? Math.ceil(clipDur / patternLen) : 1;
  for (let i = 0; i < iterations; i++) {
    const cycleStart = i * patternLen;
    if (cycleStart >= clipDur) break;
    for (const n of patternNotes) {
      const localStart = cycleStart + n.startTick;
      if (localStart >= clipDur || localStart < 0) continue;
      const dur = Math.min(n.durationTicks, clipDur - localStart);
      if (dur <= 0) continue;
      out.push({
        id: `${clip.id}_${i}_${n.id}`,
        startTick: clip.startTick + localStart,
        durationTicks: dur,
        pitch: Math.max(0, Math.min(127, n.pitch + transpose)),
        velocity: Math.max(0, Math.min(127, Math.round(n.velocity * velScale))),
        patternNoteId: n.id,
      });
    }
  }
  return out;
}

function scheduleArrangement(doc, options = {}) {
  const fromTick = options.fromTick ?? 0;
  const toTick = options.toTick ?? doc.lengthTicks;
  const loopPatternsInClip = options.loopPatternsInClip !== false;
  if (!(toTick > fromTick)) return [];
  const anySolo = doc.tracks.some((t) => t.solo && !t.mute);
  const events = [];
  for (const track of doc.tracks) {
    if (track.mute) continue;
    if (anySolo && !track.solo) continue;
    for (const clip of track.clips) {
      if (clip.mute) continue;
      const pattern = doc.patterns.find((p) => p.id === clip.patternId);
      if (!pattern) continue;
      const clipDur = clip.durationTicks ?? pattern.lengthTicks;
      if (clip.startTick + clipDur <= fromTick) continue;
      if (clip.startTick >= toTick) continue;
      const expanded = expandClipNotes(
        pattern.notes,
        pattern.lengthTicks,
        {
          id: clip.id,
          startTick: clip.startTick,
          durationTicks: clipDur,
          transpose: clip.transpose,
          velocityScale: clip.velocityScale,
        },
        { loopPatternsInClip }
      );
      for (const n of expanded) {
        if (n.startTick < fromTick || n.startTick >= toTick) continue;
        if (n.startTick >= doc.lengthTicks && options.toTick === undefined) continue;
        events.push({
          id: n.id,
          trackId: track.id,
          clipId: clip.id,
          patternId: pattern.id,
          instrumentId: track.instrumentId,
          startTick: n.startTick,
          durationTicks: n.durationTicks,
          pitch: n.pitch,
          velocity: n.velocity,
        });
      }
    }
  }
  events.sort((a, b) => {
    if (a.startTick !== b.startTick) return a.startTick - b.startTick;
    if (a.trackId !== b.trackId) return a.trackId < b.trackId ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return events;
}

// --- Fixtures ---

function makeSong() {
  // Intro 4 bars, Verse 16 bars, Chorus 8 bars → total 28 bars
  const introLen = 4 * BAR;
  const verseLen = 16 * BAR;
  const chorusLen = 8 * BAR;
  const total = introLen + verseLen + chorusLen;

  const drumPat = {
    id: "pat-drums",
    name: "Drums",
    lengthTicks: BAR,
    kind: "drums",
    notes: [
      { id: "k1", pitch: 36, startTick: 0, durationTicks: 120, velocity: 100 },
      { id: "s1", pitch: 38, startTick: PPQ * 2, durationTicks: 120, velocity: 90 },
    ],
  };
  const drumVar = {
    id: "pat-drums-chorus",
    name: "Drums Chorus",
    lengthTicks: BAR,
    kind: "drums",
    notes: [
      { id: "k2", pitch: 36, startTick: 0, durationTicks: 120, velocity: 110 },
      { id: "s2", pitch: 38, startTick: PPQ, durationTicks: 120, velocity: 100 },
      { id: "s3", pitch: 38, startTick: PPQ * 3, durationTicks: 120, velocity: 100 },
    ],
  };
  const bassPat = {
    id: "pat-bass",
    name: "Bass",
    lengthTicks: 2 * BAR,
    kind: "bass",
    notes: [
      { id: "b1", pitch: 40, startTick: 0, durationTicks: BAR, velocity: 80 },
    ],
  };

  return {
    version: 2,
    tempoBpm: 120,
    timeSignature: [4, 4],
    ppq: PPQ,
    lengthTicks: total,
    loop: false,
    patterns: [drumPat, drumVar, bassPat],
    tracks: [
      {
        id: "trk-drums",
        name: "Drums",
        instrumentId: "drums",
        clips: [
          // Intro + verse: shared drum pattern, 20 bars
          {
            id: "c-drums-iv",
            patternId: "pat-drums",
            startTick: 0,
            durationTicks: introLen + verseLen,
          },
          // Chorus variation
          {
            id: "c-drums-ch",
            patternId: "pat-drums-chorus",
            startTick: introLen + verseLen,
            durationTicks: chorusLen,
            transpose: 0,
            velocityScale: 1.1,
          },
        ],
      },
      {
        id: "trk-bass",
        name: "Bass",
        instrumentId: "bass",
        clips: [
          {
            id: "c-bass",
            patternId: "pat-bass",
            startTick: introLen, // starts at verse
            durationTicks: verseLen + chorusLen,
            transpose: 2,
          },
        ],
      },
    ],
    sections: [
      { id: "s-intro", name: "Intro", kind: "intro", startTick: 0, lengthTicks: introLen },
      {
        id: "s-verse",
        name: "Verse",
        kind: "verse",
        startTick: introLen,
        lengthTicks: verseLen,
      },
      {
        id: "s-chorus",
        name: "Chorus",
        kind: "chorus",
        startTick: introLen + verseLen,
        lengthTicks: chorusLen,
      },
    ],
  };
}

// --- Tests ---

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ✗ ${name}: ${e.message}`);
    failed++;
  }
}

console.log("\nBeat Studio Phase B — arrangement scheduling tests\n");

const song = makeSong();
const introLen = 4 * BAR;
const verseStart = introLen;
const chorusStart = introLen + 16 * BAR;

test("1. note in first clip at song position 0", () => {
  const ev = scheduleArrangement(song);
  const kicksAt0 = ev.filter((e) => e.startTick === 0 && e.pitch === 36);
  assert(kicksAt0.length >= 1, "expected kick at tick 0");
  assert(kicksAt0[0].trackId === "trk-drums", "drums track");
});

test("2. note in later clip at correct song position (chorus)", () => {
  const ev = scheduleArrangement(song);
  // Chorus drum pattern has snare at PPQ (beat 2) relative → absolute chorusStart + PPQ
  const snare = ev.find(
    (e) =>
      e.clipId === "c-drums-ch" &&
      e.pitch === 38 &&
      e.startTick === chorusStart + PPQ
  );
  assert(snare, `chorus snare at ${chorusStart + PPQ}, got ticks: ${ev.filter((e) => e.clipId === "c-drums-ch" && e.pitch === 38).map((e) => e.startTick).slice(0, 5)}`);
  // Must NOT appear at bar 1
  const wrong = ev.find(
    (e) => e.clipId === "c-drums-ch" && e.startTick < chorusStart
  );
  assert(!wrong, "chorus notes must not appear before chorus");
});

test("3. two clips sharing same pattern (intro/verse drums)", () => {
  // Single long clip uses same pattern — verify pattern repeats at bar 1 and bar 5
  const ev = scheduleArrangement(song);
  const bar0Kick = ev.find((e) => e.startTick === 0 && e.pitch === 36 && e.clipId === "c-drums-iv");
  const bar4Kick = ev.find((e) => e.startTick === 4 * BAR && e.pitch === 36 && e.clipId === "c-drums-iv");
  assert(bar0Kick, "kick at bar 0");
  assert(bar4Kick, "kick at bar 4 (pattern loop inside clip)");
});

test("4. chorus variation uses different pattern", () => {
  const ev = scheduleArrangement(song);
  const chorusEvents = ev.filter((e) => e.clipId === "c-drums-ch");
  assert(chorusEvents.length > 0, "chorus has events");
  assert(
    chorusEvents.every((e) => e.patternId === "pat-drums-chorus"),
    "chorus uses variation pattern"
  );
  // Chorus has 3 notes per bar vs 2 in main pattern
  const firstBarChorus = chorusEvents.filter(
    (e) => e.startTick >= chorusStart && e.startTick < chorusStart + BAR
  );
  assert(firstBarChorus.length === 3, `expected 3 hits in first chorus bar, got ${firstBarChorus.length}`);
});

test("5. clip transpose", () => {
  const ev = scheduleArrangement(song);
  const bass = ev.filter((e) => e.trackId === "trk-bass");
  assert(bass.length > 0, "bass events exist");
  // pattern pitch 40 + transpose 2 = 42
  assert(
    bass.every((e) => e.pitch === 42),
    `expected pitch 42, got ${[...new Set(bass.map((e) => e.pitch))]}`
  );
});

test("6. velocity scaling", () => {
  const ev = scheduleArrangement(song);
  // Chorus velocityScale 1.1 on kick velocity 110 → 121
  const kick = ev.find(
    (e) => e.clipId === "c-drums-ch" && e.pitch === 36 && e.startTick === chorusStart
  );
  assert(kick, "chorus kick");
  assert(kick.velocity === 121, `expected vel 121, got ${kick.velocity}`);
});

test("7. muted clips emit nothing", () => {
  const muted = structuredClone(song);
  muted.tracks[0].clips[1].mute = true;
  const ev = scheduleArrangement(muted);
  assert(
    !ev.some((e) => e.clipId === "c-drums-ch"),
    "muted chorus clip should emit nothing"
  );
  assert(ev.some((e) => e.clipId === "c-drums-iv"), "other clip still plays");
});

test("8. muted tracks emit nothing", () => {
  const muted = structuredClone(song);
  muted.tracks[1].mute = true;
  const ev = scheduleArrangement(muted);
  assert(!ev.some((e) => e.trackId === "trk-bass"), "muted bass silent");
  assert(ev.some((e) => e.trackId === "trk-drums"), "drums still play");
});

test("9. soloed tracks silence non-solo", () => {
  const soloed = structuredClone(song);
  soloed.tracks[1].solo = true;
  const ev = scheduleArrangement(soloed);
  assert(ev.every((e) => e.trackId === "trk-bass"), "only bass when soloed");
  assert(ev.length > 0, "bass still has notes");
});

test("10. clip boundaries truncate notes", () => {
  const short = {
    version: 2,
    tempoBpm: 120,
    timeSignature: [4, 4],
    ppq: PPQ,
    lengthTicks: BAR,
    loop: false,
    patterns: [
      {
        id: "p",
        name: "P",
        lengthTicks: BAR,
        notes: [
          { id: "n1", pitch: 60, startTick: 0, durationTicks: BAR, velocity: 100 },
          { id: "n2", pitch: 62, startTick: PPQ * 3, durationTicks: PPQ, velocity: 100 },
        ],
      },
    ],
    tracks: [
      {
        id: "t",
        name: "T",
        instrumentId: "x",
        clips: [
          {
            id: "c",
            patternId: "p",
            startTick: 0,
            durationTicks: PPQ * 2, // only half bar
          },
        ],
      },
    ],
    sections: [],
  };
  const ev = scheduleArrangement(short);
  assert(ev.length === 1, `only first note fits, got ${ev.length}`);
  assert(ev[0].durationTicks === PPQ * 2, "note truncated to clip end");
  assert(!ev.some((e) => e.pitch === 62), "late note excluded");
});

test("11. song-end: notes at/after lengthTicks excluded by default", () => {
  const doc = structuredClone(song);
  doc.lengthTicks = chorusStart; // cut song before chorus
  const ev = scheduleArrangement(doc);
  assert(
    !ev.some((e) => e.startTick >= chorusStart),
    "no events at/after song end"
  );
});

test("12. loop flag is document metadata (scheduler does not auto-restart)", () => {
  // Scheduler returns one pass; looping is the engine's job using doc.loop
  const ev1 = scheduleArrangement(song);
  const ev2 = scheduleArrangement(song, { fromTick: 0, toTick: song.lengthTicks });
  assert(ev1.length === ev2.length, "single pass");
  // Window past end yields empty when from >= length
  const past = scheduleArrangement(song, {
    fromTick: song.lengthTicks,
    toTick: song.lengthTicks + BAR,
  });
  assert(past.length === 0, "no events when window starts at song end");
});

test("13. window fromTick/toTick supports play-from-section", () => {
  const chorusOnly = scheduleArrangement(song, {
    fromTick: chorusStart,
    toTick: song.lengthTicks,
  });
  assert(chorusOnly.length > 0, "chorus window has events");
  assert(
    chorusOnly.every((e) => e.startTick >= chorusStart),
    "all events in chorus+"
  );
  assert(
    !chorusOnly.some((e) => e.clipId === "c-drums-iv"),
    "intro/verse clip notes not in chorus window"
  );
});

test("14. no duplicate event ids within a schedule pass", () => {
  const ev = scheduleArrangement(song);
  const ids = ev.map((e) => e.id);
  assert(ids.length === new Set(ids).size, "duplicate event ids");
});

test("15. v1-shaped migration then schedule (manual equivalent)", () => {
  // Simulate migrate: one pattern+clip per track at 0
  const v2 = {
    version: 2,
    tempoBpm: 90,
    timeSignature: [4, 4],
    ppq: PPQ,
    lengthTicks: 4 * BAR,
    loop: true,
    patterns: [
      {
        id: "p1",
        name: "Drums",
        lengthTicks: 4 * BAR,
        notes: [
          { id: "n1", pitch: 36, startTick: 0, durationTicks: 100, velocity: 100 },
          { id: "n2", pitch: 38, startTick: 2 * BAR, durationTicks: 100, velocity: 90 },
        ],
      },
    ],
    tracks: [
      {
        id: "t1",
        name: "Drums",
        instrumentId: "drums",
        clips: [{ id: "c1", patternId: "p1", startTick: 0, durationTicks: 4 * BAR }],
      },
    ],
    sections: [
      { id: "s1", name: "Song", kind: "custom", startTick: 0, lengthTicks: 4 * BAR },
    ],
  };
  const ev = scheduleArrangement(v2);
  assert(ev.length === 2, "both notes scheduled");
  assert(ev[0].startTick === 0, "first at 0");
  assert(ev[1].startTick === 2 * BAR, "second at correct tick");
});

test("16. overlapping clips on same track both emit (deterministic)", () => {
  const doc = {
    version: 2,
    tempoBpm: 120,
    timeSignature: [4, 4],
    ppq: PPQ,
    lengthTicks: 2 * BAR,
    loop: false,
    patterns: [
      {
        id: "p",
        name: "P",
        lengthTicks: BAR,
        notes: [{ id: "n", pitch: 60, startTick: 0, durationTicks: 100, velocity: 80 }],
      },
    ],
    tracks: [
      {
        id: "t",
        name: "T",
        instrumentId: "x",
        clips: [
          { id: "c1", patternId: "p", startTick: 0, durationTicks: BAR },
          { id: "c2", patternId: "p", startTick: PPQ, durationTicks: BAR }, // overlaps
        ],
      },
    ],
    sections: [],
  };
  const ev = scheduleArrangement(doc);
  // c1 at 0; c2 at PPQ — both present
  assert(ev.some((e) => e.clipId === "c1" && e.startTick === 0), "c1");
  assert(ev.some((e) => e.clipId === "c2" && e.startTick === PPQ), "c2");
});

test("17. bass does not start in intro (clip start respected)", () => {
  const ev = scheduleArrangement(song);
  const bassEarly = ev.filter(
    (e) => e.trackId === "trk-bass" && e.startTick < verseStart
  );
  assert(bassEarly.length === 0, "bass silent in intro");
  const bassVerse = ev.filter(
    (e) => e.trackId === "trk-bass" && e.startTick === verseStart
  );
  assert(bassVerse.length >= 1, "bass enters at verse");
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
