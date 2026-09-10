/**
 * YIN fundamental-frequency detector for monophonic vocals.
 * Pure TypeScript — no ML / GPU deps.
 */
import type { PitchFrame } from "./types";

const YIN_THRESHOLD = 0.15;
const MIN_HZ = 70;
const MAX_HZ = 1000;

export function hzToMidi(hz: number): number {
  return 69 + 12 * Math.log2(hz / 440);
}

export function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function centsBetween(aHz: number, bHz: number): number {
  if (aHz <= 0 || bHz <= 0) return 0;
  return 1200 * Math.log2(aHz / bHz);
}

export function detectPitchYin(
  mono: Float32Array,
  sampleRate: number,
  opts?: { hopMs?: number; frameMs?: number; threshold?: number }
): PitchFrame[] {
  const hopMs = opts?.hopMs ?? 10;
  const frameMs = opts?.frameMs ?? 40;
  const threshold = opts?.threshold ?? YIN_THRESHOLD;
  const hop = Math.max(1, Math.floor((sampleRate * hopMs) / 1000));
  const frameSize = Math.max(64, Math.floor((sampleRate * frameMs) / 1000));
  const tauMax = Math.min(frameSize - 2, Math.floor(sampleRate / MIN_HZ));
  const tauMin = Math.max(2, Math.floor(sampleRate / MAX_HZ));
  const frames: PitchFrame[] = [];
  const yinBuffer = new Float32Array(tauMax + 1);

  for (let start = 0; start + frameSize < mono.length; start += hop) {
    const time = start / sampleRate;
    let energy = 0;
    for (let i = 0; i < frameSize; i++) {
      const v = mono[start + i] || 0;
      energy += v * v;
    }
    energy = Math.sqrt(energy / frameSize);
    if (energy < 0.008) {
      frames.push({ time, frequencyHz: null, midiNote: null, confidence: 0, voiced: false });
      continue;
    }

    yinBuffer[0] = 1;
    for (let tau = 1; tau <= tauMax; tau++) {
      let sum = 0;
      for (let i = 0; i < frameSize - tau; i++) {
        const d = (mono[start + i] || 0) - (mono[start + i + tau] || 0);
        sum += d * d;
      }
      yinBuffer[tau] = sum;
    }

    let running = 0;
    yinBuffer[0] = 1;
    for (let tau = 1; tau <= tauMax; tau++) {
      running += yinBuffer[tau];
      yinBuffer[tau] = running > 0 ? (yinBuffer[tau] * tau) / running : 1;
    }

    let tauEstimate = -1;
    for (let tau = tauMin; tau <= tauMax; tau++) {
      if (yinBuffer[tau] < threshold) {
        while (tau + 1 <= tauMax && yinBuffer[tau + 1] < yinBuffer[tau]) tau++;
        tauEstimate = tau;
        break;
      }
    }

    if (tauEstimate < 0) {
      let minVal = 1;
      let minTau = -1;
      for (let tau = tauMin; tau <= tauMax; tau++) {
        if (yinBuffer[tau] < minVal) {
          minVal = yinBuffer[tau];
          minTau = tau;
        }
      }
      if (minTau > 0 && minVal < 0.45) tauEstimate = minTau;
    }

    if (tauEstimate <= 0) {
      frames.push({ time, frequencyHz: null, midiNote: null, confidence: 0, voiced: false });
      continue;
    }

    const x0 = tauEstimate > 0 ? yinBuffer[tauEstimate - 1] : yinBuffer[tauEstimate];
    const x1 = yinBuffer[tauEstimate];
    const x2 = tauEstimate + 1 <= tauMax ? yinBuffer[tauEstimate + 1] : yinBuffer[tauEstimate];
    const denom = 2 * (2 * x1 - x2 - x0);
    const betterTau = denom !== 0 ? tauEstimate + (x2 - x0) / denom : tauEstimate;
    const hz = sampleRate / Math.max(1e-6, betterTau);

    if (hz < MIN_HZ || hz > MAX_HZ || !Number.isFinite(hz)) {
      frames.push({ time, frequencyHz: null, midiNote: null, confidence: 0, voiced: false });
      continue;
    }

    const conf = Math.max(0, Math.min(1, 1 - yinBuffer[tauEstimate]));
    const voiced = conf >= 0.35 && energy >= 0.012;
    frames.push({
      time,
      frequencyHz: voiced ? hz : null,
      midiNote: voiced ? hzToMidi(hz) : null,
      confidence: conf,
      voiced,
    });
  }
  return frames;
}
