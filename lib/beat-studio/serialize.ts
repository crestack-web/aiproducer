import {
  BEAT_STUDIO_DOC_VERSION,
  DEFAULT_PPQ,
  DEFAULT_TEMPO_BPM,
  DEFAULT_BARS,
  emptyBeatStudioDoc,
  type BeatStudioDoc,
  type BeatStudioNote,
  type BeatStudioTrack,
  type InstrumentId,
} from "./types";

const INSTRUMENTS: InstrumentId[] = ["synth_lead", "synth_bass", "drum_kit"];

function asNumber(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function parseNote(raw: unknown, index: number): BeatStudioNote | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const pitch = asNumber(o.pitch, -1);
  const startTick = asNumber(o.startTick, -1);
  const durationTicks = asNumber(o.durationTicks, 0);
  const velocity = asNumber(o.velocity, 100);
  if (pitch < 0 || pitch > 127 || startTick < 0 || durationTicks <= 0) return null;
  const id = typeof o.id === "string" && o.id ? o.id : `n_${index}_${startTick}_${pitch}`;
  return {
    id,
    pitch: Math.round(pitch),
    startTick: Math.round(startTick),
    durationTicks: Math.max(1, Math.round(durationTicks)),
    velocity: Math.max(1, Math.min(127, Math.round(velocity))),
  };
}

function parseTrack(raw: unknown, index: number): BeatStudioTrack | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === "string" && o.id ? o.id : `track_${index}`;
  const name = typeof o.name === "string" && o.name ? o.name : `Track ${index + 1}`;
  let instrumentId: InstrumentId = "synth_lead";
  if (typeof o.instrumentId === "string" && INSTRUMENTS.includes(o.instrumentId as InstrumentId)) {
    instrumentId = o.instrumentId as InstrumentId;
  }
  const notesIn = Array.isArray(o.notes) ? o.notes : [];
  const notes: BeatStudioNote[] = [];
  notesIn.forEach((n, i) => {
    const parsed = parseNote(n, i);
    if (parsed) notes.push(parsed);
  });
  return {
    id,
    name,
    instrumentId,
    muted: Boolean(o.muted),
    notes,
  };
}

/**
 * Parse unknown JSON into a valid BeatStudioDoc.
 * Unknown/missing fields get safe defaults. Never throws.
 */
export function parseBeatStudioDoc(raw: unknown): BeatStudioDoc {
  if (!raw || typeof raw !== "object") return emptyBeatStudioDoc();
  const o = raw as Record<string, unknown>;
  const version = asNumber(o.version, BEAT_STUDIO_DOC_VERSION);
  // Future: migrate version → current here
  if (version > BEAT_STUDIO_DOC_VERSION) {
    // Forward-compatible: keep what we understand
  }
  const tempoBpm = Math.max(20, Math.min(300, asNumber(o.tempoBpm, DEFAULT_TEMPO_BPM)));
  let timeSignature: [number, number] = [4, 4];
  if (Array.isArray(o.timeSignature) && o.timeSignature.length >= 2) {
    timeSignature = [
      Math.max(1, Math.min(16, asNumber(o.timeSignature[0], 4))),
      Math.max(1, Math.min(16, asNumber(o.timeSignature[1], 4))),
    ];
  }
  const ppq = Math.max(24, Math.min(960, asNumber(o.ppq, DEFAULT_PPQ)));
  const bars = Math.max(1, Math.min(64, asNumber(o.bars, DEFAULT_BARS)));
  const tracksIn = Array.isArray(o.tracks) ? o.tracks : [];
  const tracks: BeatStudioTrack[] = [];
  tracksIn.forEach((t, i) => {
    const parsed = parseTrack(t, i);
    if (parsed) tracks.push(parsed);
  });
  if (tracks.length === 0) return emptyBeatStudioDoc({ tempoBpm, timeSignature, ppq, bars });
  return {
    version: BEAT_STUDIO_DOC_VERSION,
    tempoBpm,
    timeSignature,
    ppq,
    bars,
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

/** Read from project.metadata */
export function beatStudioFromProjectMetadata(metadata: unknown): BeatStudioDoc | null {
  if (!metadata || typeof metadata !== "object") return null;
  const m = metadata as Record<string, unknown>;
  if (m.beat_studio == null) return null;
  return parseBeatStudioDoc(m.beat_studio);
}
