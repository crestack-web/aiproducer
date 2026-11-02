/**
 * Daydream Music Generation API — instrumental beats for AP Studio.
 * Docs: https://gen.daydream.live/docs
 *
 * POST /v1/songs → poll GET /v1/songs/{id} → download takes[0].mp3_url
 * Env: DAYDREAM_API (preferred) or DAYDREAM_API_KEY (Bearer)
 */
import type {
  MusicGenerationRequest,
  ProviderGenerateResult,
  ProviderPollResult,
  ProviderSubmitResult,
} from "./types";
import { MusicGenerationError } from "./types";
import type { MusicGenerationProvider } from "./provider";

const BASE = (process.env.DAYDREAM_API_BASE || "https://gen.daydream.live/v1").replace(
  /\/$/,
  ""
);

const MAX_BEAT_DURATION_SEC = 120;
const POLL_MS = 2000;
const POLL_MAX_MS = 180_000;

function apiKey(): string {
  const k =
    process.env.DAYDREAM_API?.trim() ||
    process.env.DAYDREAM_API_KEY?.trim() ||
    process.env.DAYDREAM_KEY?.trim() ||
    "";
  if (!k) {
    throw new MusicGenerationError(
      "AUTHENTICATION_ERROR",
      "DAYDREAM_API is not configured",
      { provider: "daydream", retryable: false }
    );
  }
  return k;
}

