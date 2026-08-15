import type { MusicGenerationProvider } from "./provider";
import type {
  MusicGenerationRequest,
  ProviderGenerateResult,
  ProviderPollResult,
  ProviderSubmitResult,
} from "./types";
import { MusicGenerationError } from "./types";

const BASE = "https://api.replicate.com/v1";
const DEFAULT_VERSION =
  "671ac645ce5e552cc63a54a2bbff63fcf798043055d2dac5fc9e36a837eedcfb";

function token(): string {
  const t = process.env.REPLICATE_API_TOKEN;
  if (!t) {
    throw new MusicGenerationError("NOT_CONFIGURED", "REPLICATE_API_TOKEN is not configured", {
      provider: "replicate",
    });
  }
  return t;
}

function headers(): HeadersInit {
  return { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" };
}

function versionId(): string {
  const raw =
    process.env.REPLICATE_MUSIC_MODEL_VERSION || process.env.REPLICATE_MUSIC_MODEL || DEFAULT_VERSION;
  if (raw.includes(":")) return raw.split(":").pop()!;
  return raw.includes("/") ? DEFAULT_VERSION : raw;
}

function modelVersionParam(): string {
  return process.env.REPLICATE_MUSICGEN_MODEL_VERSION || "stereo-large";
}

function classifyHttpError(status: number, body: string): MusicGenerationError {
  const lower = body.toLowerCase();
  if (status === 401 || status === 403) {
    return new MusicGenerationError("AUTHENTICATION_ERROR", "Replicate authentication failed", {
      provider: "replicate",
      retryable: false,
      details: { httpStatus: status },
    });
  }
  if (
    status === 402 ||
    lower.includes("insufficient credit") ||
    lower.includes("purchase credit") ||
    lower.includes("billing") ||
    lower.includes("no credit")
  ) {
    return new MusicGenerationError("BILLING_REQUIRED", "Replicate account has insufficient generation credit", {
      provider: "replicate",
      retryable: false,
      details: { httpStatus: status },
    });
  }
  if (status === 429 || lower.includes("throttled") || lower.includes("rate limit")) {
    return new MusicGenerationError("RATE_LIMITED", "Replicate rate limit exceeded", {
      provider: "replicate",
      retryable: true,
      details: { httpStatus: status },
    });
  }
  if (status === 404) {
    return new MusicGenerationError("MODEL_UNAVAILABLE", "Replicate model or prediction not found", {
      provider: "replicate",
      retryable: false,
      details: { httpStatus: status },
    });
  }
  if (status >= 500) {
    return new MusicGenerationError("PROVIDER_ERROR", "Replicate server error", {
      provider: "replicate",
      retryable: true,
      details: { httpStatus: status },
    });
  }
  return new MusicGenerationError("PROVIDER_ERROR", "Replicate request failed", {
    provider: "replicate",
    retryable: false,
    details: { httpStatus: status },
  });
}

async function readErrorBody(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as { detail?: string; error?: string; title?: string };
    return j.detail || j.error || j.title || res.statusText;
  } catch {
    return res.statusText;
  }
}

export class ReplicateMusicProvider implements MusicGenerationProvider {
  readonly name = "replicate" as const;

  maxDurationSec(kind: "preview" | "full"): number {
    if (kind === "preview") return Number(process.env.MUSIC_PREVIEW_DURATION_SEC || 8);
    return Number(process.env.MUSIC_FULL_DURATION_SEC || 24);
  }

  async checkAvailability(): Promise<void> {
    const res = await fetch(`${BASE}/account`, { headers: headers() });
    if (!res.ok) throw classifyHttpError(res.status, await readErrorBody(res));
  }

