import {
  applyEqStereo,
  applyGainStereo,
  cloneStereo,
  compressStereo,
  dbToGain,
} from "../dsp";
import type { MasterDecision, PcmStereo } from "../types";
import {
  normalizeToStreamingTarget,
  truePeakLimit,
  estimateLoudnessProxyDb,
} from "./loudness";

export function masterMix(pcm: PcmStereo, decision: MasterDecision): PcmStereo {
  const out = cloneStereo(pcm);
  applyEqStereo(out, decision.eq);
  if (decision.compressor) compressStereo(out, decision.compressor);

  // Light pre-makeup so the multi-pass targeter has signal to work with
  if (decision.makeupDb && Math.abs(decision.makeupDb) > 0.05) {
    applyGainStereo(out, dbToGain(decision.makeupDb));
  }

  // Streaming competitive loudness (−12 to −14 LUFS family) with true-peak safety
  const target = decision.targetLufs ?? -13;
  const ceiling = decision.limiterCeilingDb ?? -1.0;
  const margin = decision.truePeakMarginDb ?? 0.35;
  const ln = normalizeToStreamingTarget(out, target, ceiling, margin);

  if (typeof console !== "undefined") {
    console.log(
      `[ap-master] loudness ${ln.beforeDb.toFixed(1)}→${ln.afterDb.toFixed(1)} dB ` +
        `(target~${ln.targetDb.toFixed(1)}, passes=${ln.passes}, gain=${ln.totalGainDb.toFixed(1)}dB)`
    );
  }

  // Belt-and-suspenders ceiling
  truePeakLimit(out, ceiling, margin);

  return out;
}

export { estimateLoudnessProxyDb };
