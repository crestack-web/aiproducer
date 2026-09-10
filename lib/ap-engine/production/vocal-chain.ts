import {
  addDelayStereo,
  addReverbStereo,
  applyEqStereo,
  applyGainStereo,
  cloneStereo,
  compressStereo,
  dbToGain,
  saturateInPlace,
} from "../dsp";
import type { PcmStereo, VocalDecision } from "../types";
import type { VocalRole } from "../roles";
import { smartDeess, type SmartDeessQC } from "../restoration/smart-deess";

export type VocalChainResult = {
  pcm: PcmStereo;
  deessQc: SmartDeessQC | null;
};

export function processVocalChain(
  pcm: PcmStereo,
  decision: VocalDecision,
  role?: VocalRole
): PcmStereo {
  return processVocalChainDetailed(pcm, decision, role).pcm;
}

export function processVocalChainDetailed(
  pcm: PcmStereo,
  decision: VocalDecision,
  role?: VocalRole
): VocalChainResult {
  const out = cloneStereo(pcm);
  applyEqStereo(out, decision.eq);
  compressStereo(out, decision.compressor);

  // Adaptive de-ess replaces fixed-amount deEssInPlace
  let deessQc: SmartDeessQC | null = null;
  try {
    const de = smartDeess({
      pcm: out,
      role: role || "lead",
      amount: decision.deEsserAmount,
    });
    if (de.qc.applied) {
      out.left.set(de.pcm.left);
      out.right.set(de.pcm.right);
    }
    deessQc = de.qc;
  } catch {
    deessQc = null;
  }

  saturateInPlace(out.left, decision.saturation);
  saturateInPlace(out.right, decision.saturation);
  applyGainStereo(out, dbToGain(decision.gainDb));
  addReverbStereo(out, decision.reverbSend);
  addDelayStereo(out, decision.delaySend);
  return { pcm: out, deessQc };
}
