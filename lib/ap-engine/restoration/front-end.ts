/**
 * Restoration Front-End — first stage on raw phone/bedroom vocals.
 * Order: level → noise → de-reverb → clicks/plosives → confidence gate.
 * Never maxes out processing; artifact_risk caps how hard we push.
 */
import {
  applyGainStereo,
  cloneStereo,
  dbToGain,
  gainToDb,
  highPassInPlace,
  peakOf,
  rmsOf,
  stereoToMono,
  gateInPlace,
} from "../dsp";
import type { PcmStereo } from "../types";
import { treatMouthNoise } from "./mouth-noise";
import { cleanTakeEdges } from "./edge-fade";
import { trimVocalSilence } from "./silence-trim";

export type RestorationConfidence = "high" | "medium" | "low";

export type RestorationReport = {
  noiseFloorBeforeDb: number;
  noiseFloorAfterDb: number;
  reverbReductionApplied: number;
  levelGainDb: number;
  artifactRiskScore: number;
  confidence: RestorationConfidence;
  flags: string[];
  plainLanguage: string[];
};

export type RestorationFrontEndResult = {
  pcm: PcmStereo;
  report: RestorationReport;
};

function estimateNoiseFloorDb(mono: Float32Array, sr: number): number {
  const frame = Math.max(64, Math.floor(sr * 0.02));
  const energies: number[] = [];
  for (let i = 0; i + frame < mono.length; i += frame) {
    let s = 0;
    for (let j = 0; j < frame; j++) {
      const v = mono[i + j] || 0;
      s += v * v;
    }
    energies.push(Math.sqrt(s / frame));
  }
  if (!energies.length) return -80;
  energies.sort((a, b) => a - b);
  const quiet = energies[Math.floor(energies.length * 0.12)] || 1e-8;
  return gainToDb(Math.max(quiet, 1e-8));
}

function spectralFlatnessProxy(mono: Float32Array, sr: number): number {
  // Rough: ratio of low-band energy to high (room noise often high-band hiss)
  const frame = Math.max(128, Math.floor(sr * 0.04));
  let low = 0;
  let high = 0;
  let n = 0;
  // Simple differentiator energy as high proxy
  for (let i = 1; i < mono.length; i++) {
    const d = (mono[i] || 0) - (mono[i - 1] || 0);
    high += d * d;
    low += (mono[i] || 0) * (mono[i] || 0);
    n++;
  }
  if (n < 1 || low < 1e-12) return 0.5;
  return Math.min(1, Math.sqrt(high / low));
}

function transientPreservationScore(before: Float32Array, after: Float32Array): number {
  const n = Math.min(before.length, after.length);
  let peakB = 0;
  let peakA = 0;
  const hop = Math.max(1, Math.floor(n / 200));
  for (let i = 0; i < n; i += hop) {
    peakB = Math.max(peakB, Math.abs(before[i] || 0));
    peakA = Math.max(peakA, Math.abs(after[i] || 0));
  }
  if (peakB < 1e-6) return 1;
  const ratio = peakA / peakB;
  // 1 = preserved, 0 = smashed
  return Math.max(0, Math.min(1, 1 - Math.abs(1 - ratio) * 0.8));
}

/** Soft spectral-ish NR: expand quieter frames downward (ceiling by risk). */
function adaptiveNoiseReduce(
  pcm: PcmStereo,
  noiseFloorDb: number,
  maxReductionDb: number
): { pcm: PcmStereo; appliedDb: number } {
  const out = cloneStereo(pcm);
  const mono = stereoToMono(out);
  const sr = out.sampleRate;
  const frame = Math.max(64, Math.floor(sr * 0.012));
  const floorLin = dbToGain(noiseFloorDb);
  const maxRed = dbToGain(-Math.abs(maxReductionDb));

  for (let i = 0; i + frame < mono.length; i += frame) {
    let s = 0;
    for (let j = 0; j < frame; j++) s += (mono[i + j] || 0) ** 2;
    const rms = Math.sqrt(s / frame);
    // Only attenuate frames near noise floor
    if (rms < floorLin * 4.5) {
      const excess = Math.max(0.05, rms / (floorLin * 4.5));
      // stronger when closer to floor
      const atten = Math.max(maxRed, excess * excess);
      for (let j = 0; j < frame; j++) {
        out.left[i + j] = (out.left[i + j] || 0) * atten;
        out.right[i + j] = (out.right[i + j] || 0) * atten;
      }
    }
  }
  // Gentle HPF to strip rumble/phone handling noise
  highPassInPlace(out.left, sr, 70);
  highPassInPlace(out.right, sr, 70);
  return { pcm: out, appliedDb: maxReductionDb };
}

