/**
 * v1 → v2 migration for Beat Studio documents.
 * Patterns are a Record keyed by id; clips live on tracks.
 */

import {
  BEAT_STUDIO_DOC_VERSION,
  BEAT_STUDIO_DOC_VERSION_V1,
  DEFAULT_PPQ,
  emptyBeatStudioDoc,
  newStableId,
  type BeatStudioClip,
  type BeatStudioDoc,
  type BeatStudioDocV1,
  type BeatStudioNote,
  type BeatStudioPattern,
  type BeatStudioSection,
  type BeatStudioTrack,
  type PatternKind,
} from "./types";
import { patternLengthTicks } from "./time";

export function isV1Doc(doc: unknown): doc is BeatStudioDocV1 {
  if (!doc || typeof doc !== "object") return false;
  const v = (doc as { version?: number }).version;
  return v === 1 || v === BEAT_STUDIO_DOC_VERSION_V1;
}

export function isV2Doc(doc: unknown): doc is BeatStudioDoc {
  if (!doc || typeof doc !== "object") return false;
  const d = doc as BeatStudioDoc;
  return d.version === BEAT_STUDIO_DOC_VERSION && d.patterns != null && typeof d.patterns === "object";
}

function cloneNotes(notes: BeatStudioNote[] | undefined): BeatStudioNote[] {
  return (notes ?? []).map((n) => ({ ...n }));
}

/**
 * Each v1 track → one pattern + one clip at tick 0.
 * Notes, instrument, mute/params preserved.
 */
export function migrateV1ToV2(v1: BeatStudioDocV1): BeatStudioDoc {
  const ppq = v1.ppq > 0 ? v1.ppq : DEFAULT_PPQ;
  const bars = Math.max(1, v1.bars || 2);
  const timeSignature = v1.timeSignature ?? ([4, 4] as [number, number]);
  const lengthTicks = patternLengthTicks(bars, timeSignature, ppq);

  const patterns: Record<string, BeatStudioPattern> = {};
  const tracks: BeatStudioTrack[] = [];

  for (const t of v1.tracks ?? []) {
    const patId = newStableId("pat");
    const kind: PatternKind = t.instrumentId === "drum_kit" ? "drum" : "melodic";
    const notes = cloneNotes(t.notes);
    let patLen = lengthTicks;
    for (const n of notes) {
      patLen = Math.max(patLen, n.startTick + n.durationTicks);
    }
    patterns[patId] = {
      id: patId,
      name: t.name || "Pattern",
      lengthTicks: patLen,
      notes,
      kind,
    };
    const clip: BeatStudioClip = {
      id: newStableId("clip"),
      patternId: patId,
      startTick: 0,
      durationTicks: patLen,
    };
    tracks.push({
      id: t.id || newStableId("trk"),
      name: t.name || "Track",
      instrumentId: t.instrumentId,
      muted: t.muted,
      instrumentParams: t.instrumentParams,
      clips: [clip],
      notes: cloneNotes(t.notes),
    });
  }

  const sections: BeatStudioSection[] = [
    {
      id: newStableId("sec"),
      name: "Loop",
      kind: "custom",
      startTick: 0,
      lengthTicks,
    },
  ];

  return {
    version: BEAT_STUDIO_DOC_VERSION,
    tempoBpm: v1.tempoBpm,
    timeSignature,
    ppq,
    bars,
    songLengthTicks: lengthTicks,
    loop: v1.loop !== false,
    sections,
    patterns,
    tracks,
    updatedAt: v1.updatedAt,
  };
}

/** Coerce any input into a usable v2 document. */
export function ensureV2(doc: unknown): BeatStudioDoc {
  if (isV2Doc(doc)) {
    const patterns = { ...doc.patterns };
    const tracks = doc.tracks.map((t) => {
      if (t.clips && t.clips.length > 0) return t;
      const patId = newStableId("pat");
      const kind: PatternKind = t.instrumentId === "drum_kit" ? "drum" : "melodic";
      const notes = cloneNotes(t.notes);
      let patLen = patternLengthTicks(doc.bars, doc.timeSignature, doc.ppq);
      for (const n of notes) patLen = Math.max(patLen, n.startTick + n.durationTicks);
      patterns[patId] = {
        id: patId,
        name: t.name,
        lengthTicks: patLen,
        notes,
        kind,
      };
      return {
        ...t,
        clips: [
          {
            id: newStableId("clip"),
            patternId: patId,
            startTick: 0,
            durationTicks: patLen,
          },
        ],
        notes: notes,
      };
    });
    return {
      ...doc,
      patterns,
      tracks,
      songLengthTicks: doc.songLengthTicks || patternLengthTicks(doc.bars, doc.timeSignature, doc.ppq),
      sections: doc.sections?.length
        ? doc.sections
        : [
            {
              id: newStableId("sec"),
              name: "Loop",
              kind: "custom",
              startTick: 0,
              lengthTicks:
                doc.songLengthTicks ||
                patternLengthTicks(doc.bars, doc.timeSignature, doc.ppq),
            },
          ],
    };
  }
  if (isV1Doc(doc)) return migrateV1ToV2(doc);
  if (doc && typeof doc === "object" && Array.isArray((doc as BeatStudioDocV1).tracks)) {
    return migrateV1ToV2(doc as BeatStudioDocV1);
  }
  return emptyBeatStudioDoc();
}

/** Deep-copy a pattern under a new id (for variations). */
export function duplicatePattern(
  doc: BeatStudioDoc,
  patternId: string,
  newName?: string
): { doc: BeatStudioDoc; newPatternId: string } | null {
  const src = doc.patterns[patternId];
  if (!src) return null;
  const newId = newStableId("pat");
  const copy: BeatStudioPattern = {
    ...src,
    id: newId,
    name: newName ?? `${src.name} copy`,
    notes: cloneNotes(src.notes),
  };
  return {
    doc: {
      ...doc,
      patterns: { ...doc.patterns, [newId]: copy },
    },
    newPatternId: newId,
  };
}
