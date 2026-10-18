/**
 * Beat Studio audio engine — Web Audio only, React-free.
 *
 * Contract: callers supply AudioContext. See TRANSPORT.md.
 */

import {
  MAX_VOICES,
  type BeatStudioDoc,
  type BeatStudioNote,
  type InstrumentId,
  type InstrumentParams,
} from "./types";
import { ticksToSeconds, patternLengthTicks } from "./time";

export type ActiveVoice = {
  stop: (when?: number) => void;
};

export type Instrument = {
  id: InstrumentId;
  /** Note on; durationSec used if no explicit note-off */
  noteOn: (
    ctx: AudioContext,
    pitch: number,
    velocity: number,
    when: number,
    durationSec: number,
    params?: InstrumentParams
  ) => ActiveVoice;
};

function midiToFreq(pitch: number): number {
  return 440 * Math.pow(2, (pitch - 69) / 12);
}

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}

/** Karplus-ish pluck: short noise burst through decaying resonant filter */
function createPluckInstrument(): Instrument {
  return {
    id: "pluck",
    noteOn(ctx, pitch, velocity, when, durationSec, params) {
      const vel = clamp01(velocity / 127);
      const freq = midiToFreq(pitch);
      const dur = Math.max(0.05, durationSec);
      const gainAmt = (params?.gain ?? 0.35) * vel;

      const noiseDur = Math.min(0.04, dur * 0.15);
      const bufferSize = Math.max(1, Math.floor(ctx.sampleRate * noiseDur));
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

      const src = ctx.createBufferSource();
      src.buffer = buffer;

      const filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.setValueAtTime(freq, when);
      filter.Q.setValueAtTime(8 + vel * 12, when);

      const gain = ctx.createGain();
      const attack = params?.attackSec ?? 0.005;
      const release = params?.releaseSec ?? Math.min(0.4, dur * 0.5);
      gain.gain.setValueAtTime(0.0001, when);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.001, gainAmt), when + attack);
      gain.gain.exponentialRampToValueAtTime(0.0001, when + Math.max(attack + 0.02, dur));

      src.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      src.start(when);
      src.stop(when + noiseDur + 0.01);

      // sustain body: short sine at pitch
      const osc = ctx.createOscillator();
      const og = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(freq, when);
      og.gain.setValueAtTime(0.0001, when);
      og.gain.exponentialRampToValueAtTime(Math.max(0.001, gainAmt * 0.45), when + attack);
      og.gain.exponentialRampToValueAtTime(0.0001, when + dur);
      osc.connect(og);
      og.connect(ctx.destination);
      osc.start(when);
      osc.stop(when + dur + release);

      return {
        stop: (w?: number) => {
          const t = w ?? ctx.currentTime;
          try {
            gain.gain.cancelScheduledValues(t);
            gain.gain.setValueAtTime(Math.max(0.0001, gain.gain.value), t);
            gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
            og.gain.cancelScheduledValues(t);
            og.gain.setValueAtTime(Math.max(0.0001, og.gain.value), t);
            og.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
            osc.stop(t + 0.05);
          } catch {
            /* already stopped */
          }
        },
      };
    },
  };
}

function createBasicSynth(id: InstrumentId, type: OscillatorType): Instrument {
  return {
    id,
    noteOn(ctx, pitch, velocity, when, durationSec, params) {
      const vel = clamp01(velocity / 127);
      const dur = Math.max(0.04, durationSec);
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      const p = id === "synth_bass" ? Math.min(pitch, 52) : pitch;
      osc.frequency.setValueAtTime(midiToFreq(p), when);
      const peak = (params?.gain ?? (id === "synth_bass" ? 0.28 : 0.16)) * vel;
      const attack = params?.attackSec ?? 0.01;
      gain.gain.setValueAtTime(0.0001, when);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.001, peak), when + attack);
      gain.gain.exponentialRampToValueAtTime(0.0001, when + dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(when);
      osc.stop(when + dur + 0.03);
      return {
        stop: (w?: number) => {
          try {
            const t = w ?? ctx.currentTime;
            gain.gain.cancelScheduledValues(t);
            gain.gain.setValueAtTime(Math.max(0.0001, gain.gain.value), t);
            gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
            osc.stop(t + 0.05);
          } catch {
            /* */
          }
        },
      };
    },
  };
}

