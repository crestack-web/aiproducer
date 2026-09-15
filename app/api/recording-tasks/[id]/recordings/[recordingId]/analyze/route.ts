import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { analyzeMetadataOnly } from "@/lib/audio/analysis";
import type { AudioAnalysis } from "@/lib/audio/analysis-types";
import {
  recommendNextAction,
  buildProductionState,
} from "@/lib/ai/production-coach";
import { suggestPostLeadLayerRefinement } from "@/lib/ai/layer-refinement-suggest";

type Ctx = { params: Promise<{ id: string; recordingId: string }> };

/**
 * POST /api/recording-tasks/:id/recordings/:recordingId/analyze
 * Body (optional JSON):
 *   { analysis?: AudioAnalysis }  — client PCM analysis preferred
 * Runs metadata-only analysis if none provided.
 * Persists on recording.metadata.analysis and returns Mistral/heuristic recommendation.
 */
export async function POST(req: Request, ctx: Ctx) {
  const { id: taskId, recordingId } = await ctx.params;
  const { user, supabase, error } = await requireUser();
  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const service = createServiceClient();

  const { data: task } = await service
    .from("recording_tasks")
    .select("id, project_id, type, start_ms, end_ms, section_id, metadata, status")
    .eq("id", taskId)
    .maybeSingle();
  if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });

  const { data: project } = await supabase
    .from("projects")
    .select("id, genre, mood, user_id")
    .eq("id", task.project_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: recording } = await service
    .from("recordings")
    .select("*")
    .eq("id", recordingId)
    .eq("task_id", taskId)
    .maybeSingle();
  if (!recording) return NextResponse.json({ error: "Recording not found" }, { status: 404 });

  // Skip re-analyze if already present and client did not send a new analysis
  let body: { analysis?: AudioAnalysis; force?: boolean; layer_suggestion_log?: { id?: string; outcome?: string; at?: string } } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const existingMeta = (recording.metadata && typeof recording.metadata === "object"
    ? recording.metadata
    : {}) as Record<string, unknown>;

  // Accept/dismiss logging only — never mutates plan tasks
  if (body && typeof body === "object" && (body as { layer_suggestion_log?: unknown }).layer_suggestion_log) {
    const entry = (body as { layer_suggestion_log: { id?: string; outcome?: string; at?: string } }).layer_suggestion_log;
    const log = Array.isArray(existingMeta.layer_suggestion_log)
      ? [...(existingMeta.layer_suggestion_log as unknown[])]
      : [];
    log.push({
      id: entry.id,
      outcome: entry.outcome, // accepted | dismissed
      at: entry.at || new Date().toISOString(),
    });
    await service
      .from("recordings")
      .update({
        metadata: {
          ...existingMeta,
          layer_suggestion_log: log.slice(-40),
          layer_suggestion:
            entry.outcome === "dismissed" || entry.outcome === "accepted"
              ? null
              : existingMeta.layer_suggestion,
        },
      })
      .eq("id", recordingId);
    return NextResponse.json({ ok: true, logged: true });
  }

  if (existingMeta.analysis && !body.force && !body.analysis) {
    return NextResponse.json({
      analysis: existingMeta.analysis,
      recommendation: existingMeta.producer_recommendation || null,
      layer_suggestion: existingMeta.layer_suggestion || null,
      reused: true,
    });
  }

  const expected =
    typeof task.end_ms === "number" && typeof task.start_ms === "number"
      ? task.end_ms - task.start_ms
      : null;

  const analysis: AudioAnalysis = body.analysis
    ? {
        ...body.analysis,
        recordingId,
        projectId: task.project_id,
        sectionId: task.section_id,
        role: (existingMeta.role as string) || task.type,
      }
    : analyzeMetadataOnly({
        durationMs: recording.duration_ms,
        expectedDurationMs: expected,
        timelineStartMs: recording.timeline_start_ms ?? task.start_ms,
        timelineEndMs: recording.timeline_end_ms ?? task.end_ms,
        recordingId,
        projectId: task.project_id,
        sectionId: task.section_id,
        role: (existingMeta.role as string) || task.type,
      });

  // Production state from all tasks + selected recordings
  const { data: allTasks } = await service
    .from("recording_tasks")
    .select("id, type, status, metadata, start_ms, end_ms, section_id")
    .eq("project_id", task.project_id);

  const { data: selected } = await service
    .from("recordings")
    .select("task_id")
    .eq("project_id", task.project_id)
    .eq("is_selected", true);

  const selectedByTask = new Set((selected || []).map((r) => r.task_id as string));
  const productionState = buildProductionState(allTasks || [], selectedByTask);

  const taskMeta = (task.metadata || {}) as Record<string, unknown>;
  const recommendation = await recommendNextAction({
    genre: project.genre,
    mood: project.mood,
    analysis,
    sectionLabel: (taskMeta.section_label as string) || null,
    productionState,
  });

  // Post-lead only: suggest plan tweaks — never auto-mutate tasks
  let layerSuggestion = null as ReturnType<typeof suggestPostLeadLayerRefinement>;
  const completedType = String(task.type || "");
  if (/lead|main/i.test(completedType)) {
    const sectionLabel = (taskMeta.section_label as string) || null;
    const sectionId = (task.section_id as string) || null;
    const openPlanned = (allTasks || []).filter((row) => {
      const st = String(row.status || "").toLowerCase();
      if (st === "completed" || st === "skipped" || st === "done") return false;
      if (row.id === taskId) return false;
      const ty = String(row.type || "").toLowerCase();
      if (ty.includes("lead") || ty === "main") return false;
      // same section
      if (sectionId && row.section_id && row.section_id === sectionId) return true;
      const rm = (row.metadata || {}) as Record<string, unknown>;
      if (sectionLabel && String(rm.section_label || "").toLowerCase() === sectionLabel.toLowerCase())
        return true;
      if (sectionLabel && String(rm.parent_section_label || "").toLowerCase() === sectionLabel.toLowerCase())
        return true;
      return false;
    });
    const priorLog = Array.isArray(existingMeta.layer_suggestion_log)
      ? (existingMeta.layer_suggestion_log as { id?: string; outcome?: string }[])
      : [];
    const dismissedIds = priorLog
      .filter((e) => e.outcome === "dismissed" || e.outcome === "accepted")
      .map((e) => String(e.id || ""))
      .filter(Boolean);
    layerSuggestion = suggestPostLeadLayerRefinement({
      completedTaskType: completedType,
      sectionType: (taskMeta.section_type as string) || null,
      sectionLabel,
      sectionId,
      genre: project.genre,
      mood: project.mood,
      energyPct: typeof taskMeta.energy_pct === "number" ? taskMeta.energy_pct : null,
      analysis,
      openPlannedLayers: openPlanned.map((r) => ({
        id: r.id,
        type: String(r.type || ""),
        status: String(r.status || ""),
        section_id: r.section_id,
        metadata: (r.metadata || {}) as Record<string, unknown>,
      })),
      dismissedIds,
    });
  }

  const nextMeta = {
    ...existingMeta,
    analysis,
    analyzer_version: analysis.analyzerVersion,
    producer_recommendation: recommendation,
    layer_suggestion: layerSuggestion,
  };

  await service
    .from("recordings")
    .update({
      metadata: nextMeta,
      alignment_status:
        analysis.timeline.expectedDurationMs != null &&
        analysis.timeline.actualDurationMs != null
          ? Math.abs(
              analysis.timeline.actualDurationMs - analysis.timeline.expectedDurationMs
            ) >
            Math.max(800, analysis.timeline.expectedDurationMs * 0.12)
            ? "needs_alignment"
            : "ok"
          : recording.alignment_status || "unknown",
    })
    .eq("id", recordingId);

  return NextResponse.json({
    analysis,
    recommendation,
    layer_suggestion: layerSuggestion,
    production_state: productionState,
    reused: false,
  });
}
