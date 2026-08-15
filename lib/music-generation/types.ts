/**
 * Provider-agnostic music generation types.
 * AI Producer and RoEx pipeline only depend on these — never on Replicate shapes.
 */

export type MusicGenerationMode = "mock" | "provider";

export type MusicProviderName = "replicate" | "elevenlabs" | "mock" | "future_provider";

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
  instrumentalOnly?: boolean;
  energy?: string;
  structure?: string;
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
  raw?: Record<string, unknown>;
};

export type ProviderPollResult = {
  status: "starting" | "processing" | "succeeded" | "failed" | "canceled";
  outputUrl?: string | null;
  error?: string | null;
  metrics?: Record<string, unknown>;
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

export function publicErrorMessage(errorType: MusicErrorType): string {
  switch (errorType) {
    case "BILLING_REQUIRED":
      return "Music generation is temporarily unavailable because the configured AI music provider has no available generation credit.";
    case "AUTHENTICATION_ERROR":
      return "Music generation provider authentication failed. Please contact support.";
    case "RATE_LIMITED":
      return "Music generation is busy right now. Please try again in a moment.";
    case "MODEL_UNAVAILABLE":
      return "The music generation model is temporarily unavailable.";
    case "INVALID_INPUT":
      return "Invalid music generation request.";
    case "TIMEOUT":
      return "Music generation timed out. Please try again.";
    case "DOWNLOAD_ERROR":
      return "Generated audio could not be retrieved.";
    case "AUDIO_VALIDATION_ERROR":
      return "Generated audio failed validation.";
    case "NOT_CONFIGURED":
      return "Music generation is not configured.";
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