function createDrumInstrument(): Instrument {
  return {
    id: "drum_kit",
    noteOn(ctx, pitch, velocity, when, _durationSec, params) {
      const vel = clamp01(velocity / 127) * (params?.gain ?? 1);
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();
      if (pitch < 48) {
        osc.type = "sine";
        osc.frequency.setValueAtTime(150, when);
        osc.frequency.exponentialRampToValueAtTime(40, when + 0.12);
        gain.gain.setValueAtTime(0.0001, when);
        gain.gain.exponentialRampToValueAtTime(Math.max(0.001, 0.5 * vel), when + 0.005);
        gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.25);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(when);
        osc.stop(when + 0.3);
      } else if (pitch < 72) {
        osc.type = "square";
        osc.frequency.setValueAtTime(180, when);
        filter.type = "bandpass";
        filter.frequency.setValueAtTime(1200, when);
        gain.gain.setValueAtTime(0.0001, when);
        gain.gain.exponentialRampToValueAtTime(Math.max(0.001, 0.25 * vel), when + 0.005);
        gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.15);
        osc.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);
        osc.start(when);
        osc.stop(when + 0.2);
      } else {
        osc.type = "square";
        osc.frequency.setValueAtTime(8000, when);
        filter.type = "highpass";
        filter.frequency.setValueAtTime(6000, when);
        gain.gain.setValueAtTime(0.0001, when);
        gain.gain.exponentialRampToValueAtTime(Math.max(0.001, 0.12 * vel), when + 0.002);
        gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.05);
        osc.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);
        osc.start(when);
        osc.stop(when + 0.08);
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
    },
  };
}

const INSTRUMENTS: Record<InstrumentId, Instrument> = {
  pluck: createPluckInstrument(),
  synth_lead: createBasicSynth("synth_lead", "sawtooth"),
  synth_bass: createBasicSynth("synth_bass", "triangle"),
  drum_kit: createDrumInstrument(),
};

export function getInstrument(id: InstrumentId): Instrument {
  return INSTRUMENTS[id] || INSTRUMENTS.pluck;
}

/** Voice pool — stops oldest when over MAX_VOICES */
export class VoicePool {
  private voices: ActiveVoice[] = [];

  add(v: ActiveVoice) {
    this.voices.push(v);
    while (this.voices.length > MAX_VOICES) {
      const old = this.voices.shift();
      old?.stop();
    }
  }

  stopAll(when?: number) {
    for (const v of this.voices) v.stop(when);
    this.voices = [];
  }

  get size() {
    return this.voices.length;
  }
}

/**
 * Play a single note through the given context (live key or scheduled).
 */
export function playNote(
  ctx: AudioContext,
  instrumentId: InstrumentId,
  pitch: number,
  velocity: number,
  durationSec: number,
  when?: number,
  params?: InstrumentParams,
  pool?: VoicePool
): ActiveVoice {
  const inst = getInstrument(instrumentId);
  const start = when ?? ctx.currentTime;
  const voice = inst.noteOn(ctx, pitch, velocity, start, durationSec, params);
  pool?.add(voice);
  return voice;
}

export type PatternPlayer = {
  stop: () => void;
};

/**
 * Schedule pattern notes on the audio clock. Cancelling stops voices and loop timer.
 * Does not create its own AudioContext.
 */
export function playPattern(
  ctx: AudioContext,
  doc: BeatStudioDoc,
  opts?: { lookAheadSec?: number; loop?: boolean; pool?: VoicePool }
): PatternPlayer {
  const lookAhead = opts?.lookAheadSec ?? 0.05;
  const t0 = ctx.currentTime + lookAhead;
  const pool = opts?.pool ?? new VoicePool();
  let stopped = false;
  const generation = { n: 0 };
  const myGen = ++generation.n;

  const scheduleOnce = (cycleOffsetSec: number) => {
    if (stopped) return;
    for (const track of doc.tracks) {
      if (track.muted) continue;
      for (const note of track.notes) {
        const startSec = ticksToSeconds(note.startTick, doc.tempoBpm, doc.ppq) + cycleOffsetSec;
        const durSec = Math.max(
          0.03,
          ticksToSeconds(note.durationTicks, doc.tempoBpm, doc.ppq)
        );
        playNote(
          ctx,
          track.instrumentId,
          note.pitch,
          note.velocity,
          durSec,
          t0 + startSec,
          track.instrumentParams,
          pool
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
  const shouldLoop = opts?.loop ?? doc.loop ?? false;
  if (shouldLoop && patternSec > 0.05) {
    let cycle = 1;
    loopTimer = setInterval(() => {
      if (stopped || myGen !== generation.n) return;
      scheduleOnce(cycle * patternSec);
      cycle += 1;
    }, Math.max(40, patternSec * 1000 - 40));
  }

  return {
    stop: () => {
      stopped = true;
      generation.n++;
      if (loopTimer) clearInterval(loopTimer);
      loopTimer = null;
      pool.stopAll(ctx.currentTime);
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
