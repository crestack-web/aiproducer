import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import {
  enqueueMusicGeneration,
  getMusicGenerationJob,
  tickMusicGenerationJob,
  MusicGenerationError,
  publicErrorMessage,
} from "@/lib/music-generation/service";

type Ctx = { params: Promise<{ id: string }> };

const BodySchema = z.object({
  genre: z.string().max(60).optional(),
  mood: z.string().max(60).optional(),
  tempo: z.number().int().min(40).max(200).optional(),
  prompt: z.string().max(2000).optional(),
  length_ms: z.number().int().min(3000).max(180000).optional(),
  kind: z.enum(["preview", "full"]).optional(),
  idempotencyKey: z.string().max(200).optional(),
});

export async function POST(req: Request, ctx: Ctx) {
  const { id: projectId } = await ctx.params;
  const { user, error } = await requireUser();
  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const kind = parsed.data.kind || "preview";
  const durationSec = parsed.data.length_ms
    ? Math.round(parsed.data.length_ms / 1000)
    : kind === "full"
      ? 24
      : 8;

  const service = createServiceClient();

  try {
    // Mark project as generating so the UI can poll correctly
    await service
      .from("projects")
      .update({ status: "generating_beat" })
      .eq("id", projectId)
      .eq("user_id", user.id);

    const enqueued = await enqueueMusicGeneration({
      projectId,
      userId: user.id,
      genre: parsed.data.genre,
      mood: parsed.data.mood,
      bpm: parsed.data.tempo,
      prompt: parsed.data.prompt,
      durationSec,
      kind,
      instrumentalOnly: true,
      idempotencyKey:
        parsed.data.idempotencyKey || `beat:${user.id}:${projectId}:${kind}`,
    });

    // Drive the job to completion (or failure) within this request.
    // Mock is instant; provider mode may need a few polls.
    let job = await getMusicGenerationJob(enqueued.jobId, user.id);
    const terminal = new Set(["COMPLETED", "FAILED", "CANCELLED"]);

    for (let i = 0; i < 24 && !terminal.has(job.status); i++) {
      try {
        await tickMusicGenerationJob(enqueued.jobId);
      } catch {
        // recorded on job row
      }
      job = await getMusicGenerationJob(enqueued.jobId, user.id);
      if (terminal.has(job.status)) break;
      await new Promise((r) => setTimeout(r, 1500));
    }

    if (job.status === "FAILED") {
      return NextResponse.json(
        {
          error: job.error || publicErrorMessage((job.errorType as never) || "PROVIDER_ERROR"),
          errorType: job.errorType,
          job_id: job.jobId,
          status: job.status,
        },
        { status: job.errorType === "BILLING_REQUIRED" ? 503 : 500 }
      );
    }

    if (job.status !== "COMPLETED" || !job.result) {
      // Still running — client should land on project page and poll
      return NextResponse.json({
        job_id: job.jobId,
        status: "processing",
        beat: null,
        provider: job.provider,
        music_job: job,
        message: "Beat is still generating. Open the project to wait for it.",
      });
    }

    return NextResponse.json({
      job_id: job.jobId,
      status: "complete",
      beat: {
        id: job.result.assetId,
        audio_path: job.result.audioPath,
        duration_ms: job.result.durationMs,
        status: "ready",
      },
      provider: job.provider,
      music_job: job,
    });
  } catch (e) {
    await service
      .from("projects")
      .update({ status: "failed" })
      .eq("id", projectId)
      .eq("user_id", user.id)
      .catch(() => undefined);

    if (e instanceof MusicGenerationError) {
      return NextResponse.json(
        { error: publicErrorMessage(e.errorType), errorType: e.errorType },
        {
          status:
            e.errorType === "BILLING_REQUIRED"
              ? 503
              : e.errorType === "LIMIT_EXCEEDED"
                ? 429
                : e.errorType === "UNAUTHORIZED"
                  ? 403
                  : 500,
        }
      );
    }
    const msg = e instanceof Error ? e.message : "Beat generation failed";
    console.error("generate-beat", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
