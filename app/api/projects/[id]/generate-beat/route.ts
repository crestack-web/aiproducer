import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { isDevMode } from "@/lib/env";
import { beatPath, uploadBuffer } from "@/lib/storage";
import { mockWavBuffer } from "@/lib/dev-mock";
import { generateInstrumentalBeat, hasElevenLabsKey } from "@/lib/providers/elevenlabs";
import { generateBeatWithReplicate, hasReplicateToken } from "@/lib/providers/replicate";

type Ctx = { params: Promise<{ id: string }> };

const BodySchema = z.object({
  genre: z.string().max(60).optional(),
  mood: z.string().max(60).optional(),
  tempo: z.number().int().min(40).max(200).optional(),
  prompt: z.string().max(2000).optional(),
  length_ms: z.number().int().min(3000).max(180000).optional(),
});

type BeatResult = {
  buffer: Buffer;
  contentType: string;
  extension: string;
  provider: string;
  model: string;
  prompt: string;
  durationMs: number;
};

export async function POST(req: Request, ctx: Ctx) {
  const { id: projectId } = await ctx.params;
  const { user, supabase, error } = await requireUser();
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: project, error: pErr } = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (pErr || !project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const genre = parsed.data.genre ?? project.genre ?? "R&B";
  const mood = parsed.data.mood ?? project.mood ?? "Emotional";
  const tempo = parsed.data.tempo ?? project.tempo ?? 90;
  const prompt =
    parsed.data.prompt ?? project.prompt ?? `${mood} ${genre} instrumental, ${tempo} BPM`;
  const lengthMs = parsed.data.length_ms ?? 30000;

  const preferred = (process.env.BEAT_PROVIDER || "").toLowerCase();
  const canReplicate = hasReplicateToken() && preferred !== "elevenlabs" && preferred !== "mock";
  const canEleven = hasElevenLabsKey() && preferred !== "replicate" && preferred !== "mock";
  const providerOrder =
    preferred === "elevenlabs"
      ? (["elevenlabs", "replicate", "mock"] as const)
      : preferred === "mock"
        ? (["mock"] as const)
        : (["replicate", "elevenlabs", "mock"] as const);

  const { data: job, error: jErr } = await supabase
    .from("jobs")
    .insert({
      project_id: projectId,
      type: "GENERATE_BEAT",
      status: "processing",
      progress: 10,
      stage: "generating",
      input_data: { genre, mood, tempo, prompt, lengthMs, provider_order: providerOrder },
      started_at: new Date().toISOString(),
      attempts: 1,
    })
    .select()
    .single();
  if (jErr || !job) return NextResponse.json({ error: "Could not start beat job" }, { status: 500 });

  await supabase
    .from("projects")
    .update({ status: "generating_beat", genre, mood, tempo, prompt })
    .eq("id", projectId);

  async function runProviders(): Promise<BeatResult> {
    const errors: string[] = [];
    for (const name of providerOrder) {
      if (name === "replicate" && canReplicate) {
        try {
          const r = await generateBeatWithReplicate({
            genre,
            mood,
            tempo,
            prompt,
            durationSec: Math.min(Math.round(lengthMs / 1000), 30),
          });
          return {
            buffer: r.buffer,
            contentType: r.contentType,
            extension: r.extension,
            provider: r.provider,
            model: r.model,
            prompt: r.prompt,
            durationMs: r.durationMs,
          };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.warn("[generate-beat] replicate failed:", msg);
          errors.push(`replicate: ${msg}`);
        }
      }
      if (name === "elevenlabs" && canEleven) {
        try {
          const r = await generateInstrumentalBeat({ genre, mood, tempo, prompt, lengthMs });
          return {
            buffer: r.buffer,
            contentType: r.contentType,
            extension: r.extension,
            provider: r.provider,
            model: r.model,
            prompt: r.prompt,
            durationMs: r.durationMs,
          };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.warn("[generate-beat] elevenlabs failed:", msg);
          errors.push(`elevenlabs: ${msg}`);
        }
      }
      if (name === "mock" && (isDevMode() || preferred === "mock")) {
        return {
          buffer: mockWavBuffer(3, 22050),
          contentType: "audio/wav",
          extension: "wav",
          provider: "mock",
          model: "dev_mock",
          prompt,
          durationMs: 3000,
        };
      }
    }
    throw new Error(
      errors.length
        ? `All beat providers failed. ${errors.join(" | ")}`
        : "No beat provider configured. Set REPLICATE_API_TOKEN or ELEVENLABS_API_KEY, or DEV_MODE=true."
    );
  }

  try {
    const result = await runProviders();
    const path = beatPath(user.id, projectId, `beat-${result.provider}.${result.extension}`);
    await uploadBuffer(path, result.buffer, result.contentType);

    const beatPayload: Record<string, unknown> = {
      project_id: projectId,
      audio_path: path,
      duration_ms: result.durationMs,
      tempo,
      status: "ready",
      metadata: {
        genre,
        mood,
        prompt: result.prompt,
        provider: result.provider,
        model: result.model,
        source: result.provider,
      },
    };

    let beatRow;
    const { data: beat, error: bErr } = await supabase
      .from("beats")
      .insert({ ...beatPayload, source: result.provider, original_filename: `beat-${result.provider}.${result.extension}` })
      .select()
      .single();
    if (bErr) {
      const { data: fb, error: fbErr } = await supabase.from("beats").insert(beatPayload).select().single();
      if (fbErr || !fb) throw fbErr || new Error("Could not save beat");
      beatRow = fb;
    } else {
      beatRow = beat;
    }

    await supabase
      .from("jobs")
      .update({
        status: "complete",
        progress: 100,
        stage: "complete",
        provider: result.provider,
        output_data: { beat_id: beatRow.id, audio_path: path, provider: result.provider, model: result.model },
        completed_at: new Date().toISOString(),
      })
      .eq("id", job.id);
    await supabase.from("projects").update({ status: "beat_ready" }).eq("id", projectId);

    return NextResponse.json({
      job_id: job.id,
      status: "complete",
      beat: beatRow,
      provider: result.provider,
      model: result.model,
      duration_ms: result.durationMs,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Beat generation failed";
    console.error("generate-beat", e);
    await supabase
      .from("jobs")
      .update({ status: "failed", error: msg, completed_at: new Date().toISOString() })
      .eq("id", job.id);
    await supabase.from("projects").update({ status: "failed" }).eq("id", projectId);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
