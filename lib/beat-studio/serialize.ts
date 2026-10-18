/**
 * Parse / serialize Beat Studio documents (v1 + v2).
 * Never throws. Invalid notes dropped; structure preserved when valid.
 */

import {
  BEAT_STUDIO_DOC_VERSION,
  BEAT_STUDIO_DOC_VERSION_V1,
  DEFAULT_PPQ,
  DEFAULT_TEMPO_BPM,
  DEFAULT_BARS,
  emptyBeatStudioDoc,
  clampPitch,
  clampVelocity,
  clampTempo,
  newStableId,
  type BeatStudioClip,
  type BeatStudioDoc,
  type BeatStudioNote,
  type BeatStudioPattern,
  type BeatStudioSection,
  type BeatStudioTrack,
  type InstrumentId,
  type InstrumentParams,
  type PatternKind,
  type SongSectionKind,
} from "./types";
import { patternLengthTicks } from "./time";
import { ensureV2, migrateV1ToV2, isV1Doc } from "./migrate";

const INSTRUMENTS: InstrumentId[] = ["pluck", "synth_lead", "synth_bass", "drum_kit"];
const SECTION_KINDS: SongSectionKind[] = [
  "intro",
  "verse",
  "pre_chorus",
  "chorus",
  "bridge",
  "outro",
  "custom",
];

function asNumber(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function parseParams(raw: unknown): InstrumentParams | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const out: InstrumentParams = {};
  if (typeof o.attackSec === "number") out.attackSec = o.attackSec;
  if (typeof o.decaySec === "number") out.decaySec = o.decaySec;
  if (typeof o.sustain === "number") out.sustain = o.sustain;
  if (typeof o.releaseSec === "number") out.releaseSec = o.releaseSec;
  if (typeof o.filterHz === "number") out.filterHz = o.filterHz;
  if (typeof o.gain === "number") out.gain = o.gain;
  return Object.keys(out).length ? out : undefined;
}

function parseNote(raw: unknown, index: number, maxTick?: number): BeatStudioNote | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const pitch = asNumber(o.pitch, -1);
  const startTick = asNumber(o.startTick, -1);
  const durationTicks = asNumber(o.durationTicks, 0);
  const velocity = asNumber(o.velocity, 100);
  if (pitch < 0 || pitch > 127 || startTick < 0 || durationTicks <= 0) return null;
  if (typeof maxTick === "number" && startTick >= maxTick) return null;
  const id = typeof o.id === "string" && o.id ? o.id : `n_${index}_${startTick}_${pitch}`;
  const dur = Math.max(1, Math.round(durationTicks));
  return {
    id,
    pitch: clampPitch(pitch),
    startTick: Math.round(startTick),
    durationTicks:
      typeof maxTick === "number"
        ? Math.min(dur, Math.max(1, maxTick - Math.round(startTick)))
        : dur,
    velocity: clampVelocity(velocity),
  };
}

function parseClip(raw: unknown, index: number): BeatStudioClip | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const patternId = typeof o.patternId === "string" ? o.patternId : "";
  if (!patternId) return null;
  const id = typeof o.id === "string" && o.id ? o.id : `clip_${index}`;
  const startTick = Math.max(0, Math.round(asNumber(o.startTick, 0)));
  const clip: BeatStudioClip = {
    id,
    patternId,
    startTick,
  };
  if (typeof o.durationTicks === "number" && o.durationTicks > 0) {
    clip.durationTicks = Math.round(o.durationTicks);
  }
  if (typeof o.transpose === "number") clip.transpose = Math.round(o.transpose);
  if (typeof o.velocityScale === "number") clip.velocityScale = o.velocityScale;
  if (o.muted === true) clip.muted = true;
  return clip;
}

function parsePattern(raw: unknown, fallbackId: string): BeatStudioPattern | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === "string" && o.id ? o.id : fallbackId;
  const name = typeof o.name === "string" && o.name ? o.name : id;
  const lengthTicks = Math.max(1, Math.round(asNumber(o.lengthTicks, DEFAULT_PPQ * 4)));
  const notesIn = Array.isArray(o.notes) ? o.notes : [];
  const notes: BeatStudioNote[] = [];
  notesIn.forEach((n, i) => {
    const parsed = parseNote(n, i);
    if (parsed) notes.push(parsed);
  });
  let kind: PatternKind | undefined;
  if (o.kind === "drum" || o.kind === "melodic") kind = o.kind;
  return { id, name, lengthTicks, notes, kind };
}

function parseSection(raw: unknown, index: number): BeatStudioSection | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === "string" && o.id ? o.id : `sec_${index}`;
  const name = typeof o.name === "string" && o.name ? o.name : `Section ${index + 1}`;
  const kindRaw = typeof o.kind === "string" ? o.kind : "custom";
  const kind: SongSectionKind = SECTION_KINDS.includes(kindRaw as SongSectionKind)
    ? (kindRaw as SongSectionKind)
    : "custom";
  const startTick = Math.max(0, Math.round(asNumber(o.startTick, 0)));
  const lengthTicks = Math.max(1, Math.round(asNumber(o.lengthTicks, DEFAULT_PPQ * 4)));
  const section: BeatStudioSection = { id, name, kind, startTick, lengthTicks };
  if (typeof o.color === "string") section.color = o.color;
  return section;
}

