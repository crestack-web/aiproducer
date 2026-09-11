import { cloneStereo } from "../dsp";
import type { MixDecision, PcmStereo } from "../types";
import { applyMixGains, duckBeatFromVocal, sumStereo, autoBalanceGains } from "./balance";
import { applyBeatPresenceCut } from "./masking-lite";
import { applyMixGlue } from "./glue";
import { lockVocalToBeat } from "./beat-lock";

/**
 * Mix vocal bus into beat so they feel like one song, not freestyle over a loop.
 * Order: groove lock → spectral carve → pocket balance → mid duck → sum → bus glue.
 */
export function mixVocalAndBeat(
  vocalIn: PcmStereo,
  beatIn: PcmStereo,
  decision: MixDecision
): PcmStereo {
  let vocal = cloneStereo(vocalIn);
  const beat = cloneStereo(beatIn);

  // 0. Micro-align vocal energy to instrumental onsets (keeps natural length)
  const locked = lockVocalToBeat(vocal, beat, 32);
  vocal = locked.pcm;

  // 1. Carve frequency space in the beat under the voice
  applyBeatPresenceCut(beat, decision);

  // 2. Pocket balance — vocal slightly inside the beat, not on top
  // Target ratio ~0.72 (was 0.88 → felt separated / freestyle-loud)
  const balanced = autoBalanceGains(vocal, beat, decision, 0.72);
  const liveDecision: MixDecision = {
    ...decision,
    vocalGainDb: balanced.vocalGainDb,
    beatGainDb: balanced.beatGainDb,
  };
  applyMixGains(vocal, beat, liveDecision);

  // 3. Stronger mid-focused duck so the beat yields to the vocal in the pocket
  const duck = Math.max(decision.duckDb, 1.6);
  duckBeatFromVocal(vocal, beat, duck, decision.duckMidFocus ?? 0.78);

  // 4. Sum
  let mix = sumStereo(vocal, beat);

  // 5. Bus glue: parallel compress + center mid + shared short room
  mix = applyMixGlue(mix, { parallel: 0.4, room: 0.12, center: 0.25 });

  return mix;
}