/**
 * Light de-reverb: high-shelf cut + mild mid dip on low-energy tails.
 * Conservative — artifact risk rises quickly with aggressive de-reverb.
 */
function lightDeReverb(pcm: PcmStereo, amount: number): PcmStereo {
  if (amount < 0.05) return pcm;
  const out = cloneStereo(pcm);
  const mono = stereoToMono(out);
  const sr = out.sampleRate;
  const frame = Math.max(64, Math.floor(sr * 0.02));
  const peak = peakOf(mono) || 1e-6;
  const thr = peak * 0.08;

  // Attenuate mid-late energy in quiet frames (reflections)
  for (let i = 0; i + frame < mono.length; i += frame) {
    let s = 0;
    for (let j = 0; j < frame; j++) s += (mono[i + j] || 0) ** 2;
    const rms = Math.sqrt(s / frame);
    if (rms < thr) {
      const g = 1 - amount * 0.55 * (1 - rms / thr);
      for (let j = 0; j < frame; j++) {
        out.left[i + j] = (out.left[i + j] || 0) * g;
        out.right[i + j] = (out.right[i + j] || 0) * g;
      }
    }
  }
  // Soft HF tuck of residual wash
  const a = 0.15 * amount;
  let prevL = 0;
  let prevR = 0;
  for (let i = 0; i < out.left.length; i++) {
    const l = out.left[i] || 0;
    const r = out.right[i] || 0;
    const lpL = prevL + a * (l - prevL);
    const lpR = prevR + a * (r - prevR);
    out.left[i] = l * (1 - amount * 0.12) + lpL * (amount * 0.12);
    out.right[i] = r * (1 - amount * 0.12) + lpR * (amount * 0.12);
    prevL = lpL;
    prevR = lpR;
  }
  return out;
}

/**
 * Run the restoration front-end on one raw vocal take.
 */
