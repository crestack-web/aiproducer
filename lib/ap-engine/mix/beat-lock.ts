/**
 * Lock lead vocal onset energy to the instrumental groove.
 * Conservative sample shifts only — no time-stretch (keeps natural feel).
 */
import { cloneStereo, stereoToMono } from "../dsp";
import type { PcmStereo } from "../types";

function frameEnergy(mono: Float32Array, hop: number): Float32Array {
  const n = Math.floor(mono.length / hop);
  const e = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = i * hop;
    const b = Math.min(mono.length, a + hop);
    let s = 0;
    for (let j = a; j < b; j++) {
      const x = mono[j] || 0;
      s += x * x;
    }
    e[i] = Math.sqrt(s / Math.max(1, b - a));
  }
  return e;
}

function onsetStrength(energy: Float32Array): Float32Array {
  const o = new Float32Array(energy.length);
  for (let i = 1; i < energy.length; i++) {
    o[i] = Math.max(0, energy[i] - energy[i - 1]);
  }
  return o;
}

/** Cross-correlate onset streams; return lag in frames (positive = delay vocal). */
function bestLag(vocOn: Float32Array, beatOn: Float32Array, maxLag: number): number {
  let best = 0;
  let bestScore = -1e9;
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    let score = 0;
    let count = 0;
    for (let i = 0; i < vocOn.length; i++) {
      const j = i + lag;
      if (j < 0 || j >= beatOn.length) continue;
      score += vocOn[i] * beatOn[j];
      count++;
    }
    if (count < 8) continue;
    score /= count;
    if (score > bestScore) {
      bestScore = score;
      best = lag;
    }
  }
  return best;
}

function shiftPcm(pcm: PcmStereo, samples: number): PcmStereo {
  const n = pcm.left.length;
  const out = cloneStereo(pcm);
  const o = Math.round(samples);
  if (o === 0) return out;
  out.left.fill(0);
  out.right.fill(0);
  for (let i = 0; i < n; i++) {
    const src = i - o;
    if (src < 0 || src >= n) continue;
    out.left[i] = pcm.left[src] || 0;
    out.right[i] = pcm.right[src] || 0;
  }
  return out;
}

/**
 * Align vocal bus to beat groove within ±maxMs (default 35ms).
 * Applied on the summed vocal bus before mixing into the beat.
 */
export function lockVocalToBeat(
  vocal: PcmStereo,
  beat: PcmStereo,
  maxMs = 35
): { pcm: PcmStereo; shiftMs: number } {
  const hop = Math.max(1, Math.floor(vocal.sampleRate * 0.01)); // 10ms
  const maxLag = Math.max(1, Math.floor((maxMs / 1000) * vocal.sampleRate / hop));
  const vOn = onsetStrength(frameEnergy(stereoToMono(vocal), hop));
  const bOn = onsetStrength(frameEnergy(stereoToMono(beat), hop));
  const lagFrames = bestLag(vOn, bOn, maxLag);
  const samples = lagFrames * hop;
  if (Math.abs(samples) < vocal.sampleRate * 0.003) {
    return { pcm: vocal, shiftMs: 0 };
  }
  return {
    pcm: shiftPcm(vocal, samples),
    shiftMs: (samples / vocal.sampleRate) * 1000,
  };
}
