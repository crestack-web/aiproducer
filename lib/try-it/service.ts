/**
 * Try It orchestration — isolated from Record / produce.
 * Hard cost controls: short section, per-user generate cap, real take only, usage log.
 */
import { createServiceClient } from "@/lib/supabase/server";
import { createSignedDownloadUrl, uploadBuffer, downloadStorageObject } from "@/lib/storage";
import {
  TRY_IT_MAX_GENERATES_PER_USER,
  TRY_IT_MAX_PROVIDER_RETRIES,
  TRY_IT_MAX_SAMPLE_MS,
  TRY_IT_MIN_SAMPLE_MS,
  TRY_IT_PREVIEW_MAX_SEC,
  TRY_IT_SCOPE,
  TRY_IT_SOURCE_META,
  TRY_IT_TTL_HOURS,
  isTryItEnabled,
  tryItStoragePrefix,
} from "./config";
import { deleteTrialVoice } from "./elevenlabs-ivc";
import { produceFromVocalTake } from "./from-vocal";
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
    throw new Error("Take too short — sing at least 10 seconds of a hook or verse");
  }
  if (opts.durationMs > TRY_IT_MAX_SAMPLE_MS) {
    throw new Error("Take too long — keep the demo under 2 minutes");
  }
  if (opts.buffer.length < 2000) throw new Error("Recording is empty or invalid");

  const prefix = tryItStoragePrefix(opts.userId, opts.sessionId);
  const ext = (opts.filename.split(".").pop() || "webm").toLowerCase().slice(0, 5);
  const samplePath = `${prefix}/sample.${ext}`;
  await uploadBuffer(samplePath, opts.buffer, opts.contentType || "audio/webm");

  const service = createServiceClient();
  // No voice clone — this is the artist's real sung take for a produce demo
  const { data, error } = await service
    .from("try_it_sessions")
    .update({
      sample_path: samplePath,
      eleven_voice_id: null,
      status: "voice_ready" satisfies TryItStatus,
      error: null,
      updated_at: new Date().toISOString(),
      metadata: {
        ...(session.metadata || {}),
        source: TRY_IT_SOURCE_META,
        scope: TRY_IT_SCOPE,
        pipeline: "from_vocal_take",
        sample_duration_ms: opts.durationMs,
        sample_content_type: opts.contentType,
        no_clone: true,
      },
    })
    .eq("id", opts.sessionId)
    .select("*")
    .single();
  if (error || !data) throw new Error(error?.message || "Could not save take");

  await logUsage({
    userId: opts.userId,
    sessionId: opts.sessionId,
    event: "clone",
    modelTier: "none_sample_only",
    success: true,
    metadata: { sample_duration_ms: opts.durationMs, no_clone: true },
  });

  return data as TryItSessionRow;
}

export async function generateTryItPreview(opts: {
  sessionId: string;
  userId: string;
  genre?: string;
  tempo?: number;
  lyrics?: string;
  section?: "chorus" | "verse";
  requestedDurationSec?: number;
  /** Optional client-decoded WAV of the take (more reliable than server webm decode) */
  clientWav?: Buffer | null;
}): Promise<TryItSessionRow> {
  const session = await getTryItSession(opts.sessionId, opts.userId);
  if (!session) throw new Error("Session not found");
  if (session.status === "expired") throw new Error("Session expired");
  if (!session.sample_path && !opts.clientWav) {
    throw new Error("Record a short sung take first — we'll build a beat around your voice");
  }

  if (
    typeof opts.requestedDurationSec === "number" &&
    opts.requestedDurationSec > TRY_IT_PREVIEW_MAX_SEC
  ) {
    throw new Error(
      `Preview is capped at ${TRY_IT_PREVIEW_MAX_SEC} seconds — this is a short demo section`
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
  const tempoHint =
    opts.tempo && opts.tempo >= 70 && opts.tempo <= 180 ? opts.tempo : null;
  const prefix = tryItStoragePrefix(opts.userId, opts.sessionId);

  let lastErr: Error | null = null;
  for (let attempt = 0; attempt <= TRY_IT_MAX_PROVIDER_RETRIES; attempt++) {
    const isRetry = attempt > 0;
    try {
      let sampleBuf: Buffer;
      let pathHint = session.sample_path || "sample.wav";
      if (opts.clientWav && opts.clientWav.length > 100) {
        sampleBuf = opts.clientWav;
        pathHint = "client.wav";
      } else if (session.sample_path) {
        sampleBuf = await downloadStorageObject(session.sample_path);
      } else {
        throw new Error("No sung take on this session");
      }

      const produced = await produceFromVocalTake({
        sampleBuffer: sampleBuf,
        pathHint,
        sessionId: opts.sessionId,
        userId: opts.userId,
        genre,
        tempoHint,
        addChoir: true,
      });

      const mixPath = `${prefix}/section-mix.wav`;
      await uploadBuffer(mixPath, produced.mixWav, "audio/wav");

      await logUsage({
        userId: opts.userId,
        sessionId: opts.sessionId,
        event: isRetry ? "generate_retry" : "generate",
        modelTier: "from_vocal+instrumental+choir_light",
        durationSec: produced.durationSec,
        success: true,
        metadata: {
          pipeline: "from_vocal_take",
          bpm: produced.bpm,
          window_start_ms: produced.windowStartMs,
          used_choir: produced.usedChoir,
          vocal_rms: produced.vocalRms,
        },
      });

      const { data, error } = await service
        .from("try_it_sessions")
        .update({
          status: "preview_ready" satisfies TryItStatus,
          beat_path: null,
          vocal_path: null,
          mix_path: mixPath,
          genre,
          tempo: produced.bpm,
          lyrics: (opts.lyrics || "").slice(0, 280) || null,
          error: null,
          updated_at: new Date().toISOString(),
          metadata: {
            ...(session.metadata || {}),
            source: TRY_IT_SOURCE_META,
            scope: TRY_IT_SCOPE,
            download_blocked: true,
            share_blocked: true,
            pipeline: "from_vocal_take",
            bpm: produced.bpm,
            window_start_ms: produced.windowStartMs,
            used_choir: produced.usedChoir,
            preview_duration_sec: produced.durationSec,
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
        modelTier: "from_vocal_take",
        durationSec: TRY_IT_PREVIEW_MAX_SEC,
        success: false,
        errorSnippet: lastErr.message,
      });
      if (attempt >= TRY_IT_MAX_PROVIDER_RETRIES) break;
    }
  }

  const msg = lastErr?.message || "Produce preview failed";
  await service
    .from("try_it_sessions")
    .update({ status: "failed", error: msg.slice(0, 500), updated_at: new Date().toISOString() })
    .eq("id", opts.sessionId);
  throw lastErr || new Error(msg);
}

export async function signedPreviewUrls(session: TryItSessionRow): Promise<{
  mixUrl: string | null;
  beatUrl: string | null;
  vocalUrl: string | null;
}> {
  if (session.status !== "preview_ready") {
    return { mixUrl: null, beatUrl: null, vocalUrl: null };
  }
  // Option A: single mixed section
  if (session.mix_path) {
    const mixUrl = await createSignedDownloadUrl(session.mix_path, 1800);
    return { mixUrl, beatUrl: null, vocalUrl: null };
  }
  // Legacy dual-stream (pre Option A)
  const beatUrl = session.beat_path
    ? await createSignedDownloadUrl(session.beat_path, 1800)
    : null;
  const vocalUrl = session.vocal_path
    ? await createSignedDownloadUrl(session.vocal_path, 1800)
    : null;
  return { mixUrl: null, beatUrl, vocalUrl };
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
