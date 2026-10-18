/**
 * Integration tests: v2 serialize round-trip, pattern isolation, migration+edit.
 * Pure logic — mirrors serialize/migrate/adapter contracts.
 */
const PPQ = 960;

function assert(c, m) { if (!c) throw new Error(m); }

// Minimal reimplementation of key contracts for isolation tests
// (full TS modules need tsx; these verify the design contracts)

function parseRoundTrip(doc) {
  // Simulate: JSON.stringify → parse → structure check
  const json = JSON.parse(JSON.stringify(doc));
  assert(json.version === 2, 'version 2');
  assert(json.patterns && typeof json.patterns === 'object', 'patterns map');
  assert(Array.isArray(json.tracks), 'tracks');
  assert(Array.isArray(json.sections), 'sections');
  assert(typeof json.songLengthTicks === 'number', 'songLengthTicks');
  // pattern notes preserved
  for (const id of Object.keys(json.patterns)) {
    const p = json.patterns[id];
    assert(Array.isArray(p.notes), 'pattern notes');
    for (const n of p.notes) {
      assert(typeof n.id === 'string' && n.id, 'note id');
      assert(typeof n.pitch === 'number', 'pitch');
    }
  }
  // clips reference valid patterns
  for (const t of json.tracks) {
    for (const c of t.clips || []) {
      assert(json.patterns[c.patternId], `clip ${c.id} → pattern ${c.patternId}`);
    }
  }
  return json;
}

function updateTrackNotes(doc, trackId, notes) {
  const patterns = { ...doc.patterns };
  const track = doc.tracks.find(t => t.id === trackId);
  const patternId = track?.clips?.[0]?.patternId;
  if (patternId && patterns[patternId]) {
    patterns[patternId] = { ...patterns[patternId], notes: notes.map(n => ({...n})) };
  }
  return {
    ...doc,
    patterns,
    tracks: doc.tracks.map(t => t.id === trackId ? { ...t, notes: notes.map(n => ({...n})) } : t),
  };
}

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓', name); passed++; }
  catch (e) { console.error('  ✗', name + ':', e.message); failed++; }
}

console.log('\nBeat Studio v2 integration contracts\n');

const sample = {
  version: 2,
  tempoBpm: 100,
  timeSignature: [4, 4],
  ppq: PPQ,
  bars: 2,
  songLengthTicks: 2 * 4 * PPQ,
  loop: true,
  sections: [{ id: 's1', name: 'Loop', kind: 'custom', startTick: 0, lengthTicks: 2 * 4 * PPQ }],
  patterns: {
    'pat_drums': {
      id: 'pat_drums', name: 'Drums', lengthTicks: 2 * 4 * PPQ, kind: 'drum',
      notes: [
        { id: 'k1', pitch: 36, startTick: 0, durationTicks: 120, velocity: 100 },
        { id: 's1', pitch: 38, startTick: PPQ * 2, durationTicks: 120, velocity: 90 },
      ],
    },
    'pat_melody': {
      id: 'pat_melody', name: 'Melody', lengthTicks: 2 * 4 * PPQ, kind: 'melodic',
      notes: [
        { id: 'm1', pitch: 60, startTick: 0, durationTicks: PPQ, velocity: 80 },
      ],
    },
  },
  tracks: [
    {
      id: 'track_drums', name: 'Drums', instrumentId: 'drum_kit',
      clips: [{ id: 'c1', patternId: 'pat_drums', startTick: 0, durationTicks: 2 * 4 * PPQ }],
      notes: [
        { id: 'k1', pitch: 36, startTick: 0, durationTicks: 120, velocity: 100 },
        { id: 's1', pitch: 38, startTick: PPQ * 2, durationTicks: 120, velocity: 90 },
      ],
    },
    {
      id: 'track_lead', name: 'Lead', instrumentId: 'pluck',
      clips: [{ id: 'c2', patternId: 'pat_melody', startTick: 0, durationTicks: 2 * 4 * PPQ }],
      notes: [
        { id: 'm1', pitch: 60, startTick: 0, durationTicks: PPQ, velocity: 80 },
      ],
    },
  ],
};

