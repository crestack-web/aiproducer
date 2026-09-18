/**
 * ElevenLabs Music API — POST /v1/music
 * Tries api.elevenlabs.io then api.us.elevenlabs.io on auth failures (workspace region).
 */
import type { MusicGenerationProvider } from "./provider";
import type {
  MusicGenerationRequest,
  ProviderGenerateResult,
  ProviderPollResult,
  ProviderSubmitResult,
} from "./types";
import { MusicGenerationError } from "./types";

export const MAX_BEAT_DURATION_SEC = 240;

const DEFAULT_BASES = [
  process.env.ELEVENLABS_API_BASE?.replace(/\/$/, "") || "https://api.elevenlabs.io",
  "https://api.us.elevenlabs.io",
].filter((v, i, a) => v && a.indexOf(v) === i);

function cleanKey(raw: string | undefined | null): string {
  if (!raw) return "";
  let k = String(raw).trim();
  k = k.replace(/^\uFEFF/, "").replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
  for (let i = 0; i < 3; i++) {
    if (k.length < 2) break;
    const a = k[0];
    const b = k[k.length - 1];
    if (
      (a === '"' && b === '"') ||
      (a === "'" && b === "'") ||
      (a === "\u201c" && b === "\u201d") ||
      (a === "\u2018" && b === "\u2019")
    ) {
      k = k.slice(1, -1).trim();
      continue;
    }
    break;
  }
  k = k.replace(/^Bearer\s+/i, "").replace(/^xi-api-key\s*:\s*/i, "").trim();
  k = k.replace(/\s+/g, "");
  return k;
}

function apiKey(): string {
  const k =
    cleanKey(process.env.ELEVENLABS_API_KEY) ||
    cleanKey(process.env.ELEVEN_API_KEY) ||
    cleanKey(process.env.XI_API_KEY);
  if (!k) {
    throw new MusicGenerationError("NOT_CONFIGURED", "ELEVENLABS_API_KEY is not configured on this deployment", {
      provider: "elevenlabs",
    });
  }
  return k;
}

function modelCandidates(): string[] {
  const preferred =
    cleanKey(process.env.ELEVENLABS_MUSIC_MODEL) ||
    cleanKey(process.env.ELEVEN_MUSIC_MODEL) ||
    "music_v1";
  const list = [preferred, "music_v1", "music_v2"];
  return list.filter((v, i, a) => v && a.indexOf(v) === i);
}

function outputFormat(): string {
  return cleanKey(process.env.ELEVENLABS_MUSIC_OUTPUT_FORMAT) || "mp3_44100_128";
}

function classifyHttpError(status: number, body: string, base: string): MusicGenerationError {
  const lower = body.toLowerCase();
  if (status === 401) {
    let elMsg = "";
    try {
      const j = JSON.parse(body) as { detail?: { message?: string; code?: string } | string };
      if (typeof j.detail === "string") elMsg = j.detail;
      else if (j.detail && typeof j.detail === "object") elMsg = j.detail.message || j.detail.code || "";
    } catch {
      /* ignore */
    }
    const key =
      cleanKey(process.env.ELEVENLABS_API_KEY) ||
      cleanKey(process.env.ELEVEN_API_KEY) ||
      cleanKey(process.env.XI_API_KEY);
    const fingerprint = key ? `len=${key.length} suffix=…${key.slice(-4)}` : "empty";
    return new MusicGenerationError(
      "AUTHENTICATION_ERROR",
      `ElevenLabs rejected the API key (HTTP 401 via ${base})${elMsg ? `: ${elMsg}` : ""}. Env key ${fingerprint}. Fix: set Production ELEVENLABS_API_KEY to the full sk_ key with NO quotes around it, then Redeploy.`,
      {
        provider: "elevenlabs",
        retryable: false,
        details: { httpStatus: status, body: body.slice(0, 300), base, keyFingerprint: fingerprint },
      }
    );
  }
  if (status === 403) {
    return new MusicGenerationError(
      "AUTHENTICATION_ERROR",
      `ElevenLabs blocked Music on this key (HTTP 403 via ${base}). The key is valid for the account, but Music API is not enabled — open elevenlabs.io with that account, confirm a paid plan with Music, and generate once in their UI to activate.`,
      { provider: "elevenlabs", retryable: false, details: { httpStatus: status, body: body.slice(0, 500), base } }
    );
  }
  if (
    status === 402 ||
    lower.includes("quota") ||
    lower.includes("credit") ||
    lower.includes("payment") ||
    lower.includes("billing") ||
    lower.includes("insufficient")
  ) {
    return new MusicGenerationError(
      "BILLING_REQUIRED",
      "ElevenLabs Music needs more credits on the ElevenLabs account that owns this API key.",
      { provider: "elevenlabs", retryable: false, details: { httpStatus: status, body: body.slice(0, 400), base } }
    );
  }
  if (status === 429) {
    return new MusicGenerationError("RATE_LIMITED", "ElevenLabs rate limit exceeded. Try again shortly.", {
      provider: "elevenlabs",
      retryable: true,
      details: { httpStatus: status, base },
    });
  }
  if (status >= 500) {
    return new MusicGenerationError("PROVIDER_ERROR", "ElevenLabs server error", {
      provider: "elevenlabs",
      retryable: true,
      details: { httpStatus: status, body: body.slice(0, 300), base },
    });
  }
  return new MusicGenerationError(
    "PROVIDER_ERROR",
    body.slice(0, 280) || `ElevenLabs request failed (${status})`,
    { provider: "elevenlabs", retryable: false, details: { httpStatus: status, body: body.slice(0, 400), base } }
  );
}

