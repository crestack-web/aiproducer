/**
 * ElevenLabs Music API ("Eleven Music") — text-to-music with force_instrumental.
 * Docs: POST https://api.elevenlabs.io/v1/music
 * Duration: 3s–4min product max (API allows 5min). Returns audio bytes directly.
 */
import type { MusicGenerationProvider } from "./provider";
import type {
  MusicGenerationRequest,
  ProviderGenerateResult,
  ProviderPollResult,
  ProviderSubmitResult,
} from "./types";
import { MusicGenerationError } from "./types";

const BASE = (process.env.ELEVENLABS_API_BASE || "https://api.elevenlabs.io").replace(/\/$/, "");

/** Max product beat length (4 minutes). */
export const MAX_BEAT_DURATION_SEC = 240;

function cleanKey(raw: string | undefined | null): string {
  if (!raw) return "";
  let k = String(raw).trim();
  if ((k.startsWith('"') && k.endsWith('"')) || (k.startsWith("'") && k.endsWith("'"))) {
    k = k.slice(1, -1).trim();
  }
  k = k.replace(/^\uFEFF/, "").replace(/[\u200B-\u200D\uFEFF]/g, "");
  return k;
}

function apiKey(): string {
  const k =
    cleanKey(process.env.ELEVENLABS_API_KEY) ||
    cleanKey(process.env.ELEVEN_API_KEY) ||
    cleanKey(process.env.XI_API_KEY);
  if (!k) {
    throw new MusicGenerationError("NOT_CONFIGURED", "ELEVENLABS_API_KEY is not configured", {
      provider: "elevenlabs",
    });
  }
  return k;
}

function modelId(): string {
  return (
    cleanKey(process.env.ELEVENLABS_MUSIC_MODEL) ||
    cleanKey(process.env.ELEVEN_MUSIC_MODEL) ||
    "music_v2"
  );
}

function outputFormat(): string {
  return cleanKey(process.env.ELEVENLABS_MUSIC_OUTPUT_FORMAT) || "mp3_44100_128";
}

function authHeaders(): Record<string, string> {
  const key = apiKey();
  return {
    "xi-api-key": key,
    Authorization: `Bearer ${key}`,
  };
}

function classifyHttpError(status: number, body: string): MusicGenerationError {
  const lower = body.toLowerCase();
  if (status === 401) {
    return new MusicGenerationError(
      "AUTHENTICATION_ERROR",
      "ElevenLabs API key was rejected. Check ELEVENLABS_API_KEY on Vercel (no quotes, full key, redeploy after changing).",
      { provider: "elevenlabs", retryable: false, details: { httpStatus: status, body: body.slice(0, 400) } }
    );
  }
  if (status === 403) {
    return new MusicGenerationError(
      "AUTHENTICATION_ERROR",
      "ElevenLabs Music API is not enabled for this key. Music requires a paid ElevenLabs plan with Music API access. Enable Music on elevenlabs.io then retry.",
      { provider: "elevenlabs", retryable: false, details: { httpStatus: status, body: body.slice(0, 400) } }
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
      "ElevenLabs Music needs more credits or an upgraded plan on the ElevenLabs account.",
      { provider: "elevenlabs", retryable: false, details: { httpStatus: status } }
    );
  }
  if (status === 429 || lower.includes("rate limit") || lower.includes("too many")) {
    return new MusicGenerationError("RATE_LIMITED", "ElevenLabs rate limit exceeded. Try again shortly.", {
      provider: "elevenlabs",
      retryable: true,
      details: { httpStatus: status },
    });
  }
  if (status >= 500) {
    return new MusicGenerationError("PROVIDER_ERROR", "ElevenLabs server error", {
      provider: "elevenlabs",
      retryable: true,
      details: { httpStatus: status },
    });
  }
  return new MusicGenerationError(
    "PROVIDER_ERROR",
    body.slice(0, 280) || `ElevenLabs request failed (${status})`,
    { provider: "elevenlabs", retryable: false, details: { httpStatus: status } }
  );
}

async function readErrorBody(res: Response): Promise<string> {
  try {
    const text = await res.text();
    try {
      const j = JSON.parse(text) as {
        detail?: unknown;
        message?: string;
        error?: string;
      };
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
  styles.push("instrumental", "no vocals", "no lyrics", "vocal-ready midrange");

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
        positive_styles: [...base, "intro", "sparse"],
        negative_styles: ["vocals", "singing", "rap"],
        context_adherence: "high",
      },
      {
        text: "[Verse] Instrumental verse with midrange space for a lead vocal",
        duration_ms: verse,
        positive_styles: [...base, "verse", "groove"],
        negative_styles: ["vocals", "singing", "rap"],
        context_adherence: "high",
      },
      {
        text: "[Chorus] Fuller instrumental chorus, still no vocals",
        duration_ms: chorus,
        positive_styles: [...base, "chorus", "wider"],
        negative_styles: ["vocals", "singing", "rap"],
        context_adherence: "high",
      },
      {
        text: "[Outro] Instrumental outro, wind down",
        duration_ms: outro,
        positive_styles: [...base, "outro"],
        negative_styles: ["vocals", "singing", "rap"],
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
    const res = await fetch(`${BASE}/v1/user`, { headers: { ...authHeaders() } });
    if (!res.ok) throw classifyHttpError(res.status, await readErrorBody(res));
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
    const model = modelId();

    // Default: prompt + force_instrumental (most reliable). Composition plan is opt-in.
    const usePlan =
      (process.env.ELEVENLABS_MUSIC_USE_COMPOSITION_PLAN || "").trim() === "1" && model !== "music_v1";

    const body: Record<string, unknown> = { model_id: model };

    if (usePlan) {
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
      const prompt = /instrumental|no vocals|no lyrics/i.test(req.prompt)
        ? req.prompt
        : `${req.prompt}. Instrumental only. No vocals. No lyrics. No singing.`;
      body.prompt = prompt.slice(0, 4100);
      body.music_length_ms = musicLengthMs;
      body.force_instrumental = true;
    }

    const url = `${BASE}/v1/music?output_format=${encodeURIComponent(outputFormat())}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        ...authHeaders(),
        "Content-Type": "application/json",
        Accept: "audio/mpeg, application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw classifyHttpError(res.status, await readErrorBody(res));
    }

    const songId = res.headers.get("song-id") || res.headers.get("Song-Id") || `el-${Date.now()}`;
    const contentType = res.headers.get("content-type") || "audio/mpeg";
    const buffer = Buffer.from(await res.arrayBuffer());

    if (buffer.length < 500) {
      throw new MusicGenerationError(
        "AUDIO_VALIDATION_ERROR",
        "ElevenLabs returned empty or tiny audio",
        { provider: "elevenlabs", details: { bytes: buffer.length } }
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
        force_instrumental: !usePlan,
        used_composition_plan: usePlan,
        song_id: songId,
      },
    };
  }
}
