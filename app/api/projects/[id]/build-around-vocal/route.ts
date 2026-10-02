/**
 * Build Around My Vocal — Mureka accompaniment from an artist vocal take.
 * Explicit user action only. Does not replace the original vocal on the timeline.
 */
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { MusicGenerationError, publicErrorMessage } from "@/lib/music-generation/types";
import { murekaSubmitAroundVocal } from "@/lib/music-generation/mureka-provider";
import { buildInstrumentalPrompt } from "@/lib/music-generation/producer-spec";
import { isMurekaConfigured } from "@/lib/music-generation/mureka-client";
import { createSignedDownloadUrl } from "@/lib/storage";

export const runtime = "nodejs";
export const maxDuration = 120;

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  try {
    const { user, error: authError } = await requireUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { id: projectId } = await ctx.params;
    if (!isMurekaConfigured()) {
      return NextResponse.json(
        { error: "Build Around My Vocal is not available yet (Mureka not configured)." },
        { status: 503 }
      );
    }

    const service = createServiceClient();
    const { data: project } = await service
      .from("projects")
      .select("id, user_id, genre, mood, tempo, prompt, metadata")
      .eq("id", projectId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const recordingPath = typeof body.recording_path === "string" ? body.recording_path : null;
    const recordingId = typeof body.recording_id === "string" ? body.recording_id : null;

    let audioPath = recordingPath;
    if (!audioPath && recordingId) {
      const { data: rec } = await service
        .from("recordings")
        .select("audio_path, project_id")
        .eq("id", recordingId)
        .maybeSingle();
      if (!rec || rec.project_id !== projectId) {
        return NextResponse.json({ error: "Recording not found" }, { status: 404 });
      }
      audioPath = rec.audio_path;
    }
    if (!audioPath) {
      return NextResponse.json(
        { error: "Provide recording_id or recording_path of your vocal take." },
        { status: 400 }
      );
    }

    // Load vocal bytes via signed URL
    const signedUrl = await createSignedDownloadUrl(audioPath, 300);
    if (!signedUrl) {
      return NextResponse.json({ error: "Could not read vocal audio" }, { status: 500 });
    }
    const audioRes = await fetch(signedUrl);
    if (!audioRes.ok) {
      return NextResponse.json({ error: "Could not download vocal audio" }, { status: 500 });
    }
    const vocalBuffer = Buffer.from(await audioRes.arrayBuffer());

    const prompt = buildInstrumentalPrompt({
      genre: project.genre,
      mood: project.mood,
      bpm: project.tempo ? Number(project.tempo) : null,
      artistDirection:
        typeof body.direction === "string"
          ? body.direction
          : "Build a full production around this artist vocal. Keep midrange open. Strong groove.",
      vocalSpace: true,
      commercial: true,
    });

    // Idempotency: one active around_vocal job per project
    const { data: existing } = await service
      .from("music_generation_jobs")
      .select("id, status")
      .eq("project_id", projectId)
      .eq("kind", "around_vocal")
      .in("status", ["CREATED", "SUBMITTING", "GENERATING", "DOWNLOADING", "PROCESSING"])
      .maybeSingle();
    if (existing) {
      return NextResponse.json({
        jobId: existing.id,
        status: existing.status,
        deduped: true,
        message: "A Build Around My Vocal job is already running for this song.",
      });
    }

    const submitted = await murekaSubmitAroundVocal({
      vocalBuffer,
      filename: "vocal.mp3",
      prompt,
    });

    const { data: job, error } = await service
      .from("music_generation_jobs")
      .insert({
        project_id: projectId,
        user_id: user.id,
        status: "GENERATING",
        kind: "around_vocal",
        provider: "mureka",
        provider_prediction_id: submitted.providerPredictionId,
        provider_model: submitted.model,
        prompt,
        genre: project.genre,
        mood: project.mood,
        bpm: project.tempo ? Number(project.tempo) : null,
        metadata: {
          ...submitted.metadata,
          source_recording_path: audioPath,
          source_recording_id: recordingId,
        },
      })
      .select("id, status")
      .single();

    if (error || !job) {
      console.error("[build-around-vocal] insert failed", error);
      return NextResponse.json({ error: "Could not create generation job" }, { status: 500 });
    }

    return NextResponse.json({
      jobId: job.id,
      status: job.status,
      message: "Building a production around your vocal…",
    });
  } catch (e) {
    if (e instanceof MusicGenerationError) {
      return NextResponse.json(
        { error: publicErrorMessage(e.errorType), errorType: e.errorType, details: e.details },
        { status: e.errorType === "UNAUTHORIZED" ? 401 : 502 }
      );
    }
    console.error("[build-around-vocal]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Build around vocal failed" },
      { status: 500 }
    );
  }
}
