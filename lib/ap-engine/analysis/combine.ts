import type { BeatAnalysis, CombinedAnalysis, VocalAnalysis } from "../types";

export function combineAnalysis(vocal: VocalAnalysis, beat: BeatAnalysis): CombinedAnalysis {
  return { vocal, beat };
}
