/**
 * Server-side production readiness (Supabase). Do not import from Client Components.
 */
import { createServiceClient } from "@/lib/supabase/server";
import type { PlanTaskRow } from "@/lib/plan";
import {
  produceReadinessFromTasks,
  type ProduceReadiness,
} from "@/lib/production/readiness";

function hasRealAudio(path: unknown): boolean {
  return (
    typeof path === "string" &&
    path.length > 0 &&
    !path.startsWith("mock://") &&
    !path.includes("pending")
  );
}

/**
 * Aligns with enqueueProduceSong recording/plan resolution.
 * Does not create a job.
 *
 * Produce is allowed when the project has at least one real vocal file
 * (record or upload), including Build-from-Scratch / custom tracks.
 * AI plan membership must not block uploaded takes on artist-selected parts.
 */
export async function checkProjectProduceReady(projectId: string): Promise<ProduceReadiness> {
  const supabase = createServiceClient();

  const { data: activePlanTasks } = await supabase
    .from("recording_tasks")
    .select("id, active, selected_in_plan, status, type, title")
    .eq("project_id", projectId);

  const tasks = (activePlanTasks || []) as PlanTaskRow[];

  // Auto-heal: any task with a real recording is "completed" for produce readiness
  const { data: allRecs } = await supabase
    .from("recordings")
    .select("id, task_id, is_selected, audio_path, project_id")
    .eq("project_id", projectId);

  const recs = allRecs || [];
  const taskIdsWithAudio = new Set<string>();
  for (const r of recs) {
    if (!hasRealAudio((r as { audio_path?: string }).audio_path)) continue;
    const tid = (r as { task_id?: string | null }).task_id;
    if (tid) taskIdsWithAudio.add(String(tid));
  }

  if (taskIdsWithAudio.size > 0) {
    const pendingWithAudio = tasks.filter(
      (t) =>
        taskIdsWithAudio.has(t.id) &&
        String(t.status || "").toLowerCase() !== "completed" &&
        String(t.status || "").toLowerCase() !== "skipped"
    );
    for (const t of pendingWithAudio) {
      await supabase.from("recording_tasks").update({ status: "completed" }).eq("id", t.id);
      (t as { status?: string }).status = "completed";
    }
  }

  const fromTasks = produceReadinessFromTasks(
    tasks.map((t) => ({
      id: t.id,
      type: t.type || "lead",
      status: t.status || "pending",
      start_ms: null,
      end_ms: null,
      active: (t as { active?: boolean | null }).active,
      selected_in_plan: (t as { selected_in_plan?: boolean | null }).selected_in_plan,
      required: (t as { required?: boolean | null }).required,
    }))
  );

  // Primary path: task status says completed
  if (fromTasks.canProduce) {
    // Still verify audio exists (aligned with enqueue)
    const activeTaskIds = new Set(
      tasks
        .filter((t) => {
          const a = (t as { active?: boolean | null }).active;
          const sel = (t as { selected_in_plan?: boolean | null }).selected_in_plan;
          if (a === false) return false;
          if (sel === false) return false;
          if ((t.status || "") === "skipped") return false;
          return true;
        })
        .map((t) => t.id)
    );

    const withAudioOnPlan = recs.filter((r) => {
      if (!hasRealAudio((r as { audio_path?: string }).audio_path)) return false;
      const tid = (r as { task_id?: string | null }).task_id;
      if (!tid) return true; // orphan project-level take still usable
      if (activeTaskIds.size === 0) return true;
      return activeTaskIds.has(String(tid));
    });

    if (withAudioOnPlan.length > 0) {
      return { canProduce: true, code: "ok", reason: "" };
    }
  }

  // Fallback: any real vocal on the project (scratch / upload / studio import)
  const anyAudio = recs.filter((r) => hasRealAudio((r as { audio_path?: string }).audio_path));
  if (anyAudio.length > 0) {
    // Ensure parent tasks are selected so enqueue keeps them
    for (const r of anyAudio) {
      const tid = (r as { task_id?: string | null }).task_id;
      if (!tid) continue;
      await supabase
        .from("recording_tasks")
        .update({ status: "completed", active: true, selected_in_plan: true })
        .eq("id", tid)
        .eq("project_id", projectId);
    }
    return { canProduce: true, code: "ok", reason: "" };
  }

  if (!fromTasks.canProduce) {
    return fromTasks;
  }

  return {
    canProduce: false,
    code: "missing_recording",
    reason: "Record or upload at least one vocal before producing.",
  };
}
