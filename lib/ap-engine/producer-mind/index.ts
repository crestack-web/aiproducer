export type {
  DecisionMap,
  PhraseDecision,
  SectionDecision,
  SongRead,
  EmotionalWeight,
  PhraseInstructions,
  ProducerMindInput,
} from "./types";
export { buildDecisionMap, type LayerAudio } from "./build-map";
export { readSongLevel } from "./song-read";
export { readSectionLevel } from "./section-read";
export { readPhraseLevel } from "./phrase-read";
export { applyPhraseFaderRides, phraseInfluenceForLayer } from "./apply-map";

export { decidePitchTimingForPhrase, aggregatePitchTiming } from "./pitch-timing";
export type { PitchTimingDecision, CorrectionAmount } from "./pitch-timing";

export { decideCreativeFxForPhrase, enforceCreativeFxDensity } from "./creative-fx";
