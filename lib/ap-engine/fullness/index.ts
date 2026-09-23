export type { FullnessDecision, GeneratedLayer, HarmonyInterval } from "./types";
export { decideFullnessForPhrase } from "./decide";
export { estimateKeyFromBeat, type KeyEstimate } from "./key-detect";
export {
  generateDouble,
  generateHarmony,
  generateAdlibEcho,
  generateFromDecision,
  generateChoir,
  generateStack,
  assignStackGainsDb,
  fullnessModeForSection,
} from "./generate";
export type { StackMode, ChoirVoice } from "./generate";
