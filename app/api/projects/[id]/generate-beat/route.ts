import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { isDevMode } from "@/lib/env";
import { beatPath, uploadBuffer } from "@/lib/storage";
import { mockWavBuffer } from "@/lib/dev-mock";

type Ctx = { params: Promise<{ id: string }> };

const BodySchema = z.object({
  genre: z.string().max(60).optional(),
  mood: z.string().max(60).optional(),
  tempo: z.number().int().min(40).max(200).optional(),
  prompt: z.string().max(2000).optional(),
});

/**
 * POST /api/projects/:id/generate-beat
 * DEV_MODE: writes a short mock WAV and marks beat ready (no paid API).
 * Production: queue GENERATE_BEAT job (provider wiring later).
 */
export async function POST(req: Request, ctx: Ctx) {
  const { id: projectId } = await ctx.params;
  const { user, supabase, error } = await requireUser();
  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: project, error: pErr } = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (pErr || !project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
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

  const genre = parsed.data.genre ?? project.genre ?? "R&B";
  const mood = parsed.data.mood ?? project.mood ?? "Emotional";
  const tempo = parsed.data.tempo ?? project.tempo ?? 90;
  const prompt =
    parsed.data.prompt ??
    project.prompt ??
    `${mood} ${genre} instrumental, ${tempo} BPM`;

  const { data: job, error: jErr } = await supabase
    .from("jobs")
    .insert({
      project_id: projectId,
      type: "GENERATE_BEAT",
      status: "processing",
      progress: 10,
      stage: "generating",
      input_data: { genre, mood, tempo, prompt },
      started_at: new Date().toISOString(),
      attempts: 1,
    })
    .select()
    .single();

  if (jErr || !job) {
    console.error("job insert", jErr);
    return NextResponse.json({ error: "Could not start beat job" }, { status: 500 });
  }

  await supabase
    .from("projects")
    .update({ status: "generating_beat", genre, mood, tempo, prompt })
    .eq("id", projectId);

  try {
    if (isDevMode()) {
      const path = beatPath(user.id, projectId, "beat-dev.wav");
      const wav = mockWavBuffer(3, 22050);
      await uploadBuffer(path, wav, "audio/wav");

      const { data: beat, error: bErr } = await supabase
        .from("beats")
        .insert({
          project_id: projectId,
          audio_path: path,
          duration_ms: 3000,
          bpm: tempo,
          key: "A minor",
          source: "dev_mock",
          generation_prompt: prompt,
          status: "ready",
          metadata: { genre, mood, dev: true },
        })
        .select()
        .single();

      if (bErr) throw bErr;

      await supabase
        .from("jobs")
        .update({
          status: "complete",
          progress: 100,
          stage: "complete",
          output_data: { beat_id: beat.id, audio_path: path },
          completed_at: new Date().toISOString(),
        })
        .eq("id", job.id);

      await supabase.from("projects").update({ status: "beat_ready" }).eq("id", projectId);

      return NextResponse.json({
        job_id: job.id,
        status: "complete",
        beat,
        dev_mode: true,
      });
    }

    await supabase
      .from("jobs")
      .update({
        status: "queued",
        progress: 0,
        stage: "queued",
        error: "Beat provider not configured. Enable DEV_MODE or add a generation provider.",
      })
      .eq("id", job.id);

    return NextResponse.json(
      {
        job_id: job.id,
        status: "queued",
        message: "Set DEV_MODE=true for free mock beats, or configure a beat provider.",
      },
      { status: 202 }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Beat generation failed";
    console.error("generate-beat", e);
    await supabase
      .from("jobs")
      .update({
        status: "failed",
        error: msg,
        completed_at: new Date().toISOString(),
      })
      .eq("id", job.id);
    await supabase.from("projects").update({ status: "failed" }).eq("id", projectId);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
