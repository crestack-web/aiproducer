import { createServiceClient } from "@/lib/supabase/server";
import { beatPath, uploadBuffer } from "@/lib/storage";
import { buildInstrumentalPrompt } from "./provider";
import type { MusicGenerationProvider } from "./provider";
import { MockMusicProvider } from "./mock-provider";
import { ReplicateMusicProvider } from "./replicate-provider";
import { ElevenLabsMusicProvider } from "./elevenlabs-provider";
import type {
  GeneratedMusicAsset,
  GenerationKind,
  MusicGenerationPlan,
  MusicGenerationRequest,
  MusicJobStatus,
  MusicProviderName,
} from "./types";
import { MusicGenerationError, publicErrorMessage } from "./types";
import { assertBeatGenAllowed, estimateBeatCostUsd, DEFAULT_FULL_BEAT_SEC } from "./beat-quota";

export function getMusicGenerationMode(): "mock" | "provider" {
  const m = (process.env.MUSIC_GENERATION_MODE || "").toLowerCase();
  if (m === "mock") return "mock";
  if (m === "provider") return "provider";
  // Prefer real providers when keys exist
  if (
    process.env.ELEVENLABS_API_KEY?.trim() ||
    process.env.ELEVEN_API_KEY?.trim() ||
    process.env.REPLICATE_API_TOKEN?.trim()
  ) {
    return "provider";
  }
  return "mock";
}

export function getMusicProvider(): MusicGenerationProvider {
  if (getMusicGenerationMode() === "mock") return new MockMusicProvider();
  const name = (process.env.MUSIC_GENERATION_PROVIDER || "").toLowerCase().trim();
  // Explicit choice
  if (name === "replicate") return new ReplicateMusicProvider();
  if (name === "elevenlabs" || name === "eleven") return new ElevenLabsMusicProvider();
  // Auto: ElevenLabs first when key present, else Replicate, else ElevenLabs (will throw NOT_CONFIGURED)
  if (
    process.env.ELEVENLABS_API_KEY?.trim() ||
    process.env.ELEVEN_API_KEY?.trim() ||
    process.env.XI_API_KEY?.trim()
  ) {
    return new ElevenLabsMusicProvider();
  }
  if (process.env.REPLICATE_API_TOKEN?.trim()) {
    return new ReplicateMusicProvider();
  }
  return new ElevenLabsMusicProvider();
}

function limits() {
  return {
    maxPerDay: Number(process.env.MAX_GENERATIONS_PER_USER_PER_DAY || 30),
    maxPreview: Number(process.env.MAX_PREVIEW_GENERATIONS_PER_DAY || 20),
    maxFull: Number(process.env.MAX_FULL_GENERATIONS_PER_DAY || 15),
  };
}

