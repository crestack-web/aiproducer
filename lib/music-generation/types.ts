/**
 * Provider-agnostic music generation types.
 * AI Producer and RoEx pipeline only depend on these — never on Replicate shapes.
 */

export type MusicGenerationMode = "mock" | "provider";

export type MusicProviderName = "replicate" | "elevenlabs" | "mock" | "mureka" | "future_provider";

export type MusicJobKind = "preview" | "full" | "section_edit" | "instrumental" | "around_vocal" | "add_instrument";

export type GenerationKind = "preview" | "full";

export type MusicJobStatus =
  | "CREATED"
  | "SUBMITTING"
  | "GENERATING"
  | "DOWNLOADING"
  | "PROCESSING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export type MusicErrorType =
  | "AUTHENTICATION_ERROR"
  | "BILLING_REQUIRED"
  | "RATE_LIMITED"
  | "MODEL_UNAVAILABLE"
  | "INVALID_INPUT"
  | "TIMEOUT"
  | "PROVIDER_ERROR"
  | "DOWNLOAD_ERROR"
  | "AUDIO_VALIDATION_ERROR"
  | "NOT_CONFIGURED"
  | "LIMIT_EXCEEDED"
  | "UNAUTHORIZED"
  | "NOT_FOUND";

export type MusicGenerationRequest = {
  projectId: string;
  userId: string;
  prompt?: string;
  genre?: string;
  mood?: string;
  bpm?: number;
  key?: string;
  durationSec?: number;
  /** User accepted paid beat (cost on song download) */
  forceBillable?: boolean;
  /** Internal: 0 or 1 for A/B beat pair */
  variantIndex?: number;
  /** Skip quota when enqueueing variant B of the same user action */
  skipQuotaCheck?: boolean;
  /** Section label for AI tweak of existing beat */
  editSection?: string;
  instrumentalOnly?: boolean;
  energy?: string;
  structure?: string;
  /** e.g. heavy bass, 808-driven, acoustic guitar-led */
  instrumentation?: string;
  /** Artist / track feel reference (style matching, not cloning) */
  referenceStyle?: string;
  kind?: GenerationKind;
  referenceAudioUrl?: string;
  idempotencyKey?: string;
  providerOptions?: Record<string, unknown>;
};

export type MusicGenerationPlan = {
  shouldGenerate: boolean;
  instrumentalOnly: boolean;
  genre?: string;
  mood?: string;
  bpm?: number;
  key?: string;
  durationSec?: number;
  kind?: GenerationKind;
  prompt: string;
  reason?: string;
  energy?: string;
  structure?: string;
  instrumentation?: string;
  referenceStyle?: string;
};

export type GeneratedMusicAsset = {
  assetId: string;
  projectId: string;
  type: "INSTRUMENTAL";
  audioPath: string;
  durationMs: number | null;
  provider: MusicProviderName;
  model?: string;
  status: "COMPLETED";
  kind: GenerationKind;
  metadata?: Record<string, unknown>;
};

export type ProviderSubmitResult = {
  providerPredictionId: string;
  status: "starting" | "processing" | "succeeded" | "failed" | "canceled";
  model?: string;
  metadata?: Record<string, unknown>;
  raw?: Record<string, unknown>;
};

export type ProviderPollResult = {
  status: "starting" | "processing" | "succeeded" | "failed" | "canceled";
  outputUrl?: string | null;
  error?: string | null;
  metrics?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  raw?: Record<string, unknown>;
};

export type ProviderGenerateResult = {
  buffer: Buffer;
  contentType: string;
  extension: string;
  durationSec: number;
  providerPredictionId: string;
  model: string;
  outputUrl?: string;
  metadata?: Record<string, unknown>;
};

export class MusicGenerationError extends Error {
  readonly errorType: MusicErrorType;
  readonly retryable: boolean;
  readonly provider?: MusicProviderName;
  readonly details?: Record<string, unknown>;

  constructor(
    errorType: MusicErrorType,
    message: string,
    opts?: {
      retryable?: boolean;
      provider?: MusicProviderName;
      details?: Record<string, unknown>;
      cause?: unknown;
    }
  ) {
    super(message);
    this.name = "MusicGenerationError";
    this.errorType = errorType;
    this.retryable = opts?.retryable ?? false;
    this.provider = opts?.provider;
    this.details = opts?.details;
  }
}

