import {
  applyEqStereo,
  applyGainStereo,
  cloneStereo,
  compressStereo,
  dbToGain,
} from "../dsp";
import type { MasterDecision, PcmStereo } from "../types";
import { normalizeRmsProxy, truePeakLimit, estimateLoudnessProxyDb } from "./loudness";

export function masterMix(pcm: PcmStereo, decision: MasterDecision): PcmStereo {
  const out = cloneStereo(pcm);
  applyEqStereo(out, decision.eq);
  if (decision.compressor) compressStereo(out, decision.compressor);

  // Streaming-ish target: profile LUFS mapped to RMS proxy
  const targetRmsDb = decision.targetLufs + 2.5;
  normalizeRmsProxy(out, targetRmsDb);
  applyGainStereo(out, dbToGain(decision.makeupDb));

  const margin = decision.truePeakMarginDb ?? 0.5;
  truePeakLimit(out, decision.limiterCeilingDb, margin);

  return out;
}

export { estimateLoudnessProxyDb };