async function assertWithinDailyLimits(userId: string, kind: GenerationKind) {
  const supabase = createServiceClient();
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  // Only successful gens count — failed attempts must not lock users out
  const { count, error } = await supabase
    .from("music_generation_jobs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("status", "COMPLETED")
    .not("audio_path", "is", null)
    .gte("created_at", since.toISOString());
  if (error) {
    console.warn("[music-gen] limit check skipped", error.message);
    return;
  }
  const lim = limits();
  // Guard against misconfigured env (0) locking everyone out
  const maxPerDay = Math.max(1, lim.maxPerDay || 20);
  const maxPreview = Math.max(1, lim.maxPreview || 15);
  const maxFull = Math.max(1, lim.maxFull || 10);
  if ((count || 0) >= maxPerDay) {
    throw new MusicGenerationError("LIMIT_EXCEEDED", "Daily generation limit reached");
  }
  const { count: kCount } = await supabase
    .from("music_generation_jobs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("kind", kind)
    .eq("status", "COMPLETED")
    .not("audio_path", "is", null)
    .gte("created_at", since.toISOString());
  const cap = kind === "preview" ? maxPreview : maxFull;
  if ((kCount || 0) >= cap) {
    throw new MusicGenerationError("LIMIT_EXCEEDED", `Daily ${kind} generation limit reached`);
  }
}

function logJob(fields: Record<string, unknown>) {
  console.info("[music-gen]", JSON.stringify(fields));
}

export function createMusicGenerationPlan(input: {
  genre?: string | null;
  mood?: string | null;
  tempo?: number | null;
  bpm?: number | null;
  key?: string | null;
  prompt?: string | null;
  energy?: string | null;
  structure?: string | null;
  instrumentation?: string | null;
  referenceStyle?: string | null;
  kind?: GenerationKind;
  durationSec?: number;
}): MusicGenerationPlan {
  const genre = input.genre || "R&B";
  const mood = input.mood || "Emotional";
  const bpm = input.bpm ?? input.tempo ?? 95;
  const energy = input.energy || undefined;
  const instrumentation = input.instrumentation || undefined;
  const referenceStyle = input.referenceStyle || undefined;
  const prompt = buildInstrumentalPrompt({
    prompt: input.prompt || undefined,
    genre,
    mood,
    bpm,
    key: input.key || undefined,
    energy,
    structure: input.structure || undefined,
    instrumentation,
    referenceStyle,
  });
  return {
    shouldGenerate: true,
    instrumentalOnly: true,
    genre,
    mood,
    bpm,
    key: input.key || undefined,
    durationSec: input.durationSec,
    kind: input.kind || "preview",
    prompt,
    reason: "instrumental foundation before recording vocals.",
    energy,
    structure: input.structure || undefined,
    instrumentation,
    referenceStyle,
  };
}

export async function enqueueMusicGeneration(
  req: MusicGenerationRequest
): Promise<{ jobId: string; status: MusicJobStatus; deduped?: boolean }> {
  const supabase = createServiceClient();
  const kind: GenerationKind = req.kind || "preview";
  const idem =
    req.idempotencyKey ||
    `music:${req.userId}:${req.projectId}:${kind}:${(req.prompt || "").slice(0, 40)}`;

  const { data: existing } = await supabase
    .from("music_generation_jobs")
    .select("id, status")
    .eq("idempotency_key", idem)
    .in("status", ["CREATED", "SUBMITTING", "GENERATING", "DOWNLOADING", "PROCESSING", "COMPLETED"])
    .maybeSingle();
  if (existing) return { jobId: existing.id, status: existing.status as MusicJobStatus, deduped: true };

  // New generation only — successful COMPLETED jobs consume quota; failures do not
  const requestedSec = Math.round(req.durationSec || DEFAULT_FULL_BEAT_SEC);
  const quotaSnap = await assertBeatGenAllowed(req.userId, requestedSec, {
    forceBillable: Boolean(req.forceBillable),
  });
  await assertWithinDailyLimits(req.userId, kind);

  const { data: project } = await supabase
    .from("projects")
    .select("id, user_id, genre, mood, tempo, prompt")
    .eq("id", req.projectId)
    .eq("user_id", req.userId)
    .maybeSingle();
  if (!project) throw new MusicGenerationError("UNAUTHORIZED", "Project not found or not owned by user");

  const plan = createMusicGenerationPlan({
    genre: req.genre ?? project.genre,
    mood: req.mood ?? project.mood,
    tempo: req.bpm ?? (project as { tempo?: number }).tempo,
    bpm: req.bpm ?? (project as { tempo?: number }).tempo,
    prompt: req.prompt ?? (project as { prompt?: string }).prompt,
    energy: req.energy,
    instrumentation: req.instrumentation,
    referenceStyle: req.referenceStyle,
    kind,
    durationSec: req.durationSec ?? requestedSec,
  });

  const provider = getMusicProvider();
  const mode = getMusicGenerationMode();

  const { data: job, error } = await supabase
    .from("music_generation_jobs")
    .insert({
      project_id: req.projectId,
      user_id: req.userId,
      status: "CREATED",
      kind,
      provider: provider.name,
      mode,
      prompt: req.editSection
        ? `${plan.prompt}\n\nSection edit focus: regenerate the ${req.editSection} region. ${req.prompt || ""}. Instrumental only. Keep continuity with surrounding sections.`
        : plan.prompt,
      genre: plan.genre,
      mood: plan.mood,
      bpm: plan.bpm,
      duration_sec: plan.durationSec,
      idempotency_key: idem,
      progress: 0,
      input_data: {
        plan,
        duration_sec: plan.durationSec ?? requestedSec,
        estimated_cost_usd: estimateBeatCostUsd(plan.durationSec ?? requestedSec),
        cost_rate_usd_per_sec: Number(process.env.ELEVENLABS_MUSIC_COST_PER_SEC_USD || 0.00583),
        free_beat_generation: !quotaSnap.billableGeneration && !quotaSnap.isPaid,
        billable_generation: Boolean(quotaSnap.billableGeneration),
      },
    })
    .select("id, status")
    .single();

  if (error || !job) {
    const { data: again } = await supabase
      .from("music_generation_jobs")
      .select("id, status")
      .eq("idempotency_key", idem)
      .maybeSingle();
    if (again) return { jobId: again.id, status: again.status as MusicJobStatus, deduped: true };
    throw error || new Error("Could not create music generation job");
  }

  logJob({ event: "enqueued", generationJobId: job.id, songId: req.projectId, provider: provider.name, mode, kind });
  void tickMusicGenerationJob(job.id).catch((e) => {
    console.error("[music-gen] tick failed", job.id, e instanceof Error ? e.message : e);
  });
  return { jobId: job.id, status: "CREATED" };
}

export async function tickMusicGenerationJob(jobId: string) {
  const supabase = createServiceClient();
  const { data: job } = await supabase.from("music_generation_jobs").select("*").eq("id", jobId).single();
  if (!job) throw new MusicGenerationError("NOT_FOUND", "Job not found");
  if (["COMPLETED", "FAILED", "CANCELLED"].includes(job.status)) return job;

  const provider = getMusicProvider();
  const started = Date.now();

  try {
    await supabase.from("music_generation_jobs").update({ status: "SUBMITTING", progress: 10, stage: "submit" }).eq("id", jobId);

    if (provider.checkAvailability && getMusicGenerationMode() === "provider") {
      try {
        await provider.checkAvailability();
      } catch (e) {
        if (e instanceof MusicGenerationError && e.errorType !== "BILLING_REQUIRED") throw e;
      }
    }

    const prompt = job.prompt as string;
    const genReq: MusicGenerationRequest & { prompt: string } = {
      projectId: job.project_id,
      userId: job.user_id,
      prompt,
      genre: job.genre,
      mood: job.mood,
      bpm: job.bpm,
      durationSec: job.duration_sec,
      kind: job.kind as GenerationKind,
      instrumentalOnly: true,
    };

    await supabase.from("music_generation_jobs").update({ status: "GENERATING", progress: 30, stage: "generate" }).eq("id", jobId);

    let result;
    if (provider.generate) {
      try {
        result = await provider.generate(genReq);
      } catch (genErr) {
        const isAuth =
          genErr instanceof MusicGenerationError &&
          (genErr.errorType === "AUTHENTICATION_ERROR" || genErr.errorType === "NOT_CONFIGURED");
        if (
          isAuth &&
          provider.name === "elevenlabs" &&
          process.env.REPLICATE_API_TOKEN?.trim() &&
          process.env.MUSIC_GENERATION_FALLBACK_REPLICATE !== "0"
        ) {
          console.warn("[music-gen] ElevenLabs auth failed; falling back to Replicate");
          const fallback = new ReplicateMusicProvider();
          await supabase
            .from("music_generation_jobs")
            .update({ provider: fallback.name, stage: "generate_fallback" })
            .eq("id", jobId);
          if (!fallback.generate) throw genErr;
          result = await fallback.generate(genReq);
        } else {
          throw genErr;
        }
      }
    } else {
      const submitted = await provider.submitPrediction(genReq);
      await supabase.from("music_generation_jobs").update({ provider_prediction_id: submitted.providerPredictionId }).eq("id", jobId);
      let poll = await provider.pollPrediction(submitted.providerPredictionId);
      for (let i = 0; i < 60; i++) {
        if (poll.status === "succeeded" || poll.status === "failed" || poll.status === "canceled") break;
        await new Promise((r) => setTimeout(r, 2500));
        poll = await provider.pollPrediction(submitted.providerPredictionId);
      }
      if (poll.status !== "succeeded" || !poll.outputUrl) {
        throw new MusicGenerationError("TIMEOUT", `Prediction ${poll.status}`, { provider: provider.name as MusicProviderName });
      }
      const file = await provider.downloadOutput(poll.outputUrl);
      result = {
        buffer: file.buffer,
        contentType: file.contentType,
        extension: file.extension,
        durationSec: job.duration_sec || 8,
        providerPredictionId: submitted.providerPredictionId,
        model: provider.name,
        outputUrl: poll.outputUrl,
      };
    }

    await supabase
      .from("music_generation_jobs")
      .update({
        status: "DOWNLOADING",
        progress: 70,
        stage: "download",
        provider_prediction_id: result.providerPredictionId,
        provider_model: result.model,
      })
      .eq("id", jobId);

    if (!result.buffer || result.buffer.length < 500) {
      throw new MusicGenerationError("AUDIO_VALIDATION_ERROR", "Audio buffer too small");
    }

    await supabase.from("music_generation_jobs").update({ status: "PROCESSING", progress: 85, stage: "store" }).eq("id", jobId);

    // RoEx mix requires stereo WAV — convert generated MP3 at store time when ffmpeg is available
    let storeBuf = result.buffer;
    let storeExt = result.extension || "mp3";
    let storeCt = result.contentType || "audio/mpeg";
    try {
      const { convertBufferToWav } = await import("@/lib/audio/convert-to-wav");
      const { ensureStereoWavForRoex, isWavBuffer } = await import("@/lib/audio/wav");
      if (!isWavBuffer(storeBuf)) {
        const conv = await convertBufferToWav(storeBuf, `generated.${storeExt}`);
        storeBuf = ensureStereoWavForRoex(conv.buffer);
      } else {
        storeBuf = ensureStereoWavForRoex(storeBuf);
      }
      storeExt = "wav";
      storeCt = "audio/wav";
    } catch (convErr) {
      console.warn("[music-gen] beat WAV convert deferred", convErr);
      // keep original; produce will try again
    }
    const path = beatPath(job.user_id, job.project_id, `generated-${job.kind}-${jobId.slice(0, 8)}.${storeExt}`);
    await uploadBuffer(path, storeBuf, storeCt);

    const beatPayload = {
      project_id: job.project_id,
      audio_path: path,
      duration_ms: Math.round((result.durationSec || 8) * 1000),
      tempo: job.bpm,
      status: "ready",
      source: "ai",
      generation_prompt: prompt,
      metadata: {
        type: "INSTRUMENTAL",
        provider: provider.name,
        model: result.model,
        kind: job.kind,
        music_generation_job_id: jobId,
        provider_prediction_id: result.providerPredictionId,
      },
    };

    let beatId: string;
    const { data: beat, error: bErr } = await supabase.from("beats").insert(beatPayload).select().single();
    if (bErr) {
      const { data: fb, error: fbErr } = await supabase
        .from("beats")
        .insert({
          project_id: job.project_id,
          audio_path: path,
          duration_ms: beatPayload.duration_ms,
          status: "ready",
          metadata: beatPayload.metadata,
        })
        .select()
        .single();
      if (fbErr || !fb) throw fbErr || new Error("beat insert failed");
      beatId = fb.id;
    } else {
      beatId = beat.id;
    }

    await supabase
      .from("music_generation_jobs")
      .update({
        status: "COMPLETED",
        progress: 100,
        stage: "complete",
        audio_path: path,
        beat_id: beatId,
        duration_ms: Math.round(result.durationSec * 1000),
        provider_prediction_id: result.providerPredictionId,
        provider_model: result.model,
        completed_at: new Date().toISOString(),
        processing_ms: Date.now() - started,
      })
      .eq("id", jobId);

    {
      const { data: projRow } = await supabase
        .from("projects")
        .select("metadata")
        .eq("id", job.project_id)
        .maybeSingle();
      const prevMeta =
        projRow?.metadata && typeof projRow.metadata === "object"
          ? (projRow.metadata as Record<string, unknown>)
          : {};
      const input =
        job.input_data && typeof job.input_data === "object"
          ? (job.input_data as Record<string, unknown>)
          : {};
      const billable = input.billable_generation === true;
      const freeSlot = input.free_beat_generation === true || (!billable && !input.billable_generation);
      const costUsd =
        typeof input.estimated_cost_usd === "number"
          ? input.estimated_cost_usd
          : estimateBeatCostUsd(Number(job.duration_sec) || result.durationSec || 60);
      const nextMeta: Record<string, unknown> = {
        ...prevMeta,
        free_beat_generation: freeSlot && !billable,
        free_beat_slot: freeSlot && !billable,
        beat_generation_billable: billable,
        beat_cost_usd: billable ? costUsd : prevMeta.beat_cost_usd ?? 0,
        beat_duration_sec: result.durationSec || job.duration_sec,
      };
      await supabase
        .from("projects")
        .update({ status: "beat_ready", metadata: nextMeta })
        .eq("id", job.project_id);
    }

    logJob({
      event: "completed",
      generationJobId: jobId,
      songId: job.project_id,
      provider: provider.name,
      model: result.model,
      providerPredictionId: result.providerPredictionId,
      processingTime: Date.now() - started,
    });
    return beatId;
  } catch (e) {
    const err =
      e instanceof MusicGenerationError
        ? e
        : new MusicGenerationError("PROVIDER_ERROR", e instanceof Error ? e.message : "Generation failed", {
            provider: provider.name as MusicProviderName,
          });
    logJob({ event: "failed", generationJobId: jobId, provider: provider.name, errorType: err.errorType });
    await supabase
      .from("music_generation_jobs")
      .update({
        status: "FAILED",
        error_type: err.errorType,
        error_message: err.message || publicErrorMessage(err.errorType),
        progress: 100,
        completed_at: new Date().toISOString(),
      })
      .eq("id", jobId);
    await supabase.from("projects").update({ status: "failed" }).eq("id", job.project_id);
    throw err;
  }
}

export async function getMusicGenerationJob(jobId: string, userId: string) {
  const supabase = createServiceClient();
  const { data: job } = await supabase
    .from("music_generation_jobs")
    .select("*")
    .eq("id", jobId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!job) throw new MusicGenerationError("NOT_FOUND", "Job not found");

  const result: GeneratedMusicAsset | null =
    job.status === "COMPLETED" && job.audio_path
      ? {
          assetId: job.beat_id || job.id,
          projectId: job.project_id,
          type: "INSTRUMENTAL",
          audioPath: job.audio_path,
          durationMs: job.duration_ms,
          provider: job.provider,
          model: job.provider_model,
          status: "COMPLETED",
          kind: job.kind,
          metadata: { jobId: job.id },
        }
      : null;

  return {
    jobId: job.id,
    status: job.status as MusicJobStatus,
    progress: job.progress,
    kind: job.kind,
    provider: job.provider,
    errorType: job.error_type,
    error: job.error_message,
    result,
  };
}

export { publicErrorMessage, MusicGenerationError };