export function runRestorationFrontEnd(raw: PcmStereo): RestorationFrontEndResult {
  const flags: string[] = [];
  const plain: string[] = [];
  let pcm = cloneStereo(raw);
  const mono0 = stereoToMono(pcm);

  // Detect clipping
  const peak0 = peakOf(mono0);
  if (peak0 > 0.98) flags.push("clipping_detected");

  const noiseBeforeDb = estimateNoiseFloorDb(mono0, pcm.sampleRate);
  if (noiseBeforeDb > -42) flags.push("heavy_room_noise");
  else if (noiseBeforeDb > -52) flags.push("noticeable_noise");

  // ——— 1. Level normalization ———
  const rms0 = rmsOf(mono0);
  const targetRms = 0.12;
  let levelGainDb = 0;
  if (rms0 > 1e-6) {
    levelGainDb = Math.max(-12, Math.min(18, gainToDb(targetRms / rms0)));
    // Don't boost clipped material hard
    if (flags.includes("clipping_detected")) levelGainDb = Math.min(levelGainDb, 3);
    applyGainStereo(pcm, dbToGain(levelGainDb));
  }
  plain.push(`leveled ${levelGainDb >= 0 ? "+" : ""}${levelGainDb.toFixed(1)} dB`);

  // Edge silence / mouth close
  const trimmed = trimVocalSilence(pcm);
  pcm = trimmed.pcm;
  pcm = cleanTakeEdges(pcm, { fadeInMs: 40, fadeOutMs: 80, maxLeadMs: 350, maxTailMs: 400 });

  // Artifact budget: higher noise → allow a bit more NR, but never extreme
  let maxNrDb = 8;
  if (noiseBeforeDb > -40) maxNrDb = 12;
  else if (noiseBeforeDb > -48) maxNrDb = 10;
  else if (noiseBeforeDb < -58) maxNrDb = 5;

  // ——— 2. Noise reduction ———
  const nr = adaptiveNoiseReduce(pcm, noiseBeforeDb, maxNrDb);
  pcm = nr.pcm;
  // Soft gate residual
  gateInPlace(pcm.left, pcm.sampleRate, Math.max(-50, noiseBeforeDb + 6));
  gateInPlace(pcm.right, pcm.sampleRate, Math.max(-50, noiseBeforeDb + 6));
  plain.push(`noise reduced (~${maxNrDb.toFixed(0)} dB ceiling)`);

  // ——— 3. De-reverb (conservative) ———
  let reverbAmount = 0;
  if (noiseBeforeDb > -50 || flags.includes("heavy_room_noise")) {
    reverbAmount = flags.includes("heavy_room_noise") ? 0.35 : 0.22;
  } else {
    reverbAmount = 0.1;
  }
  // Cap by artifact risk later
  pcm = lightDeReverb(pcm, reverbAmount);
  if (reverbAmount > 0.12) plain.push("light room reduction");

  // ——— 4. Clicks / plosives ———
  const mouth = treatMouthNoise({ pcm, role: "lead", intensity: 0.55 });
  pcm = mouth.pcm;
  if (mouth.qc?.applied) {
    plain.push("cleaned plosives/clicks");
  }

  // Measure after
  const mono1 = stereoToMono(pcm);
  const noiseAfterDb = estimateNoiseFloorDb(mono1, pcm.sampleRate);
  const transientScore = transientPreservationScore(mono0, mono1);
  const flatness = spectralFlatnessProxy(mono1, pcm.sampleRate);

  // ——— Quality gate / artifact risk ———
  let artifactRisk = 0;
  artifactRisk += Math.max(0, (maxNrDb - 6) / 20) * 0.35;
  artifactRisk += reverbAmount * 0.4;
  artifactRisk += (1 - transientScore) * 0.35;
  if (flags.includes("clipping_detected")) artifactRisk += 0.15;
  artifactRisk = Math.max(0, Math.min(1, artifactRisk));

  // If risk high, dial back by mixing some raw (safety)
  if (artifactRisk > 0.55) {
    const blend = Math.min(0.4, (artifactRisk - 0.55) * 0.8);
    const rawN = cloneStereo(raw);
    applyGainStereo(rawN, dbToGain(levelGainDb));
    for (let i = 0; i < pcm.left.length; i++) {
      pcm.left[i] = (pcm.left[i] || 0) * (1 - blend) + (rawN.left[i] || 0) * blend;
      pcm.right[i] = (pcm.right[i] || 0) * (1 - blend) + (rawN.right[i] || 0) * blend;
    }
    flags.push("restoration_softened");
    plain.push("restoration softened to protect tone");
    artifactRisk *= 0.75;
  }

  let confidence: RestorationConfidence = "high";
  if (artifactRisk > 0.45 || flags.includes("clipping_detected")) confidence = "medium";
  if (artifactRisk > 0.65 || (flags.includes("heavy_room_noise") && artifactRisk > 0.4)) {
    confidence = "low";
    flags.push("texture_loss_possible");
    plain.push("source was difficult — some texture loss may be audible");
  }

  if (confidence === "high" && flags.includes("heavy_room_noise")) {
    plain.push("significant room noise cleaned");
  }

  const report: RestorationReport = {
    noiseFloorBeforeDb: +noiseBeforeDb.toFixed(1),
    noiseFloorAfterDb: +noiseAfterDb.toFixed(1),
    reverbReductionApplied: +reverbAmount.toFixed(2),
    levelGainDb: +levelGainDb.toFixed(2),
    artifactRiskScore: +artifactRisk.toFixed(3),
    confidence,
    flags,
    plainLanguage: plain,
  };

  return { pcm, report };
}

/** Serialize for layer.restoration / logs */
export function restorationToLog(report: RestorationReport): string[] {
  const lines = [
    `restore: noise ${report.noiseFloorBeforeDb}→${report.noiseFloorAfterDb} dB, risk ${report.artifactRiskScore}, confidence ${report.confidence}`,
    ...report.plainLanguage.map((p) => `restore: ${p}`),
  ];
  if (report.flags.length) lines.push(`restore: flags ${report.flags.join(",")}`);
  return lines;
}
