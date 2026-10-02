/**
 * Add Instrument — Mureka complementary track (drums, bass, guitar, …).
 * Explicit user action only. One request per click.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { MusicGenerationError, publicErrorMessage } from "@/lib/music-generation/types";
import { murekaSubmitAddInstrument } from "@/lib/music-generation/mureka-provider";
import { buildAddInstrumentPrompt } from "@/lib/music-generation/producer-spec";
import { isMurekaConfigured } from "@/lib/music-generation/mureka-client";

export const runtime = "nodejs";
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

const Body = z.object({
  instrument: z
    .enum(["drums", "bass", "guitar", "keys", "piano", "percussion", "synth", "strings", "fx"])
    .default("guitar"),
  direction: z.string().max(500).optional(),
});

export async function POST(req: Request, ctx: Ctx) {
  try {
    const { user, error: authError } = await requireUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { id: projectId } = await ctx.params;
    if (!isMurekaConfigured()) {
      return NextResponse.json(
        { error: "Add Instrument is not available yet (Mureka not configured)." },
        { status: 503 }
      );
    }

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid instrument request" }, { status: 400 });
    }
    const { instrument, direction } = parsed.data;

    const service = createServiceClient();
    const { data: project } = await service
      .from("projects")
      .select("id, user_id, genre, mood, tempo, prompt")
      .eq("id", projectId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    const { data: inflight } = await service
      .from("music_generation_jobs")
      .select("id, status")
      .eq("project_id", projectId)
      .eq("kind", "add_instrument")
      .in("status", ["CREATED", "SUBMITTING", "GENERATING", "DOWNLOADING", "PROCESSING"])
      .maybeSingle();
    if (inflight) {
      return NextResponse.json({
        jobId: inflight.id,
        status: inflight.status,
        deduped: true,
        message: "An instrument generation is already running for this song.",
      });
    }

    const prompt = buildAddInstrumentPrompt(instrument, {
      genre: project.genre,
      mood: project.mood,
      bpm: project.tempo ? Number(project.tempo) : null,
      artistDirection: direction || undefined,
      vocalSpace: true,
      commercial: true,
    });

    const submitted = await murekaSubmitAddInstrument({
      prompt,
      trackType: "instrument",
    });

    const { data: job, error } = await service
      .from("music_generation_jobs")
      .insert({
        project_id: projectId,
        user_id: user.id,
        status: "GENERATING",
        kind: "add_instrument",
        provider: "mureka",
        provider_prediction_id: submitted.providerPredictionId,
        provider_model: submitted.model,
        prompt,
        genre: project.genre,
        mood: project.mood,
        bpm: project.tempo ? Number(project.tempo) : null,
        metadata: { ...submitted.metadata, instrument },
      })
      .select("id, status")
      .single();

    if (error || !job) {
      console.error("[add-instrument] insert failed", error);
      return NextResponse.json({ error: "Could not create generation job" }, { status: 500 });
    }

    return NextResponse.json({
      jobId: job.id,
      status: job.status,
      instrument,
      message: `Adding ${instrument}…`,
    });
  } catch (e) {
    if (e instanceof MusicGenerationError) {
      return NextResponse.json(
        { error: publicErrorMessage(e.errorType), errorType: e.errorType, details: e.details },
        { status: e.errorType === "UNAUTHORIZED" ? 401 : 502 }
      );
    }
    console.error("[add-instrument]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Add instrument failed" },
      { status: 500 }
    );
  }
}
