/**
 * Try It — feature flag + isolation constants.
 * Independent of Record / Booth / Console pipelines.
 */

export function isTryItEnabled(): boolean {
  const v = (process.env.TRY_IT_ENABLED || process.env.NEXT_PUBLIC_TRY_IT_ENABLED || "").trim();
  if (v === "0" || v.toLowerCase() === "false" || v.toLowerCase() === "off") return false;
  // Default on when ElevenLabs key exists; explicit TRY_IT_ENABLED=0 disables
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
export const TRY_IT_PREVIEW_BEAT_SEC = 32;
export const TRY_IT_SOURCE_META = "try_it_preview" as const;

export function tryItStoragePrefix(userId: string, sessionId: string) {
  return `users/${userId}/try-it/${sessionId}`;
}