async function readErrorBody(res: Response): Promise<string> {
  try {
    const text = await res.text();
    try {
      const j = JSON.parse(text) as { detail?: unknown; message?: string; error?: string };
      if (typeof j.message === "string") return j.message;
      if (typeof j.error === "string") return j.error;
      if (typeof j.detail === "string") return j.detail;
      if (Array.isArray(j.detail)) {
        return j.detail
          .map((d) =>
            typeof d === "object" && d && "msg" in d ? String((d as { msg: string }).msg) : String(d)
          )
          .join("; ");
      }
      return text.slice(0, 500);
    } catch {
      return text.slice(0, 500) || res.statusText;
    }
  } catch {
    return res.statusText;
  }
}

export function buildElevenLabsCompositionPlan(opts: {
  prompt: string;
  durationMs: number;
  genre?: string;
  mood?: string;
  energy?: string;
  instrumentation?: string;
  bpm?: number;
}): {
  chunks: Array<{
    text: string;
    duration_ms: number;
    positive_styles: string[];
    negative_styles: string[];
    context_adherence: string;
  }>;
} {
  const styles: string[] = [];
  if (opts.genre) styles.push(opts.genre.toLowerCase());
  if (opts.mood) styles.push(opts.mood.toLowerCase());
  if (opts.energy) styles.push(opts.energy.toLowerCase());
  if (opts.instrumentation) {
    for (const bit of opts.instrumentation.split(/[\/,]/).map((s) => s.trim()).filter(Boolean)) {
      styles.push(bit.toLowerCase());
    }
  }
  if (opts.bpm) styles.push(`${opts.bpm} bpm`);
  styles.push("instrumental", "no vocals", "no lyrics");

  const total = Math.max(6000, Math.min(240000, opts.durationMs));
  const intro = Math.round(total * 0.12);
  const verse = Math.round(total * 0.32);
  const chorus = Math.round(total * 0.36);
  const outro = Math.max(3000, total - intro - verse - chorus);
  const base = styles.slice(0, 8);

  return {
    chunks: [
      {
        text: "[Intro] Instrumental opening, leave headroom for vocals",
        duration_ms: intro,
        positive_styles: [...base, "intro"],
        negative_styles: ["vocals", "singing"],
        context_adherence: "high",
      },
      {
        text: "[Verse] Instrumental verse with space for lead vocal",
        duration_ms: verse,
        positive_styles: [...base, "verse"],
        negative_styles: ["vocals", "singing"],
        context_adherence: "high",
      },
      {
        text: "[Chorus] Fuller instrumental chorus, no vocals",
        duration_ms: chorus,
        positive_styles: [...base, "chorus"],
        negative_styles: ["vocals", "singing"],
        context_adherence: "high",
      },
      {
        text: "[Outro] Instrumental outro",
        duration_ms: outro,
        positive_styles: [...base, "outro"],
        negative_styles: ["vocals", "singing"],
        context_adherence: "high",
      },
    ],
  };
}

export class ElevenLabsMusicProvider implements MusicGenerationProvider {
  readonly name = "elevenlabs" as const;

  maxDurationSec(kind: "preview" | "full"): number {
    if (kind === "preview") return Number(process.env.MUSIC_PREVIEW_DURATION_SEC || 12);
    return Number(process.env.MUSIC_FULL_DURATION_SEC || 30);
  }

  async checkAvailability(): Promise<void> {
    const key = apiKey();
    let lastErr: MusicGenerationError | null = null;
    for (const base of DEFAULT_BASES) {
      const res = await fetch(`${base}/v1/user`, { headers: { "xi-api-key": key } });
      if (res.ok) return;
      lastErr = classifyHttpError(res.status, await readErrorBody(res), base);
    }
    throw lastErr || new MusicGenerationError("AUTHENTICATION_ERROR", "ElevenLabs user check failed", {
      provider: "elevenlabs",
    });
  }

  async submitPrediction(
    req: MusicGenerationRequest & { prompt: string }
  ): Promise<ProviderSubmitResult> {
    const result = await this.generate(req);
    return {
      providerPredictionId: result.providerPredictionId,
      status: "succeeded",
      raw: { mode: "sync", model: result.model },
    };
  }