function parseTrackV2(raw: unknown, index: number, patternIds: Set<string>): BeatStudioTrack | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === "string" && o.id ? o.id : `track_${index}`;
  const name = typeof o.name === "string" && o.name ? o.name : `Track ${index + 1}`;
  let instrumentId: InstrumentId = "pluck";
  if (typeof o.instrumentId === "string" && INSTRUMENTS.includes(o.instrumentId as InstrumentId)) {
    instrumentId = o.instrumentId as InstrumentId;
  }
  const notesIn = Array.isArray(o.notes) ? o.notes : [];
  const notes: BeatStudioNote[] = [];
  notesIn.forEach((n, i) => {
    const parsed = parseNote(n, i);
    if (parsed) notes.push(parsed);
  });
  const clipsIn = Array.isArray(o.clips) ? o.clips : [];
  const clips: BeatStudioClip[] = [];
  clipsIn.forEach((c, i) => {
    const parsed = parseClip(c, i);
    if (parsed && patternIds.has(parsed.patternId)) clips.push(parsed);
  });
  const track: BeatStudioTrack = {
    id,
    name,
    instrumentId,
    notes,
  };
  if (o.muted === true) track.muted = true;
  if (o.solo === true) track.solo = true;
  const params = parseParams(o.instrumentParams);
  if (params) track.instrumentParams = params;
  if (clips.length) track.clips = clips;
  return track;
}

/**
 * Scale ticks when migrating early ppq-96 docs.
 */
export function migrateBeatStudioDoc(raw: Record<string, unknown>): Record<string, unknown> {
  const version = asNumber(raw.version, 1);
  let ppq = asNumber(raw.ppq, DEFAULT_PPQ);
  const next = { ...raw };

  if (version <= 1 && ppq === 96) {
    const scale = DEFAULT_PPQ / 96;
    ppq = DEFAULT_PPQ;
    next.ppq = ppq;
    if (Array.isArray(next.tracks)) {
      next.tracks = next.tracks.map((t) => {
        if (!t || typeof t !== "object") return t;
        const track = t as Record<string, unknown>;
        const notes = Array.isArray(track.notes) ? track.notes : [];
        return {
          ...track,
          notes: notes.map((n) => {
            if (!n || typeof n !== "object") return n;
            const note = n as Record<string, unknown>;
            return {
              ...note,
              startTick: Math.round(asNumber(note.startTick, 0) * scale),
              durationTicks: Math.max(1, Math.round(asNumber(note.durationTicks, 1) * scale)),
            };
          }),
        };
      });
    }
  }

  next.ppq = ppq;
  return next;
}

/**
 * Parse unknown JSON into a valid BeatStudioDoc (always v2 shape after ensureV2).
 */
