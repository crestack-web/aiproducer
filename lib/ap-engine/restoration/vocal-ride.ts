/**
 * Phrase-level vocal riding — smooth automation before heavy compression.
 * Makes quiet phrases present and tames peaks without sounding crushed.
 * Pure TypeScript.
 */
import { cloneStereo, stereoToMono, rmsOf } from "../dsp";
import type { PcmStereo } from "../types";
import type { VocalRole } from "../roles";

export type VocalRideQC = {
  phrases: number;
  meanGainDb: number;
  maxBoostDb: number;
  maxCutDb: number;
  targetRms: number;
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

function smoothCurve(arr: Float32Array, passes: number): void {
  for (let p = 0; p < passes; p++) {
    const tmp = new Float32Array(arr);
    for (let i = 1; i < arr.length - 1; i++) {
      arr[i] = 0.25 * tmp[i - 1] + 0.5 * tmp[i] + 0.25 * tmp[i + 1];
    }
  }
}

export function rideVocalLevel(opts: {
  pcm: PcmStereo;
  role?: VocalRole;
  /** Target mono RMS for voiced regions (default role-aware) */
  targetRms?: number;
  /** Max boost in dB */
  maxBoostDb?: number;
  /** Max cut in dB */
  maxCutDb?: number;
}): { pcm: PcmStereo; qc: VocalRideQC } {
  const role = opts.role || "lead";
  const out = cloneStereo(opts.pcm);
  const mono = stereoToMono(out);
  const sr = out.sampleRate;
  const n = mono.length;

  const defaultTarget =
    role === "lead" ? 0.11 : role === "double" ? 0.095 : role === "adlib" ? 0.08 : 0.085;
  const targetRms = opts.targetRms ?? defaultTarget;
  const maxBoostDb = opts.maxBoostDb ?? (role === "lead" ? 6 : 4.5);
  const maxCutDb = opts.maxCutDb ?? (role === "lead" ? 4 : 3.5);

  const qc: VocalRideQC = {
    phrases: 0,
    meanGainDb: 0,
    maxBoostDb: 0,
    maxCutDb: 0,
    targetRms,
    applied: false,
  };

  if (n < sr * 0.25) {
    qc.skippedReason = "too_short";
    return { pcm: out, qc };
  }

  const hop = Math.max(1, Math.floor(sr * 0.01)); // 10 ms
  const frame = Math.max(32, Math.floor(sr * 0.04)); // 40 ms
  const nFrames = Math.ceil(n / hop);
  const env = new Float32Array(nFrames);
  for (let i = 0; i < nFrames; i++) {
    env[i] = frameRms(mono, i * hop, frame);
  }

  // Global noise floor estimate (quietest 15% of frames)
  const sorted = Array.from(env).filter((v) => v > 0).sort((a, b) => a - b);
  const floorIdx = Math.floor(sorted.length * 0.15);
  const noiseFloor = sorted[floorIdx] || 1e-5;
  const voiceThr = Math.max(noiseFloor * 3.5, targetRms * 0.12);

  // Segment into phrases (runs of voiced frames)
  type Phrase = { startF: number; endF: number; rms: number };
  const phrases: Phrase[] = [];
  let i = 0;
  while (i < nFrames) {
    while (i < nFrames && env[i] < voiceThr) i++;
    if (i >= nFrames) break;
    const startF = i;
    let sum = 0;
    let cnt = 0;
    while (i < nFrames && env[i] >= voiceThr * 0.55) {
      // allow brief dips inside phrase
      sum += env[i] * env[i];
      cnt++;
      i++;
    }
    const endF = i;
    const durMs = ((endF - startF) * hop * 1000) / sr;
    if (durMs >= 80 && cnt > 0) {
      phrases.push({ startF, endF, rms: Math.sqrt(sum / cnt) });
    }
  }
  qc.phrases = phrases.length;

  if (phrases.length === 0) {
    qc.skippedReason = "no_phrases";
    return { pcm: out, qc };
  }

  // Per-frame gain (linear), default 1
  const gainFrames = new Float32Array(nFrames);
  gainFrames.fill(1);

  let sumDb = 0;
  for (const ph of phrases) {
    const ratio = targetRms / Math.max(1e-6, ph.rms);
    let gDb = 20 * Math.log10(Math.max(1e-6, ratio));
    // Soft knee toward limits
    if (gDb > maxBoostDb) gDb = maxBoostDb;
    if (gDb < -maxCutDb) gDb = -maxCutDb;
    // Don't boost very quiet noise-like phrases aggressively
    if (ph.rms < voiceThr * 1.2 && gDb > 2) gDb = Math.min(gDb, 2.0);
    const g = Math.pow(10, gDb / 20);

    // Fade gain in/out at phrase edges (~30 ms)
    const fadeF = Math.max(1, Math.floor((0.03 * sr) / hop));
    for (let f = ph.startF; f < ph.endF; f++) {
      let edge = 1;
      if (f - ph.startF < fadeF) edge = (f - ph.startF) / fadeF;
      else if (ph.endF - f < fadeF) edge = (ph.endF - f) / fadeF;
      const blended = 1 + (g - 1) * edge;
      gainFrames[f] = blended;
    }
    sumDb += gDb;
    if (gDb > 0) qc.maxBoostDb = Math.max(qc.maxBoostDb, gDb);
    if (gDb < 0) qc.maxCutDb = Math.max(qc.maxCutDb, -gDb);
  }
  qc.meanGainDb = sumDb / phrases.length;

  // Heavy temporal smoothing so riding is invisible
  smoothCurve(gainFrames, 6);

  // Apply sample-accurate gain via linear interpolation of frame gains
  for (let s = 0; s < n; s++) {
    const fPos = s / hop;
    const f0 = Math.min(nFrames - 1, Math.floor(fPos));
    const f1 = Math.min(nFrames - 1, f0 + 1);
    const frac = fPos - f0;
    const g = gainFrames[f0] * (1 - frac) + gainFrames[f1] * frac;
    out.left[s] = (out.left[s] || 0) * g;
    out.right[s] = (out.right[s] || 0) * g;
  }

  // Peak safety
  let peak = 0;
  for (let s = 0; s < n; s++) {
    peak = Math.max(peak, Math.abs(out.left[s] || 0), Math.abs(out.right[s] || 0));
  }
  if (peak > 0.98) {
    const g = 0.95 / peak;
    for (let s = 0; s < n; s++) {
      out.left[s] *= g;
      out.right[s] *= g;
    }
  }

  // Sanity: if overall RMS exploded or collapsed, revert
  const after = rmsOf(stereoToMono(out));
  const before = rmsOf(mono);
  if (before > 1e-6 && (after / before > 3.5 || after / before < 0.25)) {
    return {
      pcm: cloneStereo(opts.pcm),
      qc: { ...qc, applied: false, skippedReason: "level_explosion_fallback" },
    };
  }

  qc.applied = Math.abs(qc.meanGainDb) > 0.15 || qc.maxBoostDb > 0.3 || qc.maxCutDb > 0.3;
  return { pcm: out, qc };
}
