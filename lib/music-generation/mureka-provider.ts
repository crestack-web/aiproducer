/**
 * Mureka MusicGenerationProvider — instrumentals first (MVP).
 * Uses official api.mureka.ai endpoints; never exposes the API key.
 */
import type { MusicGenerationProvider } from "./provider";
import type {
  MusicGenerationRequest,
  ProviderGenerateResult,
  ProviderPollResult,
  ProviderSubmitResult,
} from "./types";
import { MusicGenerationError } from "./types";
import {
  asMurekaTask,
  isMurekaConfigured,
  isSuccessStatus,
  isTerminalStatus,
  murekaGet,
  murekaPost,
  normalizeChoices,
  pickAudioUrl,
  type MurekaTask,
} from "./mureka-client";
import { buildInstrumentalPrompt } from "./producer-spec";

function modelName(): string {
  return (process.env.MUREKA_MODEL || "auto").trim() || "auto";
}

function classifyHttp(status: number, data: Record<string, unknown>): MusicGenerationError {
  const msg =
    (data.error as { message?: string } | undefined)?.message ||
    (typeof data.message === "string" ? data.message : `Mureka HTTP ${status}`);
  if (status === 401 || status === 403) {
    return new MusicGenerationError("UNAUTHORIZED", String(msg), { provider: "mureka" });
  }
  if (status === 429) {
    return new MusicGenerationError("RATE_LIMITED", String(msg), {
      provider: "mureka",
      retryable: true,
    });
  }
  if (status >= 500) {
    return new MusicGenerationError("PROVIDER_ERROR", String(msg), {
      provider: "mureka",
      retryable: true,
    });
  }
  return new MusicGenerationError("INVALID_INPUT", String(msg), { provider: "mureka" });
}

function queryPathForTask(taskId: string, kind: "instrumental" | "song" | "track"): string {
  if (kind === "instrumental") return `/v1/instrumental/query/${encodeURIComponent(taskId)}`;
  if (kind === "track") return `/v1/song/query/${encodeURIComponent(taskId)}`;
  return `/v1/song/query/${encodeURIComponent(taskId)}`;
}

export class MurekaMusicProvider implements MusicGenerationProvider {
  readonly name = "mureka" as const;

  isConfigured(): boolean {
    return isMurekaConfigured();
  }

  maxDurationSec(kind: "preview" | "full"): number {
    if (kind === "preview") return Number(process.env.MUSIC_PREVIEW_DURATION_SEC || 12);
    // Mureka instrumental defaults; overridable via env
    return Number(process.env.MUREKA_MAX_DURATION_SEC || process.env.MUSIC_FULL_DURATION_SEC || 120);
  }

  async submitPrediction(req: MusicGenerationRequest): Promise<ProviderSubmitResult> {
    if (!this.isConfigured()) {
      throw new MusicGenerationError(
        "PROVIDER_ERROR",
        "Mureka is not configured (set MUREKA_API_KEY)",
        { provider: "mureka" }
      );
    }

    const prompt = buildInstrumentalPrompt({
      genre: req.genre,
      mood: req.mood,
      bpm: req.bpm,
      energy: req.energy,
      instrumentation: req.instrumentation,
      structure: req.structure,
      artistDirection: req.prompt,
      vocalSpace: true,
      commercial: true,
    });

    // MVP path: always instrumental for AP beat generation (artist records their own vocal)
    const body: Record<string, unknown> = {
      model: modelName(),
      prompt: prompt.slice(0, 1024),
      n: 1,
    };

    const { status, data } = await murekaPost("/v1/instrumental/generate", body, {
      timeoutMs: 60_000,
    });
    if (status >= 400) throw classifyHttp(status, data);

    const task = asMurekaTask(data);
    if (!task.id) {
      throw new MusicGenerationError("PROVIDER_ERROR", "Mureka returned no task id", {
        provider: "mureka",
      });
    }

    return {
      providerPredictionId: task.id,
      status: "starting",
      model: String(task.model || modelName()),
      metadata: {
        mureka_status: task.status,
        trace_id: task.trace_id,
        prompt_used: prompt.slice(0, 200),
        endpoint: "instrumental",
      },
    };
  }

