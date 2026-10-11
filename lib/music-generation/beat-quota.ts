/**
 * Beat generation usage gating (duration-aware).
 * Re-exports core quota + assert helpers.
 */
export {
  FREE_BEAT_GEN_COUNT,
  FREE_MAX_DURATION_SEC,
  FREE_DURATION_OPTIONS_SEC,
  MAX_BEAT_GENS_PER_SONG,
  DEFAULT_FULL_BEAT_SEC,
  elevenLabsMusicUsdPerMin,
  estimateBeatCostUsd,
  estimatedMusicCostUsdPerSec,
  getSubscriberPlanName,
  isPaidBeatSubscriber,
  getBeatGenQuota,
  countSuccessfulBeatGensForProject,
  type BeatQuotaSnapshot,
} from "./beat-quota-core";

export {
  assertBeatGenAllowed,
  recordSongDownloadForBeatUnlock,
} from "./beat-quota-assert";
