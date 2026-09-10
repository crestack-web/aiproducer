/**
 * Conservative room/noise cleanup for phone takes.
 * Budget-limited: never strip identity or create underwater artifacts.
 */
import {
  applyBiquadInPlace,
  cloneStereo,
  gateInPlace,
  rmsOf,
  stereoToMono,
  dbToGain,
} from "../dsp";
import type { PcmStereo } from "../types";

export type RoomToneQC = {
  applied: boolean;
  noiseFloor: number;
  reductionDb: number;
  gatedRatio: number;
  reverted: boolean;
};

function estimateNoiseFloor(mono: Float32Array, sampleRate: number): number {
  const win = Math.max(64, Math.floor(sampleRate * 0.02));
  const hop = Math.max(32, Math.floor(win / 2));
  const energies: number[] = [];
  for (let i = 0; i + win < mono.length; i += hop) {
    let s = 0;
    for (let j = 0; j < win; j++) {
      const x = mono[i + j] || 0;
      s += x * x;
    }
    energies.push(Math.sqrt(s / win));
  }
  if (!energies.length) return 0;
  energies.sort((a, b) => a - b);
  // 15th percentile ≈ noise floor
  const idx = Math.max(0, Math.floor(energies.length * 0.15));
  return energies[idx] || 0;
}

/**
 * Soft spectral-ish cleanup:
 * 1) measure noise floor from quiet frames
 * 2) gentle high-band duck when signal is near floor (room hiss)
 * 3) slightly tighter gate than restore
 * Revert if too much energy removed.
 */
export function treatRoomTone(opts: {
  pcm: PcmStereo;
  intensity?: number; // 0–1
}): { pcm: PcmStereo; qc: RoomToneQC } {
  const intensity = Math.max(0, Math.min(1, opts.intensity ?? 0.45));
  const src = opts.pcm;
  const mono = stereoToMono(src);
  const noiseFloor = estimateNoiseFloor(mono, src.sampleRate);
  const signalRms = rmsOf(mono);

  const qc: RoomToneQC = {
    applied: false,
    noiseFloor,
    reductionDb: 0,
    gatedRatio: 0,
    reverted: false,
  };

  // Clean takes: skip
  if (noiseFloor < 0.0008 || signalRms < 1e-6 || noiseFloor / signalRms < 0.04) {
    return { pcm: src, qc };
  }

  const out = cloneStereo(src);
  const sr = out.sampleRate;
  const n = out.left.length;

  // High-band noise reduction when near floor (hiss/room)
  const hissThresh = noiseFloor * (2.2 - intensity * 0.6);
  const atk = Math.exp(-1 / (0.005 * sr));
  const rel = Math.exp(-1 / (0.08 * sr));
  let env = 0;
  let ducked = 0;

  // Work on a high-passed residual for hiss control
  const hiL = new Float32Array(out.left);
  const hiR = new Float32Array(out.right);
  applyBiquadInPlace(hiL, "highpass", 4500, sr, 0, 0.7);
  applyBiquadInPlace(hiR, "highpass", 4500, sr, 0, 0.7);

  for (let i = 0; i < n; i++) {
    const a = Math.max(Math.abs(out.left[i] || 0), Math.abs(out.right[i] || 0));
    env = a > env ? atk * env + (1 - atk) * a : rel * env + (1 - rel) * a;
    // When quiet, attenuate high residual more
    let hiDuck = 1;
    if (env < hissThresh * 3) {
      const t = Math.max(0, Math.min(1, env / (hissThresh * 3 + 1e-12)));
      hiDuck = 0.35 + 0.65 * t; // up to 65% high reduction in silence
      hiDuck = 1 - (1 - hiDuck) * intensity;
      ducked++;
    }
    const dryL = out.left[i] || 0;
    const dryR = out.right[i] || 0;
    // Blend: remove portion of high residual when quiet
    out.left[i] = dryL - (hiL[i] || 0) * (1 - hiDuck) * 0.85;
    out.right[i] = dryR - (hiR[i] || 0) * (1 - hiDuck) * 0.85;
  }

  // Milder gate using measured floor
  const gateDb = 20 * Math.log10(Math.max(noiseFloor * 1.8, 1e-6));
  const thr = Math.max(-48, Math.min(-28, gateDb + 6));
  gateInPlace(out.left, sr, thr);
  gateInPlace(out.right, sr, thr);

  const outRms = rmsOf(stereoToMono(out));
  const reductionDb = 20 * Math.log10((signalRms + 1e-12) / (outRms + 1e-12));
  qc.reductionDb = reductionDb;
  qc.gatedRatio = ducked / Math.max(1, n);
  qc.applied = true;

  // Over-clean guard: if we removed > 3.5 dB overall, revert
  if (reductionDb > 3.5 || outRms < signalRms * 0.55) {
    qc.reverted = true;
    qc.applied = false;
    return { pcm: src, qc };
  }

  return { pcm: out, qc };
}

/**
 * Soft de-reverb: reduce long low-energy tails in mid-high band.
 * Not a neural de-reverb — just shortens room wash without killing body.
 */
export function softDeReverb(opts: {
  pcm: PcmStereo;
  intensity?: number;
}): { pcm: PcmStereo; applied: boolean } {
  const intensity = Math.max(0, Math.min(1, opts.intensity ?? 0.35));
  if (intensity < 0.05) return { pcm: opts.pcm, applied: false };

  const out = cloneStereo(opts.pcm);
  const sr = out.sampleRate;
  const n = out.left.length;
  const atk = Math.exp(-1 / (0.003 * sr));
  const rel = Math.exp(-1 / (0.2 * sr)); // slow release = sustain/reverb detector
  let env = 0;
  let peak = 0;

  for (let i = 0; i < n; i++) {
    const a = Math.max(Math.abs(out.left[i] || 0), Math.abs(out.right[i] || 0));
    peak = Math.max(peak * 0.9995, a);
    env = a > env ? atk * env + (1 - atk) * a : rel * env + (1 - rel) * a;
    // Tail = energy present but well below recent peak
    const isTail = peak > 0.02 && env < peak * 0.22 && a < peak * 0.3;
    if (isTail) {
      const g = 1 - 0.35 * intensity;
      out.left[i] = (out.left[i] || 0) * g;
      out.right[i] = (out.right[i] || 0) * g;
    }
  }
  return { pcm: out, applied: true };
}
