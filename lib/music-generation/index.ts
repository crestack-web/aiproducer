export * from "./types";
export * from "./provider";
export {
  enqueueMusicGeneration,
  tickMusicGenerationJob,
  getMusicGenerationJob,
  createMusicGenerationPlan,
  getMusicGenerationMode,
  getMusicProvider,
  publicErrorMessage,
  MusicGenerationError,
} from "./service";
export {
  getBeatGenQuota,
  assertBeatGenAllowed,
  recordSongDownloadForBeatUnlock,
  isPaidBeatSubscriber,
  estimateBeatCostUsd,
  estimatedMusicCostUsdPerSec,
  FREE_BEAT_GEN_COUNT,
  FREE_MAX_DURATION_SEC,
  DEFAULT_FULL_BEAT_SEC,
} from "./beat-quota";
export type { BeatQuotaSnapshot } from "./beat-quota";
export { ReplicateMusicProvider } from "./replicate-provider";
export { ElevenLabsMusicProvider, buildElevenLabsCompositionPlan } from "./elevenlabs-provider";
export { MockMusicProvider } from "./mock-provider";
