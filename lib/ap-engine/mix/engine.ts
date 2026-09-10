import { cloneStereo } from "../dsp";
import type { MixDecision, PcmStereo } from "../types";
import { applyMixGains, duckBeatFromVocal, sumStereo } from "./balance";
import { applyBeatPresenceCut } from "./masking-lite";

export function mixVocalAndBeat(
  vocalIn: PcmStereo,
  beatIn: PcmStereo,
  decision: MixDecision
): PcmStereo {
  const vocal = cloneStereo(vocalIn);
  const beat = cloneStereo(beatIn);
  applyBeatPresenceCut(beat, decision);
  applyMixGains(vocal, beat, decision);
  duckBeatFromVocal(vocal, beat, decision.duckDb);
  return sumStereo(vocal, beat);
}