/**
 * User-facing music errors — never name third-party vendors (ElevenLabs, Mureka, etc.).
 * Internal MusicGenerationError.message may still include provider detail for server logs.
 */
export function publicErrorMessage(errorType: MusicErrorType): string {
  switch (errorType) {
    case "BILLING_REQUIRED":
      return "Music generation is temporarily unavailable. Please try again later.";
    case "AUTHENTICATION_ERROR":
      return "Music generation is temporarily unavailable. Please try again later.";
    case "RATE_LIMITED":
      return "Music generation is busy right now. Please try again in a moment.";
    case "MODEL_UNAVAILABLE":
      return "Music generation is temporarily unavailable. Please try again later.";
    case "INVALID_INPUT":
      return "Invalid music generation request.";
    case "TIMEOUT":
      return "Music generation timed out. Please try again.";
    case "DOWNLOAD_ERROR":
      return "Generated audio could not be retrieved. Please try again.";
    case "AUDIO_VALIDATION_ERROR":
      return "Generated audio failed validation. Please try again.";
    case "NOT_CONFIGURED":
      return "Music generation is not available right now.";
    case "LIMIT_EXCEEDED":
      return "Daily music generation limit reached. Try again tomorrow.";
    case "UNAUTHORIZED":
      return "Unauthorized.";
    case "NOT_FOUND":
      return "Generation job not found.";
    default:
      return "Music generation failed. Please try again.";
  }
}

/** Strip vendor / infrastructure names from any string before showing to users. */

/** User-facing copy for beat quota limit codes (no vendor names). */
export function publicBeatLimitMessage(
  code: string | undefined,
  opts?: { freeMaxSec?: number; estimatedCostUsd?: number }
): string {
  const maxSec = opts?.freeMaxSec ?? 90;
  const cost =
    typeof opts?.estimatedCostUsd === "number"
      ? `≈ $${opts.estimatedCostUsd.toFixed(2)}`
      : null;
  switch (code) {
    case "FREE_DURATION_EXCEEDED":
      return (
        `Free beats are limited to ${maxSec}s. Choose ${maxSec}s or shorter, or continue with a paid beat` +
        (cost ? ` (${cost}).` : ".")
      );
    case "FREE_COUNT_EXCEEDED":
    case "SEQUENTIAL_FREE_BLOCKED":
      return (
        "You've used your free beats. Finish a song, subscribe, or continue with a paid beat" +
        (cost ? ` (${cost}).` : ".")
      );
    case "BEAT_GEN_IN_FLIGHT":
      return "A beat is already generating. Wait for it to finish, then try again.";
    case "PER_SONG_BEAT_GEN_LIMIT":
      return "This song already has the maximum number of generated beats. Upload a beat or start a new song.";
    case "PAID_SECONDS_EXCEEDED":
      return "Your monthly beat budget is used up. Upgrade your plan or try again next month.";
    default:
      return publicErrorMessage("LIMIT_EXCEEDED");
  }
}

export function sanitizeClientErrorMessage(raw: string | null | undefined, fallback?: string): string {
  const fb = fallback || "Something went wrong. Please try again.";
  if (!raw || typeof raw !== "string") return fb;
  let s = raw.trim();
  if (!s) return fb;
  // Known third-party / infra tokens — never show in the product UI
  const banned =
    /\b(elevenlabs?|mureka|replicate|openai|anthropic|stability|suno|udio|roex|cloudflare|vercel|supabase|r2|s3|aws)\b/gi;
  if (banned.test(s)) {
    // Prefer typed public message patterns if recognizable
    if (/rate\s*limit/i.test(s)) return publicErrorMessage("RATE_LIMITED");
    if (/auth|api\s*key|401|403|permission/i.test(s)) return publicErrorMessage("AUTHENTICATION_ERROR");
    if (/credit|billing|quota|payment/i.test(s)) return publicErrorMessage("BILLING_REQUIRED");
    if (/timeout|timed\s*out/i.test(s)) return publicErrorMessage("TIMEOUT");
    return fb;
  }
  return s;
}