function authHeaders(): HeadersInit {
  return {
    Authorization: `Bearer ${apiKey()}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

function buildPrompt(req: MusicGenerationRequest & { prompt: string }): string {
  const parts: string[] = [];
  const base = (req.prompt || "").trim();
  if (base) parts.push(base);
  if (req.genre) parts.push(`${req.genre} style`);
  if (req.mood) parts.push(`${req.mood} mood`);
  if (req.energy) parts.push(`${req.energy} energy`);
  if (req.instrumentation) parts.push(req.instrumentation);
  if (req.bpm) parts.push(`${req.bpm} BPM`);
  parts.push("instrumental beat", "no vocals", "no lyrics", "vocal-ready mix");
  // Daydream prompt max 400 chars
  return parts.join(", ").slice(0, 400);
}

type DaydreamSong = {
  id?: string;
  status?: string;
  error?: string | null;
  position?: number | null;
  duration?: number | null;
  bpm?: number | null;
  takes?: Array<{
    n?: number;
    duration?: number;
    mp3_url?: string;
    wav_url?: string;
    stems_ready?: boolean;
    stems?: Partial<Record<"drums" | "bass" | "guitar" | "keys" | "other", string>>;
  }>;
};

export const DAYDREAM_STEM_NAMES = ["drums", "bass", "guitar", "keys", "other"] as const;
export type DaydreamStemName = (typeof DAYDREAM_STEM_NAMES)[number];


async function createSong(body: Record<string, unknown>): Promise<DaydreamSong> {
  const res = await fetch(`${BASE}/songs`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: DaydreamSong = {};
  try {
    json = text ? (JSON.parse(text) as DaydreamSong) : {};
  } catch {
    /* */
  }
  if (res.status === 401 || res.status === 403) {
    throw new MusicGenerationError(
      "AUTHENTICATION_ERROR",
      "Daydream API key was rejected. Check DAYDREAM_API on Vercel and redeploy.",
      { provider: "daydream", retryable: false, details: { httpStatus: res.status, body: text.slice(0, 300) } }
    );
  }
  if (res.status === 402 || /credit|quota|billing|payment/i.test(text)) {
    throw new MusicGenerationError(
      "BILLING_REQUIRED",
      "Daydream needs more song credits on this account.",
      { provider: "daydream", retryable: false, details: { httpStatus: res.status, body: text.slice(0, 300) } }
    );
  }
  if (res.status === 429) {
    throw new MusicGenerationError("RATE_LIMITED", "Daydream is busy. Try again shortly.", {
      provider: "daydream",
      retryable: true,
      details: { httpStatus: res.status },
    });
  }
  if (!res.ok && res.status !== 202) {
    throw new MusicGenerationError(
      "PROVIDER_ERROR",
      text.slice(0, 280) || `Daydream create failed (${res.status})`,
      { provider: "daydream", retryable: res.status >= 500, details: { httpStatus: res.status, body: text.slice(0, 400) } }
    );
  }
  if (!json.id) {
    throw new MusicGenerationError("PROVIDER_ERROR", "Daydream did not return a song id", {
      provider: "daydream",
      retryable: true,
      details: { body: text.slice(0, 400) },
    });
  }
  return json;
}

async function getSong(id: string): Promise<DaydreamSong> {
  const res = await fetch(`${BASE}/songs/${encodeURIComponent(id)}`, {
    method: "GET",
    headers: authHeaders(),
  });
  const text = await res.text();
  let json: DaydreamSong = {};
  try {
    json = text ? (JSON.parse(text) as DaydreamSong) : {};
  } catch {
    /* */
  }
  if (!res.ok) {
    throw new MusicGenerationError(
      "PROVIDER_ERROR",
      text.slice(0, 280) || `Daydream poll failed (${res.status})`,
      { provider: "daydream", retryable: res.status >= 500, details: { httpStatus: res.status } }
    );
  }
  return json;
}

async function downloadUrl(url: string): Promise<Buffer> {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) {
    throw new MusicGenerationError(
      "PROVIDER_ERROR",
      `Could not download Daydream audio (${res.status})`,
      { provider: "daydream", retryable: true, details: { httpStatus: res.status } }
    );
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1000) {
    throw new MusicGenerationError("PROVIDER_ERROR", "Daydream audio was empty or too short", {
      provider: "daydream",
      retryable: true,
    });
  }
  return buf;
}

export function hasDaydreamKey(): boolean {
  return Boolean(
    process.env.DAYDREAM_API?.trim() ||
    process.env.DAYDREAM_API_KEY?.trim() ||
    process.env.DAYDREAM_KEY?.trim()
  );
}

export class DaydreamMusicProvider implements MusicGenerationProvider {
  readonly name = "daydream" as const;

  maxDurationSec(kind: "preview" | "full"): number {
    if (kind === "preview") {
      return Math.min(
        30,
        Number(process.env.MUSIC_PREVIEW_DURATION_SEC || 12) || 12
      );
    }
    return Math.min(
      MAX_BEAT_DURATION_SEC,
      Number(process.env.MUSIC_FULL_DURATION_SEC || 30) || 30
    );
  }

  async checkAvailability(): Promise<void> {
    apiKey();
  }

  async submitPrediction(
    req: MusicGenerationRequest & { prompt: string }
  ): Promise<ProviderSubmitResult> {
    const result = await this.generate(req);
    return {
      providerPredictionId: result.providerPredictionId,
      status: "succeeded",
      raw: { mode: "poll", model: result.model },
    };
  }

  async pollPrediction(providerPredictionId: string): Promise<ProviderPollResult> {
    return {
      status: "succeeded",
      outputUrl: null,
      error: null,
      metrics: { providerPredictionId, note: "daydream_inline" },
    };
  }

  async downloadOutput(_outputUrl: string): Promise<{
    buffer: Buffer;
    contentType: string;
    extension: string;
  }> {
    throw new MusicGenerationError(
      "PROVIDER_ERROR",
      "Daydream returns audio inline; downloadOutput is not used",
      { provider: "daydream" }
    );
  }

  async generate(
    req: MusicGenerationRequest & { prompt: string }
  ): Promise<ProviderGenerateResult> {
    const kind = req.kind || "preview";
    const maxSec = this.maxDurationSec(kind);
    const durationSec = Math.min(
      Math.max(req.durationSec ?? maxSec, 10),
      MAX_BEAT_DURATION_SEC
    );
    const prompt = buildPrompt(req);

    const body: Record<string, unknown> = {
      prompt,
      duration: durationSec,
      loop: false,
      variations: 1,
    };
    if (req.bpm && req.bpm >= 60 && req.bpm <= 200) {
      body.bpm = Math.round(req.bpm);
    }

    const created = await createSong(body);
    const songId = created.id!;
    const started = Date.now();
    let song = created;

    while (song.status !== "done" && song.status !== "failed") {
      if (Date.now() - started > POLL_MAX_MS) {
        throw new MusicGenerationError("TIMEOUT", "Daydream generation timed out", {
          provider: "daydream",
          retryable: true,
          details: { songId, status: song.status },
        });
      }
      await new Promise((r) => setTimeout(r, POLL_MS));
      song = await getSong(songId);
    }

    if (song.status === "failed") {
      throw new MusicGenerationError(
        "PROVIDER_ERROR",
        song.error || "Daydream failed to render the beat",
        { provider: "daydream", retryable: true, details: { songId } }
      );
    }

    // Stems arrive shortly after the mix — poll a bit longer without failing the beat
    const STEM_WAIT_MS = 45_000;
    const stemDeadline = Date.now() + STEM_WAIT_MS;
    while (Date.now() < stemDeadline) {
      const take0 = song.takes?.[0];
      if (take0?.stems_ready && take0.stems && Object.keys(take0.stems).length > 0) break;
      await new Promise((r) => setTimeout(r, POLL_MS));
      try {
        song = await getSong(songId);
      } catch {
        break;
      }
    }

    const take = song.takes?.[0];
    const mp3 = take?.mp3_url;
    if (!mp3) {
      throw new MusicGenerationError(
        "PROVIDER_ERROR",
        "Daydream finished but returned no audio URL",
        { provider: "daydream", retryable: true, details: { songId } }
      );
    }

    const buffer = await downloadUrl(mp3);
    const outDurationSec =
      typeof take.duration === "number" && take.duration > 0
        ? take.duration
        : durationSec;

    const stemUrls: Partial<Record<DaydreamStemName, string>> = {};
    if (take?.stems && typeof take.stems === "object") {
      for (const name of DAYDREAM_STEM_NAMES) {
        const u = take.stems[name];
        if (typeof u === "string" && u.startsWith("http")) stemUrls[name] = u;
      }
    }

    return {
      buffer,
      contentType: "audio/mpeg",
      extension: "mp3",
      providerPredictionId: songId,
      model: "daydream_music",
      durationSec: outDurationSec,
      metadata: {
        provider: "daydream",
        songId,
        bpm: song.bpm ?? req.bpm ?? null,
        prompt,
        stemUrls,
        stemsReady: Object.keys(stemUrls).length > 0,
      },
    };
  }
}
