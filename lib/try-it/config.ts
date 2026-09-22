/**
 * Try It — feature flag + hard cost-control constants.
 * Independent of Record / Booth / Console pipelines.
 */

export function isTryItEnabled(): boolean {
  const v = (process.env.TRY_IT_ENABLED || process.env.NEXT_PUBLIC_TRY_IT_ENABLED || "").trim();
  if (v === "0" || v.toLowerCase() === "false" || v.toLowerCase() === "off") return false;
  if (v === "1" || v.toLowerCase() === "true" || v.toLowerCase() === "on") return true;
  return Boolean(
    process.env.ELEVENLABS_API_KEY?.trim() ||
      process.env.ELEVEN_API_KEY?.trim() ||
      process.env.XI_API_KEY?.trim()
  );
}

export const TRY_IT_SCOPE = "trial" as const;
export const TRY_IT_TTL_HOURS = 48;
export const TRY_IT_MIN_SAMPLE_MS = 10_000;
export const TRY_IT_MAX_SAMPLE_MS = 120_000;

/** Hard cap: preview is a demo taste only (15–20s). Server enforces max. */
export const TRY_IT_PREVIEW_BEAT_SEC = 18;
export const TRY_IT_PREVIEW_MAX_SEC = 20;
export const TRY_IT_PREVIEW_MIN_SEC = 15;

/**
 * Per-account lifetime generate limit (not rolling).
 * Free top-of-funnel — convert to Record, do not monetize more previews.
 */
export const TRY_IT_MAX_GENERATES_PER_USER = 2;

/** One automatic retry on hard failure only — no speculative/background calls. */
export const TRY_IT_MAX_PROVIDER_RETRIES = 1;

/**
 * Lowest-cost / low-latency TTS tier for Try It only.
 * Never used by core Record / melody-guide (those keep product defaults).
 * eleven_flash_v2_5 is ElevenLabs Flash; fallback chain if unavailable.
 */
export const TRY_IT_TTS_MODEL =
  process.env.TRY_IT_ELEVENLABS_TTS_MODEL?.trim() || "eleven_flash_v2_5";

export const TRY_IT_TTS_MODEL_FALLBACKS = [
  "eleven_flash_v2_5",
  "eleven_turbo_v2_5",
  "eleven_turbo_v2",
  "eleven_flash_v2",
] as const;

export const TRY_IT_SOURCE_META = "try_it_preview" as const;

export function tryItStoragePrefix(userId: string, sessionId: string) {
  return `users/${userId}/try-it/${sessionId}`;
}
