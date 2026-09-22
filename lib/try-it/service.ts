/**
 * Try It orchestration — isolated from Record / produce.
 */
import { createServiceClient } from "@/lib/supabase/server";
import {
  createSignedDownloadUrl,
  downloadStorageObject,
  uploadBuffer,
} from "@/lib/storage";
import { getMusicProvider } from "@/lib/music-generation/service";
import { buildInstrumentalPrompt } from "@/lib/music-generation/provider";
import {
  TRY_IT_MAX_SAMPLE_MS,
  TRY_IT_MIN_SAMPLE_MS,
  TRY_IT_PREVIEW_BEAT_SEC,
  TRY_IT_SCOPE,
  TRY_IT_SOURCE_META,
  TRY_IT_TTL_HOURS,
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

function expiresAtIso(): string {
  return new Date(Date.now() + TRY_IT_TTL_HOURS * 3600 * 1000).toISOString();
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
    await service
      .from("try_it_sessions")
      .update({ status: "expired" })
      .eq("id", sessionId);
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

  // Delete previous trial voice if re-cloning
  if (session.eleven_voice_id) {
    await deleteTrialVoice(session.eleven_voice_id);
  }

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
}

export async function generateTryItPreview(opts: {
  sessionId: string;
  userId: string;
  genre?: string;
  tempo?: number;
  lyrics?: string;
}): Promise<TryItSessionRow> {
  const session = await getTryItSession(opts.sessionId, opts.userId);
  if (!session) throw new Error("Session not found");
  if (!session.eleven_voice_id) throw new Error("Clone a voice sample first");
  if (session.status === "expired") throw new Error("Session expired");

  const service = createServiceClient();
  await service
    .from("try_it_sessions")
    .update({ status: "generating", error: null, updated_at: new Date().toISOString() })
    .eq("id", opts.sessionId);

  const genre = (opts.genre || "afrobeats").slice(0, 40);
  const tempo = opts.tempo && opts.tempo > 60 && opts.tempo < 200 ? opts.tempo : 100;
  const lyrics =
    (opts.lyrics || "").trim().slice(0, 400) ||
    "Yeah, this is my sound, riding on the beat, feel the night, feel the heat.";

  const prefix = tryItStoragePrefix(opts.userId, opts.sessionId);

  try {
    // 1) Short instrumental via existing music provider (Epi / ElevenLabs path)
    const provider = getMusicProvider();
    const prompt = buildInstrumentalPrompt({
      genre,
      mood: "energetic",
      energy: "medium",
      bpm: tempo,
      instrumentation: "drums, bass, synth, no vocals",
    });
    const genReq = {
      projectId: opts.sessionId,
      userId: opts.userId,
      prompt,
      durationSec: TRY_IT_PREVIEW_BEAT_SEC,
      genre,
      mood: "energetic",
      bpm: tempo,
      kind: "preview" as const,
      instrumentalOnly: true,
    };
    let beatBuf: Buffer;
    if (typeof provider.generate === "function") {
      const beatResult = await provider.generate(genReq);
      beatBuf = beatResult.buffer;
    } else {
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
      beatBuf = dl.buffer;
    }
    if (!beatBuf || beatBuf.length < 1000) throw new Error("Beat generation returned empty audio");
    const beatPath = `${prefix}/beat.mp3`;
    await uploadBuffer(beatPath, Buffer.from(beatBuf), "audio/mpeg");

    // 2) Vocal from trial clone (TTS draft — not full Record pipeline)
    const { buffer: vocalBuf } = await synthesizeWithVoice(session.eleven_voice_id, lyrics);
    const vocalPath = `${prefix}/vocal.mp3`;
    await uploadBuffer(vocalPath, vocalBuf, "audio/mpeg");

    // 3) Draft "mix": store both; client layers for preview (no produce engine)
    // Mark metadata so export/download can refuse try-it assets
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
        },
      })
      .eq("id", opts.sessionId)
      .select("*")
      .single();
    if (error || !data) throw new Error(error?.message || "Could not save preview");
    return data as TryItSessionRow;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await service
      .from("try_it_sessions")
      .update({ status: "failed", error: msg.slice(0, 500), updated_at: new Date().toISOString() })
      .eq("id", opts.sessionId);
    throw e;
  }
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

/** Discard trial voice when user starts real Record (never merges into profile). */
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