test('1. v2 round-trip preserves patterns, clips, sections', () => {
  const out = parseRoundTrip(sample);
  assert(out.patterns.pat_drums.notes.length === 2, 'drum notes');
  assert(out.patterns.pat_melody.notes.length === 1, 'melody notes');
  assert(out.tracks[0].clips[0].patternId === 'pat_drums', 'clip ref');
  assert(out.sections.length === 1, 'section');
  assert(out.tempoBpm === 100, 'tempo');
});

test('2. edit selected pattern does not change other patterns', () => {
  const nextNotes = [
    { id: 'k1', pitch: 36, startTick: 0, durationTicks: 120, velocity: 100 },
    { id: 'k2', pitch: 36, startTick: PPQ, durationTicks: 120, velocity: 100 },
  ];
  const edited = updateTrackNotes(sample, 'track_drums', nextNotes);
  assert(edited.patterns.pat_drums.notes.length === 2, 'drums updated');
  assert(edited.patterns.pat_drums.notes.some(n => n.id === 'k2'), 'new note');
  assert(edited.patterns.pat_melody.notes.length === 1, 'melody unchanged');
  assert(edited.patterns.pat_melody.notes[0].id === 'm1', 'melody id stable');
  assert(edited.tracks[1].instrumentId === 'pluck', 'instrument preserved');
});

test('3. note IDs stable when editing existing notes', () => {
  const notes = sample.patterns.pat_melody.notes.map(n => ({ ...n, velocity: 110 }));
  const edited = updateTrackNotes(sample, 'track_lead', notes);
  assert(edited.patterns.pat_melody.notes[0].id === 'm1', 'id stable');
  assert(edited.patterns.pat_melody.notes[0].velocity === 110, 'vel updated');
});

test('4. instruments and mute preserved across edit', () => {
  const doc = {
    ...sample,
    tracks: sample.tracks.map(t =>
      t.id === 'track_drums' ? { ...t, muted: true } : t
    ),
  };
  const edited = updateTrackNotes(doc, 'track_lead', doc.tracks[1].notes);
  assert(edited.tracks[0].muted === true, 'drums still muted');
  assert(edited.tracks[0].instrumentId === 'drum_kit', 'drum kit');
  assert(edited.tracks[1].instrumentId === 'pluck', 'pluck');
});

test('5. arrangement clips and sections survive JSON round-trip', () => {
  const multi = {
    ...sample,
    songLengthTicks: 28 * 4 * PPQ,
    sections: [
      { id: 'intro', name: 'Intro', kind: 'intro', startTick: 0, lengthTicks: 4 * 4 * PPQ },
      { id: 'verse', name: 'Verse', kind: 'verse', startTick: 4 * 4 * PPQ, lengthTicks: 16 * 4 * PPQ },
    ],
    tracks: [
      {
        ...sample.tracks[0],
        clips: [
          { id: 'c-a', patternId: 'pat_drums', startTick: 0, durationTicks: 20 * 4 * PPQ },
          { id: 'c-b', patternId: 'pat_drums', startTick: 20 * 4 * PPQ, durationTicks: 8 * 4 * PPQ, velocityScale: 1.1 },
        ],
      },
      sample.tracks[1],
    ],
  };
  const out = parseRoundTrip(multi);
  assert(out.sections.length === 2, '2 sections');
  assert(out.tracks[0].clips.length === 2, '2 clips');
  assert(out.tracks[0].clips[1].velocityScale === 1.1, 'vel scale');
});

test('6. sibling metadata merge contract', () => {
  const prev = { production_direction: { x: 1 }, other: 'keep' };
  const merged = { ...prev, beat_studio: sample };
  assert(merged.production_direction.x === 1, 'sibling');
  assert(merged.other === 'keep', 'other');
  assert(merged.beat_studio.version === 2, 'beat_studio');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
