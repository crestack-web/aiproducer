/**
 * Pure arrangement mutations — clips & sections on the v2 document.
 * No React / Web Audio.
 */

import {
  type BeatStudioClip,
  type BeatStudioDoc,
  type BeatStudioSection,
  type SongSectionKind,
  newStableId,
} from "./types";
import { ensureV2 } from "./migrate";
import { patternLengthTicks, quantizeTick } from "./time";

export function barTicks(doc: BeatStudioDoc): number {
  return patternLengthTicks(1, doc.timeSignature, doc.ppq);
}

export function beatTicks(doc: BeatStudioDoc): number {
  return Math.max(1, Math.round(doc.ppq * (4 / Math.max(1, doc.timeSignature[1]))));
}

/** Snap a tick to the nearest bar (or beat if mode is beat). */
export function snapTick(
  tick: number,
  doc: BeatStudioDoc,
  mode: "bar" | "beat" | "none" = "bar"
): number {
  if (mode === "none") return Math.max(0, Math.round(tick));
  const g = mode === "bar" ? barTicks(doc) : beatTicks(doc);
  return Math.max(0, quantizeTick(tick, g));
}

function cloneDoc(doc: BeatStudioDoc): BeatStudioDoc {
  return ensureV2(JSON.parse(JSON.stringify(doc)) as BeatStudioDoc);
}

function ensureSongLength(doc: BeatStudioDoc, minEndTick: number): BeatStudioDoc {
  if (minEndTick <= doc.songLengthTicks) return doc;
  const bt = barTicks(doc);
  const barsNeeded = Math.max(doc.bars, Math.ceil(minEndTick / bt));
  return {
    ...doc,
    songLengthTicks: Math.max(doc.songLengthTicks, minEndTick),
    bars: Math.max(doc.bars, barsNeeded),
  };
}

export function addClip(
  doc: BeatStudioDoc,
  trackId: string,
  patternId: string,
  startTick: number,
  opts?: { durationTicks?: number; snap?: "bar" | "beat" | "none" }
): BeatStudioDoc {
  let d = cloneDoc(doc);
  const pattern = d.patterns[patternId];
  if (!pattern) return d;
  const track = d.tracks.find((t) => t.id === trackId);
  if (!track) return d;

  const start = snapTick(startTick, d, opts?.snap ?? "bar");
  const durationTicks = opts?.durationTicks ?? pattern.lengthTicks;
  const clip: BeatStudioClip = {
    id: newStableId("clip"),
    patternId,
    startTick: start,
    durationTicks: Math.max(1, durationTicks),
  };
  const tracks = d.tracks.map((t) => {
    if (t.id !== trackId) return t;
    const clips = [...(t.clips ?? []), clip].sort((a, b) => a.startTick - b.startTick);
    return { ...t, clips };
  });
  d = { ...d, tracks };
  return ensureSongLength(d, start + clip.durationTicks!);
}

export function moveClip(
  doc: BeatStudioDoc,
  trackId: string,
  clipId: string,
  newStartTick: number,
  snap: "bar" | "beat" | "none" = "bar"
): BeatStudioDoc {
  let d = cloneDoc(doc);
  const start = snapTick(newStartTick, d, snap);
  let end = 0;
  const tracks = d.tracks.map((t) => {
    if (t.id !== trackId) return t;
    const clips = (t.clips ?? []).map((c) => {
      if (c.id !== clipId) return c;
      const next = { ...c, startTick: start };
      end = Math.max(end, start + (next.durationTicks ?? d.patterns[c.patternId]?.lengthTicks ?? 0));
      return next;
    });
    return { ...t, clips };
  });
  d = { ...d, tracks };
  return ensureSongLength(d, end);
}

export function resizeClip(
  doc: BeatStudioDoc,
  trackId: string,
  clipId: string,
  durationTicks: number,
  snap: "bar" | "beat" | "none" = "bar"
): BeatStudioDoc {
  let d = cloneDoc(doc);
  const bt = snap === "none" ? 1 : snap === "bar" ? barTicks(d) : beatTicks(d);
  const dur = Math.max(bt, quantizeTick(Math.max(1, durationTicks), bt));
  let end = 0;
  const tracks = d.tracks.map((t) => {
    if (t.id !== trackId) return t;
    const clips = (t.clips ?? []).map((c) => {
      if (c.id !== clipId) return c;
      const next = { ...c, durationTicks: dur };
      end = Math.max(end, c.startTick + dur);
      return next;
    });
    return { ...t, clips };
  });
  d = { ...d, tracks };
  return ensureSongLength(d, end);
}

