import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { isDevMode } from "@/lib/env";
import { generateDevBlueprint, type AnalysisSnapshot } from "@/lib/blueprint";
import { planProduction, toDbTaskType } from "@/lib/production-planner";
import {
  enhanceBlueprintWithMistral,
  isMistralConfigured,
} from "@/lib/ai/mistral-producer";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/projects/:id/analyze
 *
 * 1) Song blueprint (sections)
 * 2) Production blueprint (ProductionTasks via ProductionPlanner)
 * 3) Optional Mistral pass — warm, plain-language instruction rewrite
 *
 * Runs when DEV_MODE=true and/or MISTRAL_API_KEY is set.
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
    const canRun = isDevMode() || isMistralConfigured();
    if (!canRun) {
      await supabase
        .from("jobs")
        .update({
          status: "queued",
          stage: "queued",
          error:
            "Set DEV_MODE=true or MISTRAL_API_KEY so the AI producer can build a plan.",
        })
        .eq("id", analyzeJob!.id);

      return NextResponse.json(
        {
          message:
            "Configure MISTRAL_API_KEY (preferred) or DEV_MODE=true for deterministic plans.",
          job_id: analyzeJob?.id,
        },
        { status: 202 }
      );
    }

    const analysis: AnalysisSnapshot = {
      duration_ms: beat.duration_ms ?? 180_000,
      bpm: beat.bpm ? Number(beat.bpm) : project.tempo,
      key: beat.key ?? "A minor",
      source: isMistralConfigured() ? "mistral_producer" : "dev_mock",
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
        progress: 40,
        stage: "song_structure",
        started_at: new Date().toISOString(),
        attempts: 1,
      })
      .select()
      .single();

    const songSections = generateDevBlueprint({
      genre: project.genre,
      mood: project.mood,
      bpm: analysis.bpm,
      durationMs: analysis.duration_ms,
    });

    await supabase.from("recording_tasks").delete().eq("project_id", projectId);
    await supabase.from("song_sections").delete().eq("project_id", projectId);

    const sectionRows = songSections.map((s) => ({
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

    await supabase
      .from("jobs")
      .update({ progress: 70, stage: "production_plan" })
      .eq("id", bpJob!.id);

    const plannerInput = {
      genre: project.genre as string | null,
      mood: project.mood as string | null,
      sections: songSections.map((s) => ({
        type: s.type,
        label: s.label,
        start_ms: s.start_ms,
        end_ms: s.end_ms,
        order_index: s.order_index,
        energy: s.energy,
      })),
    };

    let production = planProduction(plannerInput);

    if (isMistralConfigured()) {
      await supabase
        .from("jobs")
        .update({ progress: 85, stage: "mistral_producer" })
        .eq("id", bpJob!.id);
      production = await enhanceBlueprintWithMistral(production, plannerInput);
    }

    const taskRows = production.tasks.map((t) => {
      const dbSec = sectionByOrder.get(t.section_order);
      return {
        project_id: projectId,
        section_id: dbSec?.id ?? null,
        type: toDbTaskType(t.type),
        title: t.title,
        instruction: t.instruction,
        reason: t.reason,
        start_ms: t.start_ms,
        end_ms: t.end_ms,
        required: t.required,
        priority: t.priority,
        status: "pending",
        metadata: {
          ...t.metadata,
          section_label: t.section_label,
          section_type: t.section_type,
          production_type: t.type,
          depends_on_type: t.depends_on_type,
        },
      };
    });

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
          energy_curve: production.energy_curve,
          planner_notes: production.notes,
        },
        completed_at: new Date().toISOString(),
      })
      .eq("id", bpJob!.id);

    await supabase.from("projects").update({ status: "blueprint_ready" }).eq("id", projectId);

    return NextResponse.json({
      analysis,
      song_blueprint: { sections: insertedSections },
      production_blueprint: {
        energy_curve: production.energy_curve,
        notes: production.notes,
        tasks: insertedTasks,
      },
      sections: insertedSections,
      tasks: insertedTasks,
      ai: {
        provider: isMistralConfigured() ? "mistral" : "deterministic",
        model: isMistralConfigured()
          ? process.env.MISTRAL_MODEL || "mistral-small-latest"
          : null,
      },
      dev_mode: isDevMode(),
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
