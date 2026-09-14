/**
 * Restoration Front-End — first stage on raw phone/bedroom vocals.
 * Order: level → noise → de-reverb → clicks/plosives → confidence gate.
 * Never maxes out processing; artifact_risk caps how hard we push.
 * Intentional silence, hum, and breaths are preserved (no lead/tail zeroing).
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
  let low = 0;
  let high = 0;
  let n = 0;
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
  return Math.max(0, Math.min(1, ratio));
}

function adaptiveNoiseReduce(
  pcm: PcmStereo,
  noiseBeforeDb: number,
  maxNrDb: number
): { pcm: PcmStereo } {
  // Spectral-ish soft expand against noise floor (gentle)
  const out = cloneStereo(pcm);
  const mono = stereoToMono(out);
  const thr = Math.pow(10, noiseBeforeDb / 20) * 1.8;
  const strength = Math.min(0.85, maxNrDb / 14);
  for (let i = 0; i < mono.length; i++) {
    const a = Math.abs(mono[i] || 0);
    if (a < thr) {
      const g = 1 - strength * (1 - a / Math.max(thr, 1e-9));
      out.left[i] = (out.left[i] || 0) * g;
      out.right[i] = (out.right[i] || 0) * g;
    }
  }
  return { pcm: out };
}

function lightDeReverb(pcm: PcmStereo, amount: number): PcmStereo {
  if (amount <= 0.01) return pcm;
  const out = cloneStereo(pcm);
  const mono = stereoToMono(out);
  // Mild high-shelf cut + soft mid suppress on low-energy frames
  const sr = out.sampleRate;
  highPassInPlace(out.left, sr, 60);
  highPassInPlace(out.right, sr, 60);
  const frame = Math.max(64, Math.floor(sr * 0.01));
  for (let i = 0; i + frame < mono.length; i += frame) {
    let e = 0;
    for (let j = 0; j < frame; j++) e += (mono[i + j] || 0) ** 2;
    e = Math.sqrt(e / frame);
    if (e < 0.04) {
      const g = 1 - amount * 0.35;
      for (let j = 0; j < frame; j++) {
        out.left[i + j] = (out.left[i + j] || 0) * g;
        out.right[i + j] = (out.right[i + j] || 0) * g;
      }
    }
  }
  return out;
}

export function runRestorationFrontEnd(raw: PcmStereo): RestorationFrontEndResult {
  const flags: string[] = [];
  const plain: string[] = [];
  let pcm = cloneStereo(raw);
  const mono0 = stereoToMono(pcm);

  const peak0 = peakOf(mono0);
  if (peak0 > 0.98) flags.push("clipping_detected");

  const noiseBeforeDb = estimateNoiseFloorDb(mono0, pcm.sampleRate);
  if (noiseBeforeDb > -42) flags.push("heavy_room_noise");
  else if (noiseBeforeDb > -52) flags.push("noticeable_noise");

  const rms0 = rmsOf(mono0);
  const targetRms = 0.12;
  let levelGainDb = 0;
  if (rms0 > 1e-6) {
    levelGainDb = Math.max(-12, Math.min(18, gainToDb(targetRms / rms0)));
    if (flags.includes("clipping_detected")) levelGainDb = Math.min(levelGainDb, 3);
    applyGainStereo(pcm, dbToGain(levelGainDb));
  }
  plain.push(`leveled ${levelGainDb >= 0 ? "+" : ""}${levelGainDb.toFixed(1)} dB`);

  // Preserve intentional silence / hum / breaths — no content trim or musical fades.
  const trimmed = trimVocalSilence(pcm);
  pcm = trimmed.pcm;
  flags.push("space_preserved");

  let maxNrDb = 8;
  if (noiseBeforeDb > -40) maxNrDb = 12;
  else if (noiseBeforeDb > -48) maxNrDb = 10;
  else if (noiseBeforeDb < -58) maxNrDb = 5;

  const nr = adaptiveNoiseReduce(pcm, noiseBeforeDb, maxNrDb);
  pcm = nr.pcm;
  const gateDb = Math.min(-58, noiseBeforeDb - 4);
  gateInPlace(pcm.left, pcm.sampleRate, gateDb);
  gateInPlace(pcm.right, pcm.sampleRate, gateDb);
  plain.push(`noise reduced (~${maxNrDb.toFixed(0)} dB ceiling); space preserved`);

  let reverbAmount = 0;
  if (noiseBeforeDb > -50 || flags.includes("heavy_room_noise")) {
    reverbAmount = flags.includes("heavy_room_noise") ? 0.35 : 0.22;
  } else {
    reverbAmount = 0.1;
  }
  pcm = lightDeReverb(pcm, reverbAmount);
  if (reverbAmount > 0.12) plain.push("light room reduction");

  const mouth = treatMouthNoise({ pcm, role: "lead", intensity: 0.55 });
  pcm = mouth.pcm;
  if (mouth.qc?.applied) {
    plain.push("cleaned plosives/clicks");
  }

  const mono1 = stereoToMono(pcm);
  const noiseAfterDb = estimateNoiseFloorDb(mono1, pcm.sampleRate);
  const transientScore = transientPreservationScore(mono0, mono1);

  let artifactRisk = 0;
  artifactRisk += Math.max(0, (maxNrDb - 6) / 20) * 0.35;
  artifactRisk += reverbAmount * 0.4;
  artifactRisk += (1 - transientScore) * 0.35;
  if (flags.includes("clipping_detected")) artifactRisk += 0.15;
  artifactRisk = Math.max(0, Math.min(1, artifactRisk));

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
