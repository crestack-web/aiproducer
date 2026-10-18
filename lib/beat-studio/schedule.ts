/**
 * Pure arrangement scheduling for Beat Studio v2.
 * Deterministic song-position events — no Web Audio.
 */

import type {
  BeatStudioDoc,
  BeatStudioNote,
  BeatStudioTrack,
  InstrumentId,
} from "./types";
import { ensureV2 } from "./migrate";
import { ticksToSeconds } from "./time";

export type ScheduledNoteEvent = {
  id: string;
  trackId: string;
  clipId: string;
  patternId: string;
  instrumentId: InstrumentId | string;
  startTick: number;
  durationTicks: number;
  pitch: number;
  velocity: number;
  startSec: number;
  durationSec: number;
};

export type ScheduleArrangementOptions = {
  fromTick?: number;
  toTick?: number;
  loopPatternsInClip?: boolean;
};

export function expandClipNotes(
  patternNotes: BeatStudioNote[],
  patternLengthTicks: number,
  clip: {
    id: string;
    startTick: number;
    durationTicks: number;
    transpose?: number;
    velocityScale?: number;
  },
  opts: { loopPatternsInClip?: boolean } = {}
): Array<{
  id: string;
  startTick: number;
  durationTicks: number;
  pitch: number;
  velocity: number;
  patternNoteId: string;
}> {
  const loop = opts.loopPatternsInClip !== false;
  const patternLen = Math.max(1, patternLengthTicks);
  const clipDur = Math.max(0, clip.durationTicks);
  if (clipDur <= 0) return [];

  const transpose = clip.transpose ?? 0;
  const velScale = clip.velocityScale ?? 1;
  const out: Array<{
    id: string;
    startTick: number;
    durationTicks: number;
    pitch: number;
    velocity: number;
    patternNoteId: string;
  }> = [];

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

export function scheduleArrangement(
  doc: BeatStudioDoc,
  options: ScheduleArrangementOptions = {}
): ScheduledNoteEvent[] {
  const d = ensureV2(doc);
  const fromTick = options.fromTick ?? 0;
  const toTick = options.toTick ?? d.songLengthTicks;
  const loopPatternsInClip = options.loopPatternsInClip !== false;
  if (!(toTick > fromTick)) return [];

  const anySolo = d.tracks.some((t) => t.solo && !t.muted);
  const events: ScheduledNoteEvent[] = [];
  const tempo = d.tempoBpm;
  const ppq = d.ppq;

  for (const track of d.tracks) {
    if (track.muted) continue;
    if (anySolo && !track.solo) continue;

    const clips =
      track.clips && track.clips.length > 0
        ? track.clips
        : track.notes && track.notes.length > 0
          ? [
              {
                id: `${track.id}_inline`,
                patternId: "",
                startTick: 0,
                durationTicks: d.songLengthTicks,
              },
            ]
          : [];

    for (const clip of clips) {
      if (clip.muted) continue;

      let notes: BeatStudioNote[] = [];
      let patternLen = d.songLengthTicks;
      let patternId = clip.patternId;

      if (clip.patternId && d.patterns[clip.patternId]) {
        const pattern = d.patterns[clip.patternId];
        notes = pattern.notes;
        patternLen = pattern.lengthTicks;
        patternId = pattern.id;
      } else if (track.notes) {
        notes = track.notes;
        patternLen = d.songLengthTicks;
        patternId = patternId || `${track.id}_notes`;
      } else {
        continue;
      }

      const clipDur = clip.durationTicks ?? patternLen;
      if (clip.startTick + clipDur <= fromTick) continue;
      if (clip.startTick >= toTick) continue;

      const expanded = expandClipNotes(
        notes,
        patternLen,
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
        if (n.startTick >= d.songLengthTicks && options.toTick === undefined) continue;
        events.push({
          id: n.id,
          trackId: track.id,
          clipId: clip.id,
          patternId,
          instrumentId: track.instrumentId,
          startTick: n.startTick,
          durationTicks: n.durationTicks,
          pitch: n.pitch,
          velocity: n.velocity,
          startSec: ticksToSeconds(n.startTick, tempo, ppq),
          durationSec: ticksToSeconds(n.durationTicks, tempo, ppq),
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

export function arrangementToPlaybackTracks(doc: BeatStudioDoc): {
  tempoBpm: number;
  timeSignature: [number, number];
  ppq: number;
  songLengthTicks: number;
  loop: boolean;
  tracks: Array<{
    id: string;
    name: string;
    instrumentId: InstrumentId | string;
    muted?: boolean;
    solo?: boolean;
    instrumentParams?: BeatStudioTrack["instrumentParams"];
    notes: BeatStudioNote[];
  }>;
} {
  const d = ensureV2(doc);
  const events = scheduleArrangement(d);
  const byTrack = new Map<string, BeatStudioNote[]>();
  for (const e of events) {
    let list = byTrack.get(e.trackId);
    if (!list) {
      list = [];
      byTrack.set(e.trackId, list);
    }
    list.push({
      id: e.id,
      pitch: e.pitch,
      startTick: e.startTick,
      durationTicks: e.durationTicks,
      velocity: e.velocity,
    });
  }

  const tracks = d.tracks
    .filter((t) => byTrack.has(t.id) || (t.notes && t.notes.length > 0))
    .map((t) => ({
      id: t.id,
      name: t.name,
      instrumentId: t.instrumentId,
      muted: t.muted,
      solo: t.solo,
      instrumentParams: t.instrumentParams,
      notes: byTrack.get(t.id) ?? (t.notes ? t.notes.map((n) => ({ ...n })) : []),
    }));

  return {
    tempoBpm: d.tempoBpm,
    timeSignature: d.timeSignature,
    ppq: d.ppq,
    songLengthTicks: d.songLengthTicks,
    loop: d.loop !== false,
    tracks,
  };
}
