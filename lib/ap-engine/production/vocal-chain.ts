import {
  addDelayStereo,
  addReverbStereo,
  applyEqStereo,
  applyGainStereo,
  cloneStereo,
  compressStereo,
  dbToGain,
  deEssInPlace,
  saturateInPlace,
} from "../dsp";
import type { PcmStereo, VocalDecision } from "../types";

export function processVocalChain(pcm: PcmStereo, decision: VocalDecision): PcmStereo {
  const out = cloneStereo(pcm);
  applyEqStereo(out, decision.eq);
  compressStereo(out, decision.compressor);
  deEssInPlace(out.left, out.sampleRate, decision.deEsserAmount);
  deEssInPlace(out.right, out.sampleRate, decision.deEsserAmount);
  saturateInPlace(out.left, decision.saturation);
  saturateInPlace(out.right, decision.saturation);
  applyGainStereo(out, dbToGain(decision.gainDb));
  addReverbStereo(out, decision.reverbSend);
  addDelayStereo(out, decision.delaySend);
  return out;
}
