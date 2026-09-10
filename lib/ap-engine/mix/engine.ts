import { cloneStereo } from "../dsp";
import type { MixDecision, PcmStereo } from "../types";
import { applyMixGains, duckBeatFromVocal, sumStereo, autoBalanceGains } from "./balance";
import { applyBeatPresenceCut } from "./masking-lite";

export function mixVocalAndBeat(
  vocalIn: PcmStereo,
  beatIn: PcmStereo,
  decision: MixDecision
): PcmStereo {
  const vocal = cloneStereo(vocalIn);
  const beat = cloneStereo(beatIn);

  applyBeatPresenceCut(beat, decision);

  const balanced = autoBalanceGains(vocal, beat, decision, 0.88);
  const liveDecision: MixDecision = {
    ...decision,
    vocalGainDb: balanced.vocalGainDb,
    beatGainDb: balanced.beatGainDb,
  };
  applyMixGains(vocal, beat, liveDecision);

  duckBeatFromVocal(vocal, beat, decision.duckDb, decision.duckMidFocus ?? 0.7);

  return sumStereo(vocal, beat);
}
