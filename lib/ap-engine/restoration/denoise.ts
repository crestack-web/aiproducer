import { applyEqChain, gateInPlace, highPassInPlace } from "../dsp";
import type { PcmStereo, VocalDecision } from "../types";
import { cloneStereo } from "../dsp";

/** Phase 1 restoration: HPF + gate — prefer natural over aggressive NR. */
export function restoreVocal(pcm: PcmStereo, decision: VocalDecision): PcmStereo {
  const out = cloneStereo(pcm);
  highPassInPlace(out.left, out.sampleRate, decision.highPassHz);
  highPassInPlace(out.right, out.sampleRate, decision.highPassHz);
  gateInPlace(out.left, out.sampleRate, decision.gateThresholdDb);
  gateInPlace(out.right, out.sampleRate, decision.gateThresholdDb);
  // Gentle corrective low cut if still muddy — already in decision EQ for production stage
  return out;
}