export function duplicateClip(
  doc: BeatStudioDoc,
  trackId: string,
  clipId: string
): BeatStudioDoc {
  let d = cloneDoc(doc);
  const track = d.tracks.find((t) => t.id === trackId);
  const clip = track?.clips?.find((c) => c.id === clipId);
  if (!clip) return d;
  const dur = clip.durationTicks ?? d.patterns[clip.patternId]?.lengthTicks ?? barTicks(d);
  const start = clip.startTick + dur;
  return addClip(d, trackId, clip.patternId, start, {
    durationTicks: dur,
    snap: "none",
  });
}

export function deleteClip(
  doc: BeatStudioDoc,
  trackId: string,
  clipId: string
): BeatStudioDoc {
  const d = cloneDoc(doc);
  const tracks = d.tracks.map((t) => {
    if (t.id !== trackId) return t;
    return { ...t, clips: (t.clips ?? []).filter((c) => c.id !== clipId) };
  });
  return { ...d, tracks };
}

export function setClipMuted(
  doc: BeatStudioDoc,
  trackId: string,
  clipId: string,
  muted: boolean
): BeatStudioDoc {
  const d = cloneDoc(doc);
  const tracks = d.tracks.map((t) => {
    if (t.id !== trackId) return t;
    return {
      ...t,
      clips: (t.clips ?? []).map((c) => (c.id === clipId ? { ...c, muted } : c)),
    };
  });
  return { ...d, tracks };
}

export function addSection(
  doc: BeatStudioDoc,
  input: {
    name: string;
    kind: SongSectionKind;
    startTick: number;
    lengthTicks: number;
  }
): BeatStudioDoc {
  let d = cloneDoc(doc);
  const section: BeatStudioSection = {
    id: newStableId("sec"),
    name: input.name,
    kind: input.kind,
    startTick: snapTick(input.startTick, d, "bar"),
    lengthTicks: Math.max(barTicks(d), input.lengthTicks),
  };
  const sections = [...d.sections, section].sort((a, b) => a.startTick - b.startTick);
  d = { ...d, sections };
  return ensureSongLength(d, section.startTick + section.lengthTicks);
}

export function renameSection(
  doc: BeatStudioDoc,
  sectionId: string,
  name: string
): BeatStudioDoc {
  const d = cloneDoc(doc);
  return {
    ...d,
    sections: d.sections.map((s) =>
      s.id === sectionId ? { ...s, name: name.trim() || s.name } : s
    ),
  };
}

export function deleteSection(doc: BeatStudioDoc, sectionId: string): BeatStudioDoc {
  const d = cloneDoc(doc);
  return { ...d, sections: d.sections.filter((s) => s.id !== sectionId) };
}

export function setTrackMuted(
  doc: BeatStudioDoc,
  trackId: string,
  muted: boolean
): BeatStudioDoc {
  const d = cloneDoc(doc);
  return {
    ...d,
    tracks: d.tracks.map((t) => (t.id === trackId ? { ...t, muted } : t)),
  };
}

export function setTrackSolo(
  doc: BeatStudioDoc,
  trackId: string,
  solo: boolean
): BeatStudioDoc {
  const d = cloneDoc(doc);
  return {
    ...d,
    tracks: d.tracks.map((t) => (t.id === trackId ? { ...t, solo } : t)),
  };
}

/** Total bars for the ruler (at least song length, at least 8). */
export function songBars(doc: BeatStudioDoc): number {
  const bt = barTicks(doc);
  return Math.max(8, doc.bars, Math.ceil(doc.songLengthTicks / bt));
}

export function ticksToBar(tick: number, doc: BeatStudioDoc): number {
  return Math.floor(tick / barTicks(doc)) + 1;
}
