/**
 * Minimal Beat Studio audio engine — Web Audio only.
 * Accepts an external AudioContext so Console can share transport later.
 */

import type { BeatStudioDoc, BeatStudioNote, InstrumentId } from "./types";
import { ticksToSeconds, patternLengthTicks } from "./time";

export type ActiveVoice = {
  stop: (when?: number) => void;
};

function midiToFreq(pitch: number): number {
  return 440 * Math.pow(2, (pitch - 69) / 12);
}

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}

/**
 * Trigger a single note. Returns a handle to stop early.
 * Uses simple synth voices — no external samples required for MVP.
 */
export function playNote(
  ctx: AudioContext,
  instrumentId: InstrumentId,
  pitch: number,
  velocity: number,
  durationSec: number,
  when?: number
): ActiveVoice {
  const start = when ?? ctx.currentTime;
  const dur = Math.max(0.04, durationSec);
  const vel = clamp01(velocity / 127);
  const dest = ctx.destination;

  if (instrumentId === "drum_kit") {
    return playDrum(ctx, pitch, vel, start, dest);
  }

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = instrumentId === "synth_bass" ? "triangle" : "sawtooth";
  osc.frequency.setValueAtTime(midiToFreq(pitch), start);
  if (instrumentId === "synth_bass") {
    osc.frequency.setValueAtTime(midiToFreq(Math.min(pitch, 48)), start);
  }
  const peak = instrumentId === "synth_bass" ? 0.28 * vel : 0.18 * vel;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(gain);
  gain.connect(dest);
  osc.start(start);
  osc.stop(start + dur + 0.02);
  return {
    stop: (w?: number) => {
      try {
        const t = w ?? ctx.currentTime;
        gain.gain.cancelScheduledValues(t);
        gain.gain.setValueAtTime(Math.max(0.0001, gain.gain.value), t);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
        osc.stop(t + 0.05);
      } catch {
        /* already stopped */
      }
    },
  };
}

function playDrum(
  ctx: AudioContext,
  pitch: number,
  vel: number,
  start: number,
  dest: AudioNode
): ActiveVoice {
  // Map pitch bands: low = kick, mid = snare-ish, high = hat
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const filter = ctx.createBiquadFilter();
  if (pitch < 48) {
    osc.type = "sine";
    osc.frequency.setValueAtTime(150, start);
    osc.frequency.exponentialRampToValueAtTime(40, start + 0.12);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.5 * vel, start + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.25);
    osc.connect(gain);
    gain.connect(dest);
    osc.start(start);
    osc.stop(start + 0.3);
  } else if (pitch < 72) {
    // noise-ish snare via high square + filter
    osc.type = "square";
    osc.frequency.setValueAtTime(180, start);
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(1200, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.25 * vel, start + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.15);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(dest);
    osc.start(start);
    osc.stop(start + 0.2);
  } else {
    osc.type = "square";
    osc.frequency.setValueAtTime(8000, start);
    filter.type = "highpass";
    filter.frequency.setValueAtTime(6000, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.12 * vel, start + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.05);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(dest);
    osc.start(start);
    osc.stop(start + 0.08);
  }
  return {
    stop: (w?: number) => {
      try {
        osc.stop(w ?? ctx.currentTime);
      } catch {
        /* */
      }
    },
  };
}

export type PatternPlayer = {
  stop: () => void;
};

/**
 * Schedule all unmuted notes in the doc relative to ctx.currentTime + lookAhead.
 */
export function playPattern(
  ctx: AudioContext,
  doc: BeatStudioDoc,
  opts?: { lookAheadSec?: number; loop?: boolean }
): PatternPlayer {
  const lookAhead = opts?.lookAheadSec ?? 0.05;
  const t0 = ctx.currentTime + lookAhead;
  const voices: ActiveVoice[] = [];
  let stopped = false;

  const scheduleOnce = (cycleOffsetSec: number) => {
    for (const track of doc.tracks) {
      if (track.muted) continue;
      for (const note of track.notes) {
        const startSec = ticksToSeconds(note.startTick, doc.tempoBpm, doc.ppq) + cycleOffsetSec;
        const durSec = ticksToSeconds(note.durationTicks, doc.tempoBpm, doc.ppq);
        voices.push(
          playNote(ctx, track.instrumentId, note.pitch, note.velocity, durSec, t0 + startSec)
        );
      }
    }
  };

  scheduleOnce(0);
  const patternSec = ticksToSeconds(
    patternLengthTicks(doc.bars, doc.timeSignature, doc.ppq),
    doc.tempoBpm,
    doc.ppq
  );

  let loopTimer: ReturnType<typeof setInterval> | null = null;
  if (opts?.loop && patternSec > 0.05) {
    let cycle = 1;
    loopTimer = setInterval(() => {
      if (stopped) return;
      scheduleOnce(cycle * patternSec);
      cycle += 1;
    }, Math.max(50, patternSec * 1000 - 30));
  }

  return {
    stop: () => {
      stopped = true;
      if (loopTimer) clearInterval(loopTimer);
      for (const v of voices) v.stop();
    },
  };
}

export function newNoteId(): string {
  return `n_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createNote(
  pitch: number,
  startTick: number,
  durationTicks: number,
  velocity = 100
): BeatStudioNote {
  return {
    id: newNoteId(),
    pitch,
    startTick,
    durationTicks,
    velocity,
  };
}
