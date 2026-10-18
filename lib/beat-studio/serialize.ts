import {
  BEAT_STUDIO_DOC_VERSION,
  DEFAULT_PPQ,
  DEFAULT_TEMPO_BPM,
  DEFAULT_BARS,
  emptyBeatStudioDoc,
  clampPitch,
  clampVelocity,
  clampTempo,
  type BeatStudioDoc,
  type BeatStudioNote,
  type BeatStudioTrack,
  type InstrumentId,
  type InstrumentParams,
} from "./types";
import { patternLengthTicks } from "./time";

const INSTRUMENTS: InstrumentId[] = ["pluck", "synth_lead", "synth_bass", "drum_kit"];

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

function parseNote(raw: unknown, index: number, maxTick: number): BeatStudioNote | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const pitch = asNumber(o.pitch, -1);
  const startTick = asNumber(o.startTick, -1);
  const durationTicks = asNumber(o.durationTicks, 0);
  const velocity = asNumber(o.velocity, 100);
  if (pitch < 0 || pitch > 127 || startTick < 0 || durationTicks <= 0) return null;
  if (startTick >= maxTick) return null;
  const id = typeof o.id === "string" && o.id ? o.id : `n_${index}_${startTick}_${pitch}`;
  const dur = Math.max(1, Math.round(durationTicks));
  return {
    id,
    pitch: clampPitch(pitch),
    startTick: Math.round(startTick),
    durationTicks: Math.min(dur, Math.max(1, maxTick - Math.round(startTick))),
    velocity: clampVelocity(velocity),
  };
}

function parseTrack(raw: unknown, index: number, maxTick: number): BeatStudioTrack | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === "string" && o.id ? o.id : `track_${index}`;
  const name = typeof o.name === "string" && o.name ? o.name : `Track ${index + 1}`;
  let instrumentId: InstrumentId = "pluck";
  if (typeof o.instrumentId === "string" && INSTRUMENTS.includes(o.instrumentId as InstrumentId)) {
    instrumentId = o.instrumentId as InstrumentId;
  } else if (o.instrumentId === "synth_lead") {
    instrumentId = "synth_lead";
  }
  const notesIn = Array.isArray(o.notes) ? o.notes : [];
  const notes: BeatStudioNote[] = [];
  notesIn.forEach((n, i) => {
    const parsed = parseNote(n, i, maxTick);
    if (parsed) notes.push(parsed);
  });
  return {
    id,
    name,
    instrumentId,
    muted: Boolean(o.muted),
    instrumentParams: parseParams(o.instrumentParams),
    notes,
  };
}

/**
 * Migrate older docs (e.g. ppq 96 from early MVP) to current defaults.
 * Scales note ticks when PPQ changes so musical positions stay equivalent.
 */
export function migrateBeatStudioDoc(raw: Record<string, unknown>): Record<string, unknown> {
  const version = asNumber(raw.version, 1);
  let ppq = asNumber(raw.ppq, DEFAULT_PPQ);
  const next = { ...raw };

  // v1 early builds used ppq 96 — scale ticks up to 960
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

  // Rename legacy default instrument if needed — keep as-is; pluck is new default only for empty docs
  next.version = BEAT_STUDIO_DOC_VERSION;
  next.ppq = ppq;
  return next;
}

/**
 * Parse unknown JSON into a valid BeatStudioDoc.
 * Never throws. Invalid notes dropped. Missing MIDI → empty safe doc when raw is null/undefined.
 */
export function parseBeatStudioDoc(raw: unknown): BeatStudioDoc {
  if (raw == null) return emptyBeatStudioDoc();
  if (typeof raw !== "object") return emptyBeatStudioDoc();

  const migrated = migrateBeatStudioDoc(raw as Record<string, unknown>);
  const o = migrated;

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
  const maxTick = patternLengthTicks(bars, timeSignature, ppq);
  const tracksIn = Array.isArray(o.tracks) ? o.tracks : [];
  const tracks: BeatStudioTrack[] = [];
  tracksIn.forEach((t, i) => {
    const parsed = parseTrack(t, i, maxTick);
    if (parsed) tracks.push(parsed);
  });
  if (tracks.length === 0) {
    return emptyBeatStudioDoc({ tempoBpm, timeSignature, ppq, bars, loop: o.loop !== false });
  }
  return {
    version: BEAT_STUDIO_DOC_VERSION,
    tempoBpm,
    timeSignature,
    ppq,
    bars,
    loop: o.loop !== false,
    tracks,
    updatedAt: typeof o.updatedAt === "string" ? o.updatedAt : undefined,
  };
}

export function serializeBeatStudioDoc(doc: BeatStudioDoc): BeatStudioDoc {
  const parsed = parseBeatStudioDoc(doc);
  return {
    ...parsed,
    updatedAt: new Date().toISOString(),
  };
}

/** Read from project.metadata — null if absent (existing projects stay valid) */
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