  async submitPrediction(req: MusicGenerationRequest & { prompt: string }): Promise<ProviderSubmitResult> {
    const kind = req.kind || "preview";
    const max = this.maxDurationSec(kind);
    const duration = Math.min(Math.max(req.durationSec ?? max, 5), 30);
    const input: Record<string, unknown> = {
      prompt: req.prompt,
      duration,
      model_version: modelVersionParam(),
      output_format: "mp3",
      normalization_strategy: "peak",
    };
    if (req.referenceAudioUrl) {
      input.input_audio = req.referenceAudioUrl;
      input.model_version = process.env.REPLICATE_MUSICGEN_MELODY_VERSION || "stereo-melody-large";
    }
    const body: Record<string, unknown> = { version: versionId(), input };
    if (process.env.REPLICATE_WEBHOOK_URL) {
      body.webhook = process.env.REPLICATE_WEBHOOK_URL;
      body.webhook_events_filter = ["completed"];
    }
    const res = await fetch(`${BASE}/predictions`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw classifyHttpError(res.status, await readErrorBody(res));
    const json = (await res.json()) as { id?: string; status?: string };
    if (!json.id) {
      throw new MusicGenerationError("PROVIDER_ERROR", "Replicate response missing prediction id", {
        provider: "replicate",
      });
    }
    return {
      providerPredictionId: json.id,
      status: (json.status as ProviderSubmitResult["status"]) || "starting",
      raw: json as Record<string, unknown>,
    };
  }

  async pollPrediction(providerPredictionId: string): Promise<ProviderPollResult> {
    const res = await fetch(`${BASE}/predictions/${providerPredictionId}`, { headers: headers() });
    if (!res.ok) throw classifyHttpError(res.status, await readErrorBody(res));
    const json = (await res.json()) as {
      status: string;
      error?: string | null;
      output?: string | string[] | null;
      metrics?: Record<string, unknown>;
    };
    let outputUrl: string | null = null;
    if (typeof json.output === "string") outputUrl = json.output;
    else if (Array.isArray(json.output) && typeof json.output[0] === "string") outputUrl = json.output[0];
    if (json.status === "failed" && json.error) {
      const lower = String(json.error).toLowerCase();
      if (lower.includes("credit") || lower.includes("billing")) {
        throw new MusicGenerationError("BILLING_REQUIRED", "Replicate billing required", {
          provider: "replicate",
          retryable: false,
        });
      }
    }
    return {
      status: json.status as ProviderPollResult["status"],
      outputUrl,
      error: json.error,
      metrics: json.metrics,
      raw: json as unknown as Record<string, unknown>,
    };
  }

  async downloadOutput(outputUrl: string) {
    const res = await fetch(outputUrl);
    if (!res.ok) {
      throw new MusicGenerationError("DOWNLOAD_ERROR", "Failed to download generated audio", {
        provider: "replicate",
        retryable: true,
        details: { httpStatus: res.status },
      });
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length < 500) {
      throw new MusicGenerationError("AUDIO_VALIDATION_ERROR", "Downloaded audio is too small", {
        provider: "replicate",
      });
    }
    const contentType = res.headers.get("content-type") || "audio/mpeg";
    const extension = contentType.includes("wav") ? "wav" : "mp3";
    return { buffer, contentType, extension };
  }

  async generate(req: MusicGenerationRequest & { prompt: string }): Promise<ProviderGenerateResult> {
    const submitted = await this.submitPrediction(req);
    let poll = await this.pollPrediction(submitted.providerPredictionId);
    for (let i = 0; i < 60; i++) {
      if (poll.status === "succeeded" || poll.status === "failed" || poll.status === "canceled") break;
      await new Promise((r) => setTimeout(r, i < 5 ? 2000 : 3000));
      poll = await this.pollPrediction(submitted.providerPredictionId);
    }
    if (poll.status !== "succeeded" || !poll.outputUrl) {
      if (poll.error) {
        const lower = String(poll.error).toLowerCase();
        if (lower.includes("credit") || lower.includes("billing")) {
          throw new MusicGenerationError("BILLING_REQUIRED", "Replicate billing required", {
            provider: "replicate",
          });
        }
      }
      throw new MusicGenerationError(
        poll.status === "canceled" ? "PROVIDER_ERROR" : "TIMEOUT",
        `Replicate prediction ${poll.status}`,
        { provider: "replicate", retryable: poll.status === "failed" }
      );
    }
    const file = await this.downloadOutput(poll.outputUrl);
    const kind = req.kind || "preview";
    return {
      buffer: file.buffer,
      contentType: file.contentType,
      extension: file.extension,
      durationSec: Math.min(req.durationSec ?? this.maxDurationSec(kind), 30),
      providerPredictionId: submitted.providerPredictionId,
      model: `meta/musicgen:${versionId().slice(0, 12)}`,
      outputUrl: poll.outputUrl,
      metadata: poll.metrics,
    };
  }
}