export function parseBeatStudioDoc(raw: unknown): BeatStudioDoc {
  if (raw == null) return emptyBeatStudioDoc();
  if (typeof raw !== "object") return emptyBeatStudioDoc();

  const migrated = migrateBeatStudioDoc(raw as Record<string, unknown>);
  const o = migrated;

  // Explicit v1 (no patterns map) → migrate
  const hasPatterns =
    o.patterns != null &&
    typeof o.patterns === "object" &&
    !Array.isArray(o.patterns) &&
    Object.keys(o.patterns as object).length > 0;

  if (!hasPatterns && Array.isArray(o.tracks)) {
    const v1ish = {
      version: BEAT_STUDIO_DOC_VERSION_V1,
      tempoBpm: clampTempo(asNumber(o.tempoBpm, DEFAULT_TEMPO_BPM)),
      timeSignature: (Array.isArray(o.timeSignature) && o.timeSignature.length >= 2
        ? [
            Math.max(1, Math.min(16, asNumber(o.timeSignature[0], 4))),
            Math.max(1, Math.min(16, asNumber(o.timeSignature[1], 4))),
          ]
        : [4, 4]) as [number, number],
      ppq: Math.max(24, Math.min(1920, asNumber(o.ppq, DEFAULT_PPQ))),
      bars: Math.max(1, Math.min(64, asNumber(o.bars, DEFAULT_BARS))),
      loop: o.loop !== false,
      tracks: (o.tracks as unknown[]).map((t, i) => {
        if (!t || typeof t !== "object") {
          return {
            id: `track_${i}`,
            name: `Track ${i + 1}`,
            instrumentId: "pluck" as InstrumentId,
            notes: [] as BeatStudioNote[],
          };
        }
        const tr = t as Record<string, unknown>;
        let instrumentId: InstrumentId = "pluck";
        if (
          typeof tr.instrumentId === "string" &&
          INSTRUMENTS.includes(tr.instrumentId as InstrumentId)
        ) {
          instrumentId = tr.instrumentId as InstrumentId;
        }
        const notes: BeatStudioNote[] = [];
        const notesIn = Array.isArray(tr.notes) ? tr.notes : [];
        notesIn.forEach((n, ni) => {
          const parsed = parseNote(n, ni);
          if (parsed) notes.push(parsed);
        });
        return {
          id: typeof tr.id === "string" && tr.id ? tr.id : `track_${i}`,
          name: typeof tr.name === "string" && tr.name ? tr.name : `Track ${i + 1}`,
          instrumentId,
          muted: tr.muted === true,
          instrumentParams: parseParams(tr.instrumentParams),
          notes,
        };
      }),
      updatedAt: typeof o.updatedAt === "string" ? o.updatedAt : undefined,
    };
    return ensureV2(migrateV1ToV2(v1ish));
  }

  // v2 path
  const tempoBpm = clampTempo(asNumber(o.tempoBpm, DEFAULT_TEMPO_BPM));
  let timeSignature: [number, number] = [4, 4];
  if (Array.isArray(o.timeSignature) && o.timeSignature.length >= 2) {
    timeSignature = [
      Math.max(1, Math.min(16, asNumber(o.timeSignature[0], 4))),
      Math.max(1, Math.min(16, asNumber(o.timeSignature[1], 4))),
    ];
  }
  const ppq = Math.max(24, Math.min(1920, asNumber(o.ppq, DEFAULT_PPQ)));
  const bars = Math.max(1, Math.min(64, asNumber(o.bars, DEFAULT_BARS)));
  const defaultLen = patternLengthTicks(bars, timeSignature, ppq);
  const songLengthTicks = Math.max(
    1,
    Math.round(asNumber(o.songLengthTicks, defaultLen))
  );

  const patternsRaw = (o.patterns ?? {}) as Record<string, unknown>;
  const patterns: Record<string, BeatStudioPattern> = {};
  for (const key of Object.keys(patternsRaw)) {
    const parsed = parsePattern(patternsRaw[key], key);
    if (parsed) patterns[parsed.id] = parsed;
  }
  const patternIds = new Set(Object.keys(patterns));

  const tracksIn = Array.isArray(o.tracks) ? o.tracks : [];
  const tracks: BeatStudioTrack[] = [];
  tracksIn.forEach((t, i) => {
    const parsed = parseTrackV2(t, i, patternIds);
    if (parsed) tracks.push(parsed);
  });

  const sectionsIn = Array.isArray(o.sections) ? o.sections : [];
  const sections: BeatStudioSection[] = [];
  sectionsIn.forEach((s, i) => {
    const parsed = parseSection(s, i);
    if (parsed) sections.push(parsed);
  });

  if (tracks.length === 0 && Object.keys(patterns).length === 0) {
    return emptyBeatStudioDoc({ tempoBpm, timeSignature, ppq, bars, loop: o.loop !== false });
  }

  // Backfill missing clips from track.notes → pattern
  for (const t of tracks) {
    if ((!t.clips || t.clips.length === 0) && t.notes && t.notes.length > 0) {
      const patId = newStableId("pat");
      const kind: PatternKind = t.instrumentId === "drum_kit" ? "drum" : "melodic";
      let patLen = defaultLen;
      for (const n of t.notes) patLen = Math.max(patLen, n.startTick + n.durationTicks);
      patterns[patId] = {
        id: patId,
        name: t.name,
        lengthTicks: patLen,
        notes: t.notes.map((n) => ({ ...n })),
        kind,
      };
      t.clips = [
        {
          id: newStableId("clip"),
          patternId: patId,
          startTick: 0,
          durationTicks: patLen,
        },
      ];
    }
  }

  if (sections.length === 0) {
    sections.push({
      id: newStableId("sec"),
      name: "Loop",
      kind: "custom",
      startTick: 0,
      lengthTicks: songLengthTicks,
    });
  }

  return {
    version: BEAT_STUDIO_DOC_VERSION,
    tempoBpm,
    timeSignature,
    ppq,
    bars,
    songLengthTicks,
    loop: o.loop !== false,
    sections,
    patterns,
    tracks,
    updatedAt: typeof o.updatedAt === "string" ? o.updatedAt : undefined,
  };
}

export function serializeBeatStudioDoc(doc: BeatStudioDoc): BeatStudioDoc {
  const parsed = parseBeatStudioDoc(doc);
  // Ensure v2 completeness
  const v2 = ensureV2(parsed);
  return {
    ...v2,
    updatedAt: new Date().toISOString(),
  };
}

/** Read from project.metadata — null if absent */
export function beatStudioFromProjectMetadata(metadata: unknown): BeatStudioDoc | null {
  if (!metadata || typeof metadata !== "object") return null;
  const m = metadata as Record<string, unknown>;
  if (m.beat_studio == null) return null;
  return parseBeatStudioDoc(m.beat_studio);
}

/** Merge helper: never wipe sibling metadata keys */
export function metadataWithBeatStudio(
  prevMetadata: unknown,
  doc: BeatStudioDoc
): Record<string, unknown> {
  const prev =
    prevMetadata && typeof prevMetadata === "object"
      ? (prevMetadata as Record<string, unknown>)
      : {};
  return {
    ...prev,
    beat_studio: serializeBeatStudioDoc(doc),
  };
}
