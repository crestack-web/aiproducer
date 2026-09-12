export type { FullnessDecision, GeneratedLayer, HarmonyInterval } from "./types";
export { decideFullnessForPhrase } from "./decide";
export { estimateKeyFromBeat, type KeyEstimate } from "./key-detect";
export {
  generateDouble,
  generateHarmony,
  generateAdlibEcho,
  generateFromDecision,
} from "./generate";
