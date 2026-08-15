import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { isDevMode } from "@/lib/env";
import { generateDevBlueprint, type AnalysisSnapshot } from "@/lib/blueprint";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/projects/:id/analyze
 * DEV_MODE: deterministic analysis + blueprint + recording_tasks (no LLM cost).
 */
export async function POST(_req: Request, ctx: Ctx) {
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

  const { data: beat } = await supabase
    .from("beats")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!beat || beat.status !== "ready") {
    return NextResponse.json({ error: "Generate a beat first" }, { status: 400 });
  }

  const { data: analyzeJob } = await supabase
    .from("jobs")
    .insert({
      project_id: projectId,
      type: "ANALYZE_BEAT",
      status: "processing",
      progress: 20,
      stage: "analyzing",
      started_at: new Date().toISOString(),
      attempts: 1,
    })
    .select()
    .single();

  await supabase.from("projects").update({ status: "analyzing" }).eq("id", projectId);

  try {
    if (!isDevMode()) {
      await supabase
        .from("jobs")
        .update({
          status: "queued",
          stage: "queued",
          error: "Analysis provider not configured. Use DEV_MODE=true for free deterministic blueprint.",
        })
        .eq("id", analyzeJob!.id);

      return NextResponse.json(
        {
          message: "Set DEV_MODE=true for free analyze + blueprint, or configure audio analysis.",
          job_id: analyzeJob?.id,
        },
        { status: 202 }
      );
    }

    const analysis: AnalysisSnapshot = {
      duration_ms: beat.duration_ms ?? 180_000,
      bpm: beat.bpm ? Number(beat.bpm) : project.tempo,
      key: beat.key ?? "A minor",
      source: "dev_mock",
    };

    await supabase
      .from("jobs")
      .update({
        status: "complete",
        progress: 100,
        stage: "complete",
        output_data: analysis,
        completed_at: new Date().toISOString(),
      })
      .eq("id", analyzeJob!.id);

    const { data: bpJob } = await supabase
      .from("jobs")
      .insert({
        project_id: projectId,
        type: "CREATE_BLUEPRINT",
        status: "processing",
        progress: 50,
        stage: "planning",
        started_at: new Date().toISOString(),
        attempts: 1,
      })
      .select()
      .single();

    const sections = generateDevBlueprint({
      genre: project.genre,
      mood: project.mood,
      bpm: analysis.bpm,
      durationMs: analysis.duration_ms,
    });

    await supabase.from("recording_tasks").delete().eq("project_id", projectId);
    await supabase.from("song_sections").delete().eq("project_id", projectId);

    const sectionRows = sections.map((s) => ({
      project_id: projectId,
      type: s.type,
      label: s.label,
      start_ms: s.start_ms,
      end_ms: s.end_ms,
      order_index: s.order_index,
      energy: s.energy,
      metadata: { role: s.role },
    }));

    const { data: insertedSections, error: sErr } = await supabase
      .from("song_sections")
      .insert(sectionRows)
      .select();

    if (sErr || !insertedSections) {
      throw sErr || new Error("Failed to insert sections");
    }

    const sectionByOrder = new Map(insertedSections.map((s) => [s.order_index, s]));

    const taskRows = [];
    for (const sec of sections) {
      const dbSec = sectionByOrder.get(sec.order_index);
      for (const t of sec.tasks) {
        taskRows.push({
          project_id: projectId,
          section_id: dbSec?.id ?? null,
          type: t.type,
          instruction: t.instruction,
          start_ms: sec.start_ms,
          end_ms: sec.end_ms,
          required: t.required,
          priority: t.priority,
          status: "pending",
          metadata: { section_label: sec.label, section_type: sec.type },
        });
      }
    }

    const { data: insertedTasks, error: tErr } = await supabase
      .from("recording_tasks")
      .insert(taskRows)
      .select();

    if (tErr) throw tErr;

    await supabase
      .from("jobs")
      .update({
        status: "complete",
        progress: 100,
        stage: "complete",
        output_data: {
          section_count: insertedSections.length,
          task_count: insertedTasks?.length ?? 0,
        },
        completed_at: new Date().toISOString(),
      })
      .eq("id", bpJob!.id);

    await supabase.from("projects").update({ status: "blueprint_ready" }).eq("id", projectId);

    return NextResponse.json({
      analysis,
      sections: insertedSections,
      tasks: insertedTasks,
      dev_mode: true,
      jobs: { analyze: analyzeJob?.id, blueprint: bpJob?.id },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Analyze failed";
    console.error("analyze", e);
    if (analyzeJob) {
      await supabase
        .from("jobs")
        .update({ status: "failed", error: msg, completed_at: new Date().toISOString() })
        .eq("id", analyzeJob.id);
    }
    await supabase.from("projects").update({ status: "failed" }).eq("id", projectId);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
