/**
 * Translation QC — does the vocal survive phone / mono / quiet playback?
 * Pure TS approximations of consumer playback paths.
 */
import {
  applyBiquadInPlace,
  cloneStereo,
  peakOf,
  rmsOf,
  stereoToMono,
  applyGainStereo,
  dbToGain,
} from "../dsp";
import type { PcmStereo } from "../types";

export type TranslationResult = {
  monoOk: boolean;
  phoneOk: boolean;
  quietOk: boolean;
  monoPresence: number;
  phonePresence: number;
  quietPresence: number;
  warnings: string[];
  /** Suggested master presence boost dB if phone path loses vocal */
  presenceBoostDb: number;
};

function presenceEnergy(mono: Float32Array, sr: number): number {
  const tmp = new Float32Array(mono);
  applyBiquadInPlace(tmp, "peak", 2800, sr, 6, 1.0);
  return rmsOf(tmp);
}

function simPhone(pcm: PcmStereo): PcmStereo {
  const out = cloneStereo(pcm);
  // Tiny speaker: lose sub + extreme air, boost upper mids slightly
  applyBiquadInPlace(out.left, "highpass", 350, out.sampleRate, 0, 0.7);
  applyBiquadInPlace(out.right, "highpass", 350, out.sampleRate, 0, 0.7);
  applyBiquadInPlace(out.left, "lowpass", 5500, out.sampleRate, 0, 0.7);
  applyBiquadInPlace(out.right, "lowpass", 5500, out.sampleRate, 0, 0.7);
  applyBiquadInPlace(out.left, "peak", 2500, out.sampleRate, 2.5, 1.0);
  applyBiquadInPlace(out.right, "peak", 2500, out.sampleRate, 2.5, 1.0);
  return out;
}

function simMono(pcm: PcmStereo): PcmStereo {
  const mono = stereoToMono(pcm);
  const out = cloneStereo(pcm);
  out.left.set(mono);
  out.right.set(mono);
  return out;
}

export function runTranslationQc(master: PcmStereo): TranslationResult {
  const sr = master.sampleRate;
  const full = stereoToMono(master);
  const fullPres = presenceEnergy(full, sr);
  const fullRms = rmsOf(full) + 1e-12;

  const mono = simMono(master);
  const phone = simPhone(master);
  const quiet = cloneStereo(master);
  applyGainStereo(quiet, dbToGain(-14));

  const monoPres = presenceEnergy(stereoToMono(mono), sr) / fullRms;
  const phonePres = presenceEnergy(stereoToMono(phone), sr) / fullRms;
  const quietPres = presenceEnergy(stereoToMono(quiet), sr) / fullRms;

  const warnings: string[] = [];
  const monoOk = monoPres > 0.15;
  const phoneOk = phonePres > 0.12;
  const quietOk = quietPres > 0.04;

  if (!monoOk) warnings.push("vocal_weak_in_mono");
  if (!phoneOk) warnings.push("vocal_weak_on_phone");
  if (!quietOk) warnings.push("vocal_disappears_quiet");

  // Collapse check: mono peak much lower than stereo → phase issues
  const stereoPeak = Math.max(peakOf(master.left), peakOf(master.right));
  const monoPeak = peakOf(stereoToMono(mono));
  if (stereoPeak > 1e-6 && monoPeak / stereoPeak < 0.45) {
    warnings.push("stereo_phase_collapse");
  }

  let presenceBoostDb = 0;
  if (!phoneOk) presenceBoostDb = 1.8;
  else if (phonePres < 0.18) presenceBoostDb = 1.0;

  return {
    monoOk,
    phoneOk,
    quietOk,
    monoPresence: monoPres,
    phonePresence: phonePres,
    quietPresence: quietPres,
    warnings,
    presenceBoostDb,
  };
}

/** Apply a mild presence lift for phone translation without harshness. */
export function applyTranslationFix(master: PcmStereo, boostDb: number): PcmStereo {
  if (boostDb < 0.3) return master;
  const out = cloneStereo(master);
  const g = Math.min(2.5, boostDb);
  applyBiquadInPlace(out.left, "peak", 2800, out.sampleRate, g, 1.0);
  applyBiquadInPlace(out.right, "peak", 2800, out.sampleRate, g, 1.0);
  return out;
}
