import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { analyzeMetadataOnly } from "@/lib/audio/analysis";
import type { AudioAnalysis } from "@/lib/audio/analysis-types";
import {
  recommendNextAction,
  buildProductionState,
} from "@/lib/ai/production-coach";

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
  let body: { analysis?: AudioAnalysis; force?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const existingMeta = (recording.metadata && typeof recording.metadata === "object"
    ? recording.metadata
    : {}) as Record<string, unknown>;

  if (existingMeta.analysis && !body.force && !body.analysis) {
    return NextResponse.json({
      analysis: existingMeta.analysis,
      recommendation: existingMeta.producer_recommendation || null,
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
    .select("id, type, status, metadata, start_ms, end_ms")
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

  const nextMeta = {
    ...existingMeta,
    analysis,
    analyzer_version: analysis.analyzerVersion,
    producer_recommendation: recommendation,
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
    production_state: productionState,
    reused: false,
  });
}