  async pollPrediction(providerPredictionId: string): Promise<ProviderPollResult> {
    const { status, data } = await murekaGet(
      queryPathForTask(providerPredictionId, "instrumental"),
      { timeoutMs: 30_000 }
    );
    if (status >= 400) {
      // Some deployments use song/query for mixed tasks — try fallback once
      if (status === 404) {
        const fb = await murekaGet(queryPathForTask(providerPredictionId, "song"), {
          timeoutMs: 30_000,
        });
        if (fb.status < 400) return this.mapPoll(asMurekaTask(fb.data));
      }
      throw classifyHttp(status, data);
    }
    return this.mapPoll(asMurekaTask(data));
  }

  private mapPoll(task: MurekaTask): ProviderPollResult {
    const st = (task.status || "").toLowerCase();
    if (!isTerminalStatus(st)) {
      return {
        status: "processing",
        metadata: { mureka_status: task.status, trace_id: task.trace_id },
      };
    }
    if (!isSuccessStatus(st)) {
      return {
        status: "failed",
        error: task.failed_reason || task.error?.message || `Mureka status ${task.status}`,
        metadata: { mureka_status: task.status, trace_id: task.trace_id },
      };
    }
    const choices = normalizeChoices(task.choices);
    const url = pickAudioUrl(choices[0]);
    if (!url) {
      return {
        status: "failed",
        error: "Mureka succeeded but returned no audio URL",
        metadata: { mureka_status: task.status, trace_id: task.trace_id },
      };
    }
    const duration =
      typeof choices[0]?.duration === "number" ? Number(choices[0].duration) : undefined;
    return {
      status: "succeeded",
      outputUrl: url,
      metadata: {
        mureka_status: task.status,
        trace_id: task.trace_id,
        duration_sec: duration,
        choice_count: choices.length,
      },
    };
  }

  async downloadOutput(outputUrl: string): Promise<{
    buffer: Buffer;
    contentType: string;
    extension: string;
  }> {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 120_000);
    try {
      const res = await fetch(outputUrl, { signal: controller.signal });
      if (!res.ok) {
        throw new MusicGenerationError(
          "PROVIDER_ERROR",
          `Failed to download Mureka audio (${res.status})`,
          { provider: "mureka", retryable: true }
        );
      }
      const ab = await res.arrayBuffer();
      const ct = res.headers.get("content-type") || "audio/mpeg";
      const ext = ct.includes("wav") ? "wav" : ct.includes("flac") ? "flac" : "mp3";
      return { buffer: Buffer.from(ab), contentType: ct, extension: ext };
    } finally {
      clearTimeout(t);
    }
  }

  async generate(req: MusicGenerationRequest): Promise<ProviderGenerateResult> {
    const submitted = await this.submitPrediction(req);
    const deadline = Date.now() + Number(process.env.MUREKA_POLL_TIMEOUT_MS || 300_000);
    let last: ProviderPollResult = { status: "processing" };
    while (Date.now() < deadline) {
      last = await this.pollPrediction(submitted.providerPredictionId);
      if (last.status === "succeeded" && last.outputUrl) {
        const dl = await this.downloadOutput(last.outputUrl);
        const durationSec =
          typeof last.metadata?.duration_sec === "number"
            ? Number(last.metadata.duration_sec)
            : Number(req.durationSec ?? 30);
        return {
          buffer: dl.buffer,
          contentType: dl.contentType,
          extension: dl.extension,
          durationSec,
          providerPredictionId: submitted.providerPredictionId,
          model: submitted.model || modelName(),
          metadata: { ...submitted.metadata, ...last.metadata },
        };
      }
      if (last.status === "failed") {
        throw new MusicGenerationError(
          "PROVIDER_ERROR",
          last.error || "Mureka generation failed",
          { provider: "mureka" }
        );
      }
      await new Promise((r) => setTimeout(r, 4000));
    }
    throw new MusicGenerationError("TIMEOUT", "Mureka generation timed out", {
      provider: "mureka",
      retryable: true,
    });
  }
}

