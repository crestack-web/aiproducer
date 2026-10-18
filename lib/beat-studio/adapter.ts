/**
 * Adapter: keep legacy drum/melody editors on track.notes / one selected pattern
 * while the document may hold multi-pattern v2 structure.
 */

import {
  type BeatStudioDoc,
  type BeatStudioNote,
  type BeatStudioPattern,
  type BeatStudioTrack,
  type InstrumentId,
  newStableId,
} from "./types";
import { ensureV2 } from "./migrate";
import { patternLengthTicks } from "./time";
import { arrangementToPlaybackTracks } from "./schedule";

export function resolveSelectedPatternId(doc: BeatStudioDoc): string | undefined {
  const patterns = Object.values(doc.patterns ?? {});
  const drum = patterns.find((p) => p.kind === "drum");
  if (drum) return drum.id;
  return patterns[0]?.id;
}

export function getSelectedPattern(doc: BeatStudioDoc): BeatStudioPattern | undefined {
  const id = resolveSelectedPatternId(doc);
  if (!id) return undefined;
  return doc.patterns[id];
}

export function primaryPatternIdForTrack(
  doc: BeatStudioDoc,
  trackId: string
): string | undefined {
  const track = doc.tracks.find((t) => t.id === trackId);
  if (!track?.clips?.length) return undefined;
  const ordered = [...track.clips].sort((a, b) => a.startTick - b.startTick);
  return ordered[0]?.patternId;
}

export function getTrackPatternNotes(doc: BeatStudioDoc, trackId: string): BeatStudioNote[] {
  const patternId = primaryPatternIdForTrack(doc, trackId);
  if (!patternId) {
    const track = doc.tracks.find((t) => t.id === trackId);
    return track?.notes ? track.notes.map((n) => ({ ...n })) : [];
  }
  const pattern = doc.patterns[patternId];
  return pattern?.notes?.map((n) => ({ ...n })) ?? [];
}

export function setPatternNotes(
  doc: BeatStudioDoc,
  patternId: string,
  notes: BeatStudioNote[]
): BeatStudioDoc {
  const patterns = { ...doc.patterns };
  const existing = patterns[patternId];
  if (!existing) return doc;
  let lengthTicks = existing.lengthTicks;
  for (const n of notes) {
    lengthTicks = Math.max(lengthTicks, n.startTick + n.durationTicks);
  }
  patterns[patternId] = {
    ...existing,
    notes: notes.map((n) => ({ ...n })),
    lengthTicks,
  };
  const tracks = doc.tracks.map((t) => {
    const pid = primaryPatternIdForTrack(doc, t.id);
    if (pid !== patternId) return t;
    return { ...t, notes: notes.map((n) => ({ ...n })) };
  });
  return { ...doc, patterns, tracks };
}

export function setSelectedPatternNotes(
  doc: BeatStudioDoc,
  notes: BeatStudioNote[]
): BeatStudioDoc {
  const id = resolveSelectedPatternId(doc);
  if (!id) {
    const d = ensureV2(doc);
    const lengthTicks = patternLengthTicks(d.bars, d.timeSignature, d.ppq);
    const patId = newStableId("pat");
    const pattern: BeatStudioPattern = {
      id: patId,
      name: "Pattern 1",
      lengthTicks,
      notes: notes.map((n) => ({ ...n })),
      kind: "melodic",
    };
    const track: BeatStudioTrack = {
      id: newStableId("trk"),
      name: "Track 1",
      instrumentId: "pluck",
      clips: [
        {
          id: newStableId("clip"),
          patternId: patId,
          startTick: 0,
          durationTicks: lengthTicks,
        },
      ],
      notes: notes.map((n) => ({ ...n })),
    };
    return {
      ...d,
      patterns: { ...d.patterns, [patId]: pattern },
      tracks: d.tracks.length ? d.tracks : [track],
    };
  }
  return setPatternNotes(doc, id, notes);
}

export type PlaybackTrack = {
  id: string;
  name: string;
  instrumentId: InstrumentId | string;
  muted?: boolean;
  solo?: boolean;
  instrumentParams?: BeatStudioTrack["instrumentParams"];
  notes: BeatStudioNote[];
};

export type PlaybackDoc = {
  version: 1;
  tempoBpm: number;
  timeSignature: [number, number];
  ppq: number;
  bars: number;
  loop: boolean;
  tracks: PlaybackTrack[];
};

export function toPlaybackDoc(doc: BeatStudioDoc): PlaybackDoc {
  const d = ensureV2(doc);
  const arranged = arrangementToPlaybackTracks(d);
  return {
    version: 1,
    tempoBpm: arranged.tempoBpm,
    timeSignature: arranged.timeSignature,
    ppq: arranged.ppq,
    bars: d.bars,
    loop: arranged.loop,
    tracks: arranged.tracks.map((t) => ({
      id: t.id,
      name: t.name,
      instrumentId: t.instrumentId,
      muted: t.muted,
      solo: t.solo,
      instrumentParams: t.instrumentParams,
      notes: t.notes,
    })),
  };
}

export function setDocBars(doc: BeatStudioDoc, bars: number): BeatStudioDoc {
  const b = Math.max(1, Math.round(bars));
  const lengthTicks = patternLengthTicks(b, doc.timeSignature, doc.ppq);
  return {
    ...doc,
    bars: b,
    songLengthTicks: Math.max(doc.songLengthTicks || 0, lengthTicks),
  };
}

export function setTrackInstrument(
  doc: BeatStudioDoc,
  trackId: string,
  instrumentId: InstrumentId
): BeatStudioDoc {
  return {
    ...doc,
    tracks: doc.tracks.map((t) =>
      t.id === trackId ? { ...t, instrumentId } : t
    ),
  };
}

export function findDrumTrack(doc: BeatStudioDoc): BeatStudioTrack | undefined {
  return (
    doc.tracks.find((t) => t.instrumentId === "drum_kit") ??
    doc.tracks.find((t) => /drum/i.test(t.name))
  );
}

export function findMelodyTrack(doc: BeatStudioDoc): BeatStudioTrack | undefined {
  return (
    doc.tracks.find((t) => t.instrumentId !== "drum_kit") ??
    doc.tracks.find((t) => /melody|lead|synth/i.test(t.name))
  );
}

/**
 * Canonical write path for UI editors that still think in track.notes.
 * Updates track.notes and the primary pattern (if any) so v2 stays consistent.
 * Preserves note IDs from the incoming array.
 */
export function updateTrackNotes(
  doc: BeatStudioDoc,
  trackId: string,
  notes: BeatStudioNote[]
): BeatStudioDoc {
  const d = ensureV2(doc);
  const patternId = primaryPatternIdForTrack(d, trackId);
  const cloned = notes.map((n) => ({ ...n }));

  let patterns = d.patterns;
  if (patternId && patterns[patternId]) {
    let lengthTicks = patterns[patternId].lengthTicks;
    for (const n of cloned) {
      lengthTicks = Math.max(lengthTicks, n.startTick + n.durationTicks);
    }
    patterns = {
      ...patterns,
      [patternId]: {
        ...patterns[patternId],
        notes: cloned,
        lengthTicks,
      },
    };
  }

  const tracks = d.tracks.map((t) => {
    if (t.id !== trackId) return t;
    return { ...t, notes: cloned };
  });

  return { ...d, patterns, tracks };
}
