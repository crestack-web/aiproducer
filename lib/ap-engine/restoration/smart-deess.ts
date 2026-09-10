/**
 * Adaptive de-esser: measures 5–10 kHz sibilance peaks and ducks only when needed.
 * Avoids the dull “always on” de-ess of a fixed amount.
 */
import {
  cloneStereo,
  highPassInPlace,
  applyBiquadInPlace,
  stereoToMono,
  rmsOf,
} from "../dsp";
import type { PcmStereo } from "../types";
import type { VocalRole } from "../roles";

export type SmartDeessQC = {
  sibilanceRatio: number;
  events: number;
  meanDuck: number;
  maxDuck: number;
  applied: boolean;
  skippedReason?: string;
};

function frameRms(buf: Float32Array, start: number, len: number): number {
  let s = 0;
  const end = Math.min(buf.length, start + len);
  const n = Math.max(1, end - start);
  for (let i = start; i < end; i++) {
    const v = buf[i] || 0;
    s += v * v;
  }
  return Math.sqrt(s / n);
}

export function smartDeess(opts: {
  pcm: PcmStereo;
  role?: VocalRole;
  /** Base sensitivity 0–1 (from VocalDecision.deEsserAmount) */
  amount?: number;
}): { pcm: PcmStereo; qc: SmartDeessQC } {
  const role = opts.role || "lead";
  const amount = Math.max(0, Math.min(1, opts.amount ?? 0.3));
  const out = cloneStereo(opts.pcm);
  const sr = out.sampleRate;
  const n = out.left.length;

  const qc: SmartDeessQC = {
    sibilanceRatio: 0,
    events: 0,
    meanDuck: 0,
    maxDuck: 0,
    applied: false,
  };

  if (amount < 0.05 || n < sr * 0.1) {
    qc.skippedReason = "disabled_or_short";
    return { pcm: out, qc };
  }

  // Extract sibilance band ~5–9.5 kHz
  const sibL = new Float32Array(out.left);
  const sibR = new Float32Array(out.right);
  highPassInPlace(sibL, sr, 5200);
  highPassInPlace(sibR, sr, 5200);
  applyBiquadInPlace(sibL, "lowpass", 9500, sr, 0, 0.7);
  applyBiquadInPlace(sibR, "lowpass", 9500, sr, 0, 0.7);

  const mono = stereoToMono(out);
  const fullRms = rmsOf(mono) || 1e-6;
  let sibEnergy = 0;
  for (let i = 0; i < n; i++) {
    const s = 0.5 * (Math.abs(sibL[i] || 0) + Math.abs(sibR[i] || 0));
    sibEnergy += s * s;
  }
  const sibRms = Math.sqrt(sibEnergy / n);
  qc.sibilanceRatio = sibRms / fullRms;

  // If sibilance is already mild, skip or go very light
  if (qc.sibilanceRatio < 0.12) {
    qc.skippedReason = "low_sibilance";
    return { pcm: out, qc };
  }

  // Role: lead gets more protection; backgrounds less critical
  const roleMul = role === "lead" ? 1.1 : role === "double" ? 0.95 : role === "adlib" ? 0.7 : 0.85;
  const sens = amount * roleMul;

  // Threshold from distribution of sibilance envelope
  const hop = Math.max(1, Math.floor(sr * 0.002));
  const frame = Math.max(8, Math.floor(sr * 0.006));
  const env: number[] = [];
  for (let i = 0; i + frame < n; i += hop) {
    env.push(0.5 * (frameRms(sibL, i, frame) + frameRms(sibR, i, frame)));
  }
  const sorted = [...env].sort((a, b) => a - b);
  const p70 = sorted[Math.floor(sorted.length * 0.7)] || 0;
  const p90 = sorted[Math.floor(sorted.length * 0.9)] || p70;
  const thr = p70 + (p90 - p70) * (0.35 + (1 - sens) * 0.4);

  // Sample-by-sample envelope follower + duck only the sibilance band contribution
  // Practical approach: broadband duck limited in depth, fast attack, when env > thr
  const atk = Math.exp(-1 / (0.0015 * sr));
  const rel = Math.exp(-1 / (0.05 * sr));
  let e = 0;
  let duckSum = 0;
  let duckN = 0;
  const maxDepth = 0.25 + sens * 0.35; // 0.25–0.60

  for (let i = 0; i < n; i++) {
    const s = 0.5 * (Math.abs(sibL[i] || 0) + Math.abs(sibR[i] || 0));
    e = s > e ? atk * e + (1 - atk) * s : rel * e + (1 - rel) * s;
    let duck = 1;
    if (e > thr) {
      const over = (e - thr) / (e + 1e-9);
      duck = 1 - Math.min(maxDepth, over * maxDepth * 1.2);
      qc.events++;
      duckSum += 1 - duck;
      duckN++;
      qc.maxDuck = Math.max(qc.maxDuck, 1 - duck);
    }
    out.left[i] = (out.left[i] || 0) * duck;
    out.right[i] = (out.right[i] || 0) * duck;
  }

  qc.meanDuck = duckN ? duckSum / duckN : 0;

  // Fallback if we ducked too much of the take (dull vocal risk)
  if (qc.events > n * 0.45 || qc.meanDuck > 0.4) {
    return {
      pcm: cloneStereo(opts.pcm),
      qc: {
        ...qc,
        applied: false,
        skippedReason: "over_deess_fallback",
      },
    };
  }

  qc.applied = qc.events > 0 && qc.meanDuck > 0.02;
  return { pcm: out, qc };
}
