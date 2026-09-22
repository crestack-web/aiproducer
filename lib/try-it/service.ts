/**
 * Try It orchestration — isolated from Record / produce.
 * Hard cost controls: short preview, Flash TTS, per-user generate cap, clone reuse, usage log.
 */
import { createServiceClient } from "@/lib/supabase/server";
import { createSignedDownloadUrl, uploadBuffer } from "@/lib/storage";
import { getMusicProvider } from "@/lib/music-generation/service";
import { buildInstrumentalPrompt } from "@/lib/music-generation/provider";
import {
  TRY_IT_MAX_GENERATES_PER_USER,
  TRY_IT_MAX_PROVIDER_RETRIES,
  TRY_IT_MAX_SAMPLE_MS,
  TRY_IT_MIN_SAMPLE_MS,
  TRY_IT_PREVIEW_BEAT_SEC,
  TRY_IT_PREVIEW_MAX_SEC,
  TRY_IT_SCOPE,
  TRY_IT_SOURCE_META,
  TRY_IT_TTL_HOURS,
  TRY_IT_TTS_MODEL,
  isTryItEnabled,
  tryItStoragePrefix,
} from "./config";
import {
  createInstantVoiceClone,
  deleteTrialVoice,
  synthesizeWithVoice,
} from "./elevenlabs-ivc";
import type { TryItSessionRow, TryItStatus } from "./types";

export { isTryItEnabled };

export class TryItQuotaError extends Error {
  readonly code = "TRY_IT_LIMIT" as const;
  constructor(message: string) {
    super(message);
    this.name = "TryItQuotaError";
  }
}

function expiresAtIso(): string {
  return new Date(Date.now() + TRY_IT_TTL_HOURS * 3600 * 1000).toISOString();
}

async function logUsage(opts: {
  userId: string;
  sessionId?: string;
  event: "clone" | "generate" | "generate_retry";
  modelTier?: string;
  durationSec?: number;
  success: boolean;
  errorSnippet?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    const service = createServiceClient();
    await service.from("try_it_usage_log").insert({
      user_id: opts.userId,
      session_id: opts.sessionId ?? null,
      event: opts.event,
      model_tier: opts.modelTier ?? null,
      duration_sec: opts.durationSec ?? null,
      success: opts.success,
      error_snippet: opts.errorSnippet?.slice(0, 400) ?? null,
      metadata: {
        source: TRY_IT_SOURCE_META,
        ...(opts.metadata || {}),
      },
    });
  } catch (e) {
    console.warn("[try-it] usage log failed", e instanceof Error ? e.message : e);
  }
}

