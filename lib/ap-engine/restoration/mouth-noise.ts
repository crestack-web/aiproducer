/**
 * Selective mouth-noise treatment for phone / home vocals.
 * Targets: plosives (P/B bursts), clicks, excess breaths — never strip performance breaths.
 * Pure TypeScript, conservative by design.
 */
import { cloneStereo, stereoToMono, highPassInPlace, applyBiquadInPlace } from "../dsp";
import type { PcmStereo } from "../types";
import type { VocalRole } from "../roles";

export type MouthNoiseQC = {
  plosiveEvents: number;
  clickEvents: number;
  breathEvents: number;
  samplesTreated: number;
  maxGainReduction: number;
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

function median(vals: number[]): number {
  if (!vals.length) return 0;
  const s = [...vals].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : 0.5 * (s[m - 1] + s[m]);
}

/**
 * Soft-attenuate detected events with a raised-cosine envelope.
 * Never zeros the signal — keeps residual natural noise floor.
 */
function softDuck(
  left: Float32Array,
  right: Float32Array,
  center: number,
  halfWidth: number,
  depth: number
): number {
  const start = Math.max(0, center - halfWidth);
  const end = Math.min(left.length, center + halfWidth);
  let treated = 0;
  const span = Math.max(1, end - start);
  for (let i = start; i < end; i++) {
    const t = (i - start) / span;
    const env = 0.5 * (1 - Math.cos(2 * Math.PI * t)); // 0→1→0
    const g = 1 - depth * env;
    left[i] = (left[i] || 0) * g;
    right[i] = (right[i] || 0) * g;
    treated++;
  }
  return treated;
}

export function treatMouthNoise(opts: {
  pcm: PcmStereo;
  role?: VocalRole;
  /** 0–1 overall intensity; default conservative */
  intensity?: number;
}): { pcm: PcmStereo; qc: MouthNoiseQC } {
  const intensity = Math.max(0, Math.min(1, opts.intensity ?? 0.55));
  const role = opts.role || "lead";
  const out = cloneStereo(opts.pcm);
  const mono = stereoToMono(out);
  const sr = out.sampleRate;
  const n = mono.length;

  const qc: MouthNoiseQC = {
    plosiveEvents: 0,
    clickEvents: 0,
    breathEvents: 0,
    samplesTreated: 0,
    maxGainReduction: 0,
    applied: false,
  };

  if (n < sr * 0.15 || intensity < 0.08) {
    qc.skippedReason = "too_short_or_disabled";
    return { pcm: out, qc };
  }

  // Role: leads get moderate treatment; adlibs lighter; doubles similar to lead
  const roleMul =
    role === "lead" || role === "double"
      ? 1
      : role === "adlib"
        ? 0.65
        : role === "background"
          ? 0.75
          : 0.85;
  const strength = intensity * roleMul;

  // --- Plosive detection: low-frequency energy burst (80–250 Hz) ---
  const lowBand = new Float32Array(mono);
  applyBiquadInPlace(lowBand, "lowpass", 250, sr, 0, 0.7);
  highPassInPlace(lowBand, sr, 70);

  const hop = Math.max(1, Math.floor(sr * 0.005)); // 5 ms
  const frame = Math.max(8, Math.floor(sr * 0.012)); // 12 ms
  const lowEnv: number[] = [];
  for (let i = 0; i + frame < n; i += hop) {
    lowEnv.push(frameRms(lowBand, i, frame));
  }
  const lowMed = median(lowEnv.filter((v) => v > 1e-6)) || 1e-5;
  const lowThr = lowMed * (4.5 - strength * 1.2); // more strength → lower threshold
  const plosiveHalf = Math.floor(sr * 0.018); // ~18 ms half-width
  const plosiveDepth = 0.35 + strength * 0.25; // max ~0.6

  for (let fi = 2; fi < lowEnv.length - 2; fi++) {
    const v = lowEnv[fi];
    if (v < lowThr) continue;
    // Local peak
    if (v < lowEnv[fi - 1] || v < lowEnv[fi + 1]) continue;
    // Rising edge sharpness
    if (lowEnv[fi - 1] > v * 0.7) continue;
    const center = fi * hop + Math.floor(frame / 2);
    const treated = softDuck(out.left, out.right, center, plosiveHalf, plosiveDepth);
    qc.plosiveEvents++;
    qc.samplesTreated += treated;
    qc.maxGainReduction = Math.max(qc.maxGainReduction, plosiveDepth);
    // Skip ahead to avoid double-hits
    fi += Math.floor(plosiveHalf / hop);
  }

  // --- Click detection: very short high-frequency spikes ---
  const hiBand = new Float32Array(mono);
  highPassInPlace(hiBand, sr, 4000);
  const clickHop = Math.max(1, Math.floor(sr * 0.002));
  const clickFrame = Math.max(4, Math.floor(sr * 0.004));
  const hiEnv: number[] = [];
  for (let i = 0; i + clickFrame < n; i += clickHop) {
    hiEnv.push(frameRms(hiBand, i, clickFrame));
  }
  const hiMed = median(hiEnv.filter((v) => v > 1e-6)) || 1e-5;
  const clickThr = hiMed * (6.5 - strength * 1.5);
  const clickHalf = Math.floor(sr * 0.004);
  const clickDepth = 0.4 + strength * 0.3;

  for (let fi = 2; fi < hiEnv.length - 2; fi++) {
    const v = hiEnv[fi];
    if (v < clickThr) continue;
    if (v < hiEnv[fi - 1] || v < hiEnv[fi + 1]) continue;
    // Clicks are narrow: neighbors should be much quieter
    if (hiEnv[fi - 1] > v * 0.45 || hiEnv[fi + 1] > v * 0.45) continue;
    const center = fi * clickHop + Math.floor(clickFrame / 2);
    const treated = softDuck(out.left, out.right, center, clickHalf, clickDepth);
    qc.clickEvents++;
    qc.samplesTreated += treated;
    qc.maxGainReduction = Math.max(qc.maxGainReduction, clickDepth);
    fi += Math.floor(clickHalf / clickHop);
  }

  // --- Excess breath reduction: mid-energy, low HF, between phrases ---
  // Only attenuate breaths that are louder than a soft performance breath.
  // Never remove all breaths — keep natural performance air.
  const breathHop = Math.max(1, Math.floor(sr * 0.01));
  const breathFrame = Math.max(16, Math.floor(sr * 0.04));
  const fullEnv: number[] = [];
  for (let i = 0; i + breathFrame < n; i += breathHop) {
    fullEnv.push(frameRms(mono, i, breathFrame));
  }
  const voicedMed = median(fullEnv.filter((v) => v > lowMed * 2)) || lowMed * 3;
  const breathFloor = voicedMed * 0.08;
  const breathCeil = voicedMed * 0.28; // above this is likely residual speech
  const breathDepth = 0.25 + strength * 0.2; // mild
  const breathHalf = Math.floor(sr * 0.06);

  let inBreath = false;
  let breathStart = 0;
  for (let fi = 0; fi < fullEnv.length; fi++) {
    const v = fullEnv[fi];
    const isBreathish = v > breathFloor && v < breathCeil;
    // Prefer regions where low-band is relatively high vs full (air noise shape)
    const lowV = lowEnv[Math.min(lowEnv.length - 1, Math.floor((fi * breathHop) / hop))] || 0;
    const lowRatio = v > 1e-8 ? lowV / v : 0;
    const looksLikeBreath = isBreathish && lowRatio > 0.35;

    if (looksLikeBreath && !inBreath) {
      inBreath = true;
      breathStart = fi;
    } else if ((!looksLikeBreath || fi === fullEnv.length - 1) && inBreath) {
      inBreath = false;
      const durFrames = fi - breathStart;
      const durMs = (durFrames * breathHop * 1000) / sr;
      // Only treat longer excess breaths (60–400 ms); short ones are performance
      if (durMs >= 70 && durMs <= 420) {
        const center = Math.floor(((breathStart + fi) / 2) * breathHop);
        const treated = softDuck(out.left, out.right, center, breathHalf, breathDepth * 0.7);
        qc.breathEvents++;
        qc.samplesTreated += treated;
        qc.maxGainReduction = Math.max(qc.maxGainReduction, breathDepth * 0.7);
      }
    }
  }

  // Safety: if we treated an absurd fraction of the take, revert
  if (qc.samplesTreated > n * 0.35) {
    return {
      pcm: cloneStereo(opts.pcm),
      qc: {
        ...qc,
        applied: false,
        skippedReason: "over_treatment_fallback",
        samplesTreated: 0,
      },
    };
  }

  qc.applied =
    qc.plosiveEvents > 0 || qc.clickEvents > 0 || qc.breathEvents > 0;
  return { pcm: out, qc };
}
