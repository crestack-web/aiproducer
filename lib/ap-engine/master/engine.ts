import {
  applyEqStereo,
  applyGainStereo,
  cloneStereo,
  compressStereo,
  dbToGain,
  limitStereo,
} from "../dsp";
import type { MasterDecision, PcmStereo } from "../types";
import { normalizeRmsProxy } from "./loudness";

export function masterMix(pcm: PcmStereo, decision: MasterDecision): PcmStereo {
  const out = cloneStereo(pcm);
  applyEqStereo(out, decision.eq);
  if (decision.compressor) compressStereo(out, decision.compressor);
  // Map target LUFS-ish to RMS proxy (~ -1 LUFS ≈ rough for speech/music hybrid)
  const targetRmsDb = decision.targetLufs + 3;
  normalizeRmsProxy(out, targetRmsDb);
  applyGainStereo(out, dbToGain(decision.makeupDb));
  limitStereo(out, decision.limiterCeilingDb);
  return out;
}