/** Successful generate count for this account (lifetime). */
export async function countUserGenerates(userId: string): Promise<number> {
  const service = createServiceClient();
  const { count, error } = await service
    .from("try_it_usage_log")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("event", "generate")
    .eq("success", true);
  if (error) {
    // Fallback: count preview_ready sessions
    const { count: c2 } = await service
      .from("try_it_sessions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("status", "preview_ready");
    return c2 ?? 0;
  }
  return count ?? 0;
}

export async function getTryItQuota(userId: string): Promise<{
  used: number;
  limit: number;
  remaining: number;
}> {
  const used = await countUserGenerates(userId);
  const limit = TRY_IT_MAX_GENERATES_PER_USER;
  return { used, limit, remaining: Math.max(0, limit - used) };
}

export async function createTryItSession(userId: string): Promise<TryItSessionRow> {
  if (!isTryItEnabled()) throw new Error("Try It is not enabled on this deployment");
  const service = createServiceClient();
  const { data, error } = await service
    .from("try_it_sessions")
    .insert({
      user_id: userId,
      scope: TRY_IT_SCOPE,
      status: "created",
      expires_at: expiresAtIso(),
      metadata: { source: TRY_IT_SOURCE_META },
    })
    .select("*")
    .single();
  if (error || !data) throw new Error(error?.message || "Could not create Try It session");
  return data as TryItSessionRow;
}

export async function getTryItSession(
  sessionId: string,
  userId: string
): Promise<TryItSessionRow | null> {
  const service = createServiceClient();
  const { data } = await service
    .from("try_it_sessions")
    .select("*")
    .eq("id", sessionId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) return null;
  const row = data as TryItSessionRow;
  if (new Date(row.expires_at).getTime() < Date.now() && row.status !== "expired") {
    await service.from("try_it_sessions").update({ status: "expired" }).eq("id", sessionId);
    return { ...row, status: "expired" };
  }
  return row;
}

export async function ingestSample(opts: {
  sessionId: string;
  userId: string;
  buffer: Buffer;
  filename: string;
  contentType: string;
  durationMs: number;
  removeNoise?: boolean;
}): Promise<TryItSessionRow> {
  const session = await getTryItSession(opts.sessionId, opts.userId);
  if (!session) throw new Error("Session not found");
  if (session.status === "expired") throw new Error("Session expired");
  if (opts.durationMs < TRY_IT_MIN_SAMPLE_MS) {
    throw new Error("Sample too short — need at least 10 seconds of clear voice");
  }
  if (opts.durationMs > TRY_IT_MAX_SAMPLE_MS) {
    throw new Error("Sample too long — keep it under 2 minutes");
  }
  if (opts.buffer.length < 2000) throw new Error("Sample file is empty or invalid");

  const prefix = tryItStoragePrefix(opts.userId, opts.sessionId);
  const ext = (opts.filename.split(".").pop() || "webm").toLowerCase().slice(0, 5);
  const samplePath = `${prefix}/sample.${ext}`;
  await uploadBuffer(samplePath, opts.buffer, opts.contentType || "audio/webm");

  const service = createServiceClient();
  await service
    .from("try_it_sessions")
    .update({
      sample_path: samplePath,
      sample_duration_ms: Math.round(opts.durationMs),
      status: "sample_ready" satisfies TryItStatus,
      error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", opts.sessionId);

  // Reuse existing trial voice_id for this session — IVC is one call per session
  if (session.eleven_voice_id) {
    const { data } = await service
      .from("try_it_sessions")
      .update({
        status: "voice_ready" satisfies TryItStatus,
        updated_at: new Date().toISOString(),
        metadata: {
          ...(session.metadata || {}),
          source: TRY_IT_SOURCE_META,
          scope: TRY_IT_SCOPE,
          voice_reused: true,
        },
      })
      .eq("id", opts.sessionId)
      .select("*")
      .single();
    return (data || session) as TryItSessionRow;
  }

  // Explicit user upload only path reaches here without a voice — clone once
  try {
    const { voiceId } = await createInstantVoiceClone({
      name: `AP TryIt ${opts.userId.slice(0, 8)} ${opts.sessionId.slice(0, 6)}`,
      samples: [
        {
          buffer: opts.buffer,
          filename: opts.filename || `sample.${ext}`,
          contentType: opts.contentType || "audio/webm",
        },
      ],
      removeBackgroundNoise: opts.removeNoise !== false,
    });
    await logUsage({
      userId: opts.userId,
      sessionId: opts.sessionId,
      event: "clone",
      modelTier: "elevenlabs_ivc",
      success: true,
      metadata: { sample_duration_ms: opts.durationMs },
    });
    const { data, error } = await service
      .from("try_it_sessions")
      .update({
        eleven_voice_id: voiceId,
        status: "voice_ready" satisfies TryItStatus,
        updated_at: new Date().toISOString(),
        metadata: {
          ...(session.metadata || {}),
          source: TRY_IT_SOURCE_META,
          scope: TRY_IT_SCOPE,
          voice_cloned_at: new Date().toISOString(),
        },
      })
      .eq("id", opts.sessionId)
      .select("*")
      .single();
    if (error || !data) throw new Error(error?.message || "Could not save voice clone");
    return data as TryItSessionRow;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await logUsage({
      userId: opts.userId,
      sessionId: opts.sessionId,
      event: "clone",
      modelTier: "elevenlabs_ivc",
      success: false,
      errorSnippet: msg,
    });
    throw e;
  }
}

async function generateBeatOnce(opts: {
  sessionId: string;
  userId: string;
  prompt: string;
  genre: string;
  tempo: number;
}): Promise<Buffer> {
  const durationSec = Math.min(TRY_IT_PREVIEW_BEAT_SEC, TRY_IT_PREVIEW_MAX_SEC);
  const provider = getMusicProvider();
  const genReq = {
    projectId: opts.sessionId,
    userId: opts.userId,
    prompt: opts.prompt,
    durationSec,
    genre: opts.genre,
    mood: "energetic",
    bpm: opts.tempo,
    kind: "preview" as const,
    instrumentalOnly: true,
  };
  if (typeof provider.generate === "function") {
    const beatResult = await provider.generate(genReq);
    return beatResult.buffer;
  }
  const submitted = await provider.submitPrediction(genReq);
  let poll = await provider.pollPrediction(submitted.providerPredictionId);
  for (let i = 0; i < 40 && poll.status !== "succeeded" && poll.status !== "failed"; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    poll = await provider.pollPrediction(submitted.providerPredictionId);
  }
  if (poll.status !== "succeeded" || !poll.outputUrl) {
    throw new Error(poll.error || "Beat generation did not complete");
  }
  const dl = await provider.downloadOutput(poll.outputUrl);
  return dl.buffer;
}

export async function generateTryItPreview(opts: {
  sessionId: string;
  userId: string;
  genre?: string;
  tempo?: number;
  lyrics?: string;
  /** Reject client attempts to request longer previews */
  requestedDurationSec?: number;
}): Promise<TryItSessionRow> {
  const session = await getTryItSession(opts.sessionId, opts.userId);
  if (!session) throw new Error("Session not found");
  if (!session.eleven_voice_id) throw new Error("Clone a voice sample first");
  if (session.status === "expired") throw new Error("Session expired");

  if (
    typeof opts.requestedDurationSec === "number" &&
    opts.requestedDurationSec > TRY_IT_PREVIEW_MAX_SEC
  ) {
    throw new Error(
      `Preview is capped at ${TRY_IT_PREVIEW_MAX_SEC} seconds — this is a short demo, not a full song`
    );
  }

  const quota = await getTryItQuota(opts.userId);
  if (quota.remaining <= 0) {
    throw new TryItQuotaError(
      "You've used your free Try It previews. Record the real version in Booth to continue."
    );
  }

  const service = createServiceClient();
  await service
    .from("try_it_sessions")
    .update({ status: "generating", error: null, updated_at: new Date().toISOString() })
    .eq("id", opts.sessionId);

  const genre = (opts.genre || "afrobeats").slice(0, 40);
  const tempo = opts.tempo && opts.tempo > 60 && opts.tempo < 200 ? opts.tempo : 100;
  // Short hook only — keeps TTS near 15–20s with Flash model
  const lyrics =
    (opts.lyrics || "").trim().slice(0, 220) ||
    "Yeah this is my sound, riding on the beat.";

  const durationSec = Math.min(TRY_IT_PREVIEW_BEAT_SEC, TRY_IT_PREVIEW_MAX_SEC);
  const prefix = tryItStoragePrefix(opts.userId, opts.sessionId);
  const prompt = buildInstrumentalPrompt({
    genre,
    mood: "energetic",
    energy: "medium",
    bpm: tempo,
    instrumentation: "drums, bass, synth, no vocals",
  });

  let lastErr: Error | null = null;
  for (let attempt = 0; attempt <= TRY_IT_MAX_PROVIDER_RETRIES; attempt++) {
    const isRetry = attempt > 0;
    try {
      // Reuse session.eleven_voice_id — never re-clone on regenerate
      const beatBuf = await generateBeatOnce({
        sessionId: opts.sessionId,
        userId: opts.userId,
        prompt,
        genre,
        tempo,
      });
      if (!beatBuf || beatBuf.length < 1000) throw new Error("Beat generation returned empty audio");

      const beatPath = `${prefix}/beat.mp3`;
      await uploadBuffer(beatPath, Buffer.from(beatBuf), "audio/mpeg");

      const { buffer: vocalBuf, modelUsed } = await synthesizeWithVoice(
        session.eleven_voice_id,
        lyrics
      );
      const vocalPath = `${prefix}/vocal.mp3`;
      await uploadBuffer(vocalPath, vocalBuf, "audio/mpeg");

      await logUsage({
        userId: opts.userId,
        sessionId: opts.sessionId,
        event: isRetry ? "generate_retry" : "generate",
        modelTier: modelUsed || TRY_IT_TTS_MODEL,
        durationSec,
        success: true,
        metadata: {
          beat_sec: durationSec,
          genre,
          voice_reused: true,
          draft_quality: true,
        },
      });

      const { data, error } = await service
        .from("try_it_sessions")
        .update({
          status: "preview_ready" satisfies TryItStatus,
          beat_path: beatPath,
          vocal_path: vocalPath,
          mix_path: null,
          genre,
          tempo,
          lyrics,
          error: null,
          updated_at: new Date().toISOString(),
          metadata: {
            ...(session.metadata || {}),
            source: TRY_IT_SOURCE_META,
            scope: TRY_IT_SCOPE,
            download_blocked: true,
            share_blocked: true,
            draft_mix: "client_layer",
            preview_duration_sec: durationSec,
            tts_model: modelUsed || TRY_IT_TTS_MODEL,
          },
        })
        .eq("id", opts.sessionId)
        .select("*")
        .single();
      if (error || !data) throw new Error(error?.message || "Could not save preview");
      return data as TryItSessionRow;
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      await logUsage({
        userId: opts.userId,
        sessionId: opts.sessionId,
        event: isRetry ? "generate_retry" : "generate",
        modelTier: TRY_IT_TTS_MODEL,
        durationSec,
        success: false,
        errorSnippet: lastErr.message,
      });
      if (attempt >= TRY_IT_MAX_PROVIDER_RETRIES) break;
      // Single automatic retry only
    }
  }

  const msg = lastErr?.message || "Generate failed";
  await service
    .from("try_it_sessions")
    .update({ status: "failed", error: msg.slice(0, 500), updated_at: new Date().toISOString() })
    .eq("id", opts.sessionId);
  throw lastErr || new Error(msg);
}

export async function signedPreviewUrls(session: TryItSessionRow): Promise<{
  beatUrl: string | null;
  vocalUrl: string | null;
}> {
  if (session.status !== "preview_ready") return { beatUrl: null, vocalUrl: null };
  const beatUrl = session.beat_path
    ? await createSignedDownloadUrl(session.beat_path, 1800)
    : null;
  const vocalUrl = session.vocal_path
    ? await createSignedDownloadUrl(session.vocal_path, 1800)
    : null;
  return { beatUrl, vocalUrl };
}

export async function discardTryItSession(sessionId: string, userId: string): Promise<void> {
  const session = await getTryItSession(sessionId, userId);
  if (!session) return;
  if (session.eleven_voice_id) await deleteTrialVoice(session.eleven_voice_id);
  const service = createServiceClient();
  await service
    .from("try_it_sessions")
    .update({
      status: "expired",
      eleven_voice_id: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", sessionId);
}