  async pollPrediction(providerPredictionId: string): Promise<ProviderPollResult> {
    return {
      status: "succeeded",
      outputUrl: null,
      error: null,
      metrics: { providerPredictionId, note: "elevenlabs_sync" },
    };
  }

  async downloadOutput(_outputUrl: string): Promise<{
    buffer: Buffer;
    contentType: string;
    extension: string;
  }> {
    throw new MusicGenerationError(
      "PROVIDER_ERROR",
      "ElevenLabs returns audio inline; downloadOutput is not used",
      { provider: "elevenlabs" }
    );
  }

  async generate(req: MusicGenerationRequest & { prompt: string }): Promise<ProviderGenerateResult> {
    const kind = req.kind || "preview";
    const maxSec = this.maxDurationSec(kind);
    const durationSec = Math.min(Math.max(req.durationSec ?? maxSec, 3), MAX_BEAT_DURATION_SEC);
    const musicLengthMs = Math.round(durationSec * 1000);
    const key = apiKey();
    const models = modelCandidates();
    const usePlan = (process.env.ELEVENLABS_MUSIC_USE_COMPOSITION_PLAN || "").trim() === "1";

    const prompt = /instrumental|no vocals|no lyrics/i.test(req.prompt)
      ? req.prompt
      : `${req.prompt}. Instrumental only. No vocals. No lyrics. No singing.`;

    let lastErr: MusicGenerationError | null = null;

    for (const base of DEFAULT_BASES) {
      for (const model of models) {
        const body: Record<string, unknown> = { model_id: model };
        if (usePlan && model !== "music_v1") {
          body.composition_plan = buildElevenLabsCompositionPlan({
            prompt: req.prompt,
            durationMs: musicLengthMs,
            genre: req.genre,
            mood: req.mood,
            energy: req.energy,
            instrumentation: req.instrumentation,
            bpm: req.bpm,
          });
        } else {
          body.prompt = prompt.slice(0, 4100);
          body.music_length_ms = musicLengthMs;
          body.force_instrumental = true;
        }

        const url = `${base}/v1/music?output_format=${encodeURIComponent(outputFormat())}`;
        let res: Response;
        try {
          res = await fetch(url, {
            method: "POST",
            headers: {
              "xi-api-key": key,
              "Content-Type": "application/json",
              Accept: "audio/mpeg, application/json",
            },
            body: JSON.stringify(body),
          });
        } catch (netErr) {
          lastErr = new MusicGenerationError(
            "PROVIDER_ERROR",
            `Network error reaching ${base}: ${netErr instanceof Error ? netErr.message : String(netErr)}`,
            { provider: "elevenlabs", retryable: true, details: { base } }
          );
          continue;
        }

        if (res.ok) {
          const songId = res.headers.get("song-id") || res.headers.get("Song-Id") || `el-${Date.now()}`;
          const contentType = res.headers.get("content-type") || "audio/mpeg";
          const buffer = Buffer.from(await res.arrayBuffer());
          if (buffer.length < 500) {
            throw new MusicGenerationError(
              "AUDIO_VALIDATION_ERROR",
              "ElevenLabs returned empty or tiny audio",
              { provider: "elevenlabs", details: { bytes: buffer.length, base, model } }
            );
          }
          const isWav =
            contentType.includes("wav") || contentType.includes("pcm") || contentType.includes("octet");
          const extension = isWav && !contentType.includes("mpeg") ? "wav" : "mp3";
          return {
            buffer,
            contentType: contentType.includes("audio") ? contentType : "audio/mpeg",
            extension,
            durationSec,
            providerPredictionId: songId,
            model: `elevenlabs/${model}`,
            metadata: {
              music_length_ms: musicLengthMs,
              force_instrumental: true,
              base,
              model,
              song_id: songId,
              keyLen: key.length,
              keyLast4: key.slice(-4),
            },
          };
        }

        const errBody = await readErrorBody(res);
        console.error(
          "[elevenlabs-music]",
          JSON.stringify({
            status: res.status,
            body: errBody.slice(0, 300),
            base,
            model,
            keyLen: key.length,
            keyLast4: key.slice(-4),
            music_length_ms: musicLengthMs,
          })
        );
        lastErr = classifyHttpError(res.status, errBody, base);

        // Auth on this base — try next base (region). Don't keep trying models on same base if 401.
        if (res.status === 401) break;
        // 403 might be model-specific — try next model
        if (res.status === 403) continue;
        // Other hard errors — still try other models/bases once
        if (res.status >= 500) continue;
        if (res.status === 422 || res.status === 400) {
          // invalid request for this model — try next model
          continue;
        }
      }
    }

    throw (
      lastErr ||
      new MusicGenerationError("AUTHENTICATION_ERROR", "ElevenLabs Music request failed on all endpoints", {
        provider: "elevenlabs",
      })
    );
  }
}