/**
 * Generate a complementary instrument layer (drums, bass, guitar, …) via Mureka track API.
 * Returns provider task id; caller should poll via song/query.
 * Cost-sensitive: one explicit user action → one request.
 */
export async function murekaSubmitAddInstrument(opts: {
  prompt: string;
  /** Uploaded Mureka file id (purpose=audio|reference) when available */
  referenceFileId?: string;
  trackType?: string;
}): Promise<ProviderSubmitResult> {
  if (!isMurekaConfigured()) {
    throw new MusicGenerationError("PROVIDER_ERROR", "Mureka is not configured", {
      provider: "mureka",
    });
  }
  const body: Record<string, unknown> = {
    model: modelName(),
    prompt: opts.prompt.slice(0, 1024),
    track_type: opts.trackType || "instrument",
    n: 1,
  };
  if (opts.referenceFileId) body.reference_id = opts.referenceFileId;

  const { status, data } = await murekaPost("/v1/track/generate", body, { timeoutMs: 60_000 });
  if (status >= 400) throw classifyHttp(status, data);
  const task = asMurekaTask(data);
  if (!task.id) {
    throw new MusicGenerationError("PROVIDER_ERROR", "Mureka track generate returned no id", {
      provider: "mureka",
    });
  }
  return {
    providerPredictionId: task.id,
    status: "starting" as const,
    model: String(task.model || modelName()),
    metadata: { endpoint: "track", track_type: body.track_type, trace_id: task.trace_id },
  };
}

/**
 * Build-around-vocal: upload vocal sample then request accompaniment.
 * Uses files/upload (purpose=melody|voice) + instrumental or track generate.
 */
export async function murekaSubmitAroundVocal(opts: {
  vocalBuffer: Buffer;
  filename: string;
  prompt: string;
}): Promise<ProviderSubmitResult> {
  if (!isMurekaConfigured()) {
    throw new MusicGenerationError("PROVIDER_ERROR", "Mureka is not configured", {
      provider: "mureka",
    });
  }
  const { murekaUploadFile } = await import("./mureka-client");
  // melody purpose extracts vocal motif; voice is short sample
  let fileId: string;
  try {
    const uploaded = await murekaUploadFile(opts.vocalBuffer, opts.filename, "melody");
    fileId = uploaded.id;
  } catch {
    const uploaded = await murekaUploadFile(opts.vocalBuffer, opts.filename, "voice");
    fileId = uploaded.id;
  }

  const body: Record<string, unknown> = {
    model: modelName(),
    prompt: opts.prompt.slice(0, 1024),
    melody_id: fileId,
    n: 1,
  };
  // Prefer song generate with melody control (accompaniment around motif)
  const { status, data } = await murekaPost("/v1/song/generate", body, { timeoutMs: 60_000 });
  if (status >= 400) {
    // Fallback: instrumental with reference
    const fb = await murekaPost(
      "/v1/instrumental/generate",
      { model: modelName(), prompt: opts.prompt.slice(0, 1024), n: 1 },
      { timeoutMs: 60_000 }
    );
    if (fb.status >= 400) throw classifyHttp(fb.status, fb.data);
    const task = asMurekaTask(fb.data);
    return {
      providerPredictionId: task.id,
      status: "starting" as const,
      model: String(task.model || modelName()),
      metadata: {
        endpoint: "instrumental_fallback",
        melody_id: fileId,
        trace_id: task.trace_id,
      },
    };
  }
  const task = asMurekaTask(data);
  if (!task.id) {
    throw new MusicGenerationError("PROVIDER_ERROR", "Mureka around-vocal returned no id", {
      provider: "mureka",
    });
  }
  return {
    providerPredictionId: task.id,
    status: "starting" as const,
    model: String(task.model || modelName()),
    metadata: { endpoint: "song_melody", melody_id: fileId, trace_id: task.trace_id },
  };
}
