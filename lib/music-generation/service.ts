import { createServiceClient } from "@/lib/supabase/server";
import { beatPath, uploadBuffer } from "@/lib/storage";
import { buildInstrumentalPrompt } from "./provider";
import type { MusicGenerationProvider } from "./provider";
import { MockMusicProvider } from "./mock-provider";
import { ReplicateMusicProvider } from "./replicate-provider";
import type {
  GeneratedMusicAsset,
  GenerationKind,
  MusicGenerationPlan,
  MusicGenerationRequest,
  MusicJobStatus,
  MusicProviderName,
} from "./types";
import { MusicGenerationError, publicErrorMessage } from "./types";

export function getMusicGenerationMode(): "mock" | "provider" {
  const m = (process.env.MUSIC_GENERATION_MODE || "").toLowerCase();
  if (m === "mock") return "mock";
  if (m === "provider") return "provider";
  if (!process.env.REPLICATE_API_TOKEN) return "mock";
  return "provider";
}

export function getMusicProvider(): MusicGenerationProvider {
  if (getMusicGenerationMode() === "mock") return new MockMusicProvider();
  const name = (process.env.MUSIC_GENERATION_PROVIDER || "replicate").toLowerCase();
  if (name === "replicate") return new ReplicateMusicProvider();
  return new ReplicateMusicProvider();
}

function limits() {
  return {
    maxPerDay: Number(process.env.MAX_GENERATIONS_PER_USER_PER_DAY || 20),
    maxPreview: Number(process.env.MAX_PREVIEW_GENERATIONS_PER_DAY || 15),
    maxFull: Number(process.env.MAX_FULL_GENERATIONS_PER_DAY || 5),
  };
}

async function assertWithinDailyLimits(userId: string, kind: GenerationKind) {
  const supabase = createServiceClient();
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  const { count, error } = await supabase
    .from("music_generation_jobs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", since.toISOString())
    .neq("status", "CANCELLED");
  if (error) {
    console.warn("[music-gen] limit check skipped", error.message);
    return;
  }
  const lim = limits();
  if ((count || 0) >= lim.maxPerDay) {
    throw new MusicGenerationError("LIMIT_EXCEEDED", "Daily generation limit reached");
  }
  const { count: kCount } = await supabase
    .from("music_generation_jobs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("kind", kind)
    .gte("created_at", since.toISOString())
    .neq("status", "CANCELLED");
  const cap = kind === "preview" ? lim.maxPreview : lim.maxFull;
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
  key?: string | null;
  prompt?: string | null;
  energy?: string | null;
  kind?: GenerationKind;
}): MusicGenerationPlan {
  const genre = input.genre || "R&B";
  const mood = input.mood || "Emotional";
  const bpm = input.tempo || 95;
  const kind = input.kind || "preview";
  const prompt = buildInstrumentalPrompt({
    prompt: input.prompt || undefined,
    genre,
    mood,
    bpm,
    key: input.key || undefined,
    energy: input.energy || undefined,
  });
  return {
    shouldGenerate: true,
    instrumentalOnly: true,
    genre,
    mood,
    bpm,
    key: input.key || undefined,
    durationSec: kind === "full" ? 24 : 8,
    kind,
    prompt,
    reason: "The user needs an instrumental foundation before recording vocals.",
    energy: input.energy || undefined,
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
    tempo: req.bpm ?? project.tempo,
    key: req.key,
    prompt: req.prompt ?? project.prompt,
    energy: req.energy,
    kind,
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
      prompt: plan.prompt,
      genre: plan.genre,
      mood: plan.mood,
      bpm: plan.bpm,
      duration_sec: plan.durationSec,
      idempotency_key: idem,
      progress: 0,
      input_data: { plan },
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
      result = await provider.generate(genReq);
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

    const path = beatPath(job.user_id, job.project_id, `generated-${job.kind}-${jobId.slice(0, 8)}.${result.extension}`);
    await uploadBuffer(path, result.buffer, result.contentType);

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

    await supabase.from("projects").update({ status: "beat_ready" }).eq("id", job.project_id);

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
        error_message: publicErrorMessage(err.errorType),
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
