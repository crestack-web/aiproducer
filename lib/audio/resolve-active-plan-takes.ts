import type { TakeRow } from "@/lib/audio/produce-job";
import { logProduce } from "@/lib/audio/produce-job";
import {
  activePlanTaskIds,
  matchRecordingsToActivePlan,
  oneTakePerTask,
  recoverMissingTaskTakes,
  type PlanTaskFlags,
} from "@/lib/audio/active-plan-membership";
import type { createServiceClient } from "@/lib/supabase/server";

type Service = ReturnType<typeof createServiceClient>;

type PlanTaskRow = PlanTaskFlags & {
  type?: string | null;
  title?: string | null;
  start_ms?: number | null;
  end_ms?: number | null;
};

/**
 * Resolve recordings that belong to the active artist plan.
 * Authoritative rule: recording.task_id ∈ selected recording_tasks.id
 *
 * Always loads ALL project recordings, then membership-filters, so a single
 * is_selected row cannot hide other section takes.
 */
export async function resolveActivePlanTakes(
  supabase: Service,
  projectId: string,
  jobId: string
): Promise<TakeRow[]> {
  const { data: planTasksRaw } = await supabase
    .from("recording_tasks")
    .select("id, type, title, start_ms, end_ms, active, selected_in_plan, status")
    .eq("project_id", projectId);

  const planTasks = (planTasksRaw || []) as PlanTaskRow[];
  const taskById = new Map(planTasks.map((t) => [t.id, t]));

  // Load every recording for the project (do not filter is_selected first)
  let { data: takesRaw, error: takesErr } = await supabase
    .from("recordings")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  if (takesErr) {
    logProduce({ event: "takes_query_error", jobId, projectId, error: takesErr.message });
  }

  let candidates = (takesRaw || []) as TakeRow[];

  // Fallback by task_id if project_id returned nothing
  if (candidates.length === 0 && planTasks.length > 0) {
    const ids = planTasks.map((t) => t.id).slice(0, 80);
    const { data: byTask } = await supabase
      .from("recordings")
      .select("*")
      .in("task_id", ids)
      .order("created_at", { ascending: false });
    candidates = (byTask || []) as TakeRow[];
    logProduce({
      event: "takes_fallback_by_task",
      jobId,
      projectId,
      count: candidates.length,
    });
  }

  const matched = matchRecordingsToActivePlan(planTasks, candidates);
  let takes = oneTakePerTask(matched);
  takes = recoverMissingTaskTakes({
    planTasks,
    allRecordings: candidates,
    currentTakes: takes,
  });

  takes = takes.map((t) => {
    const task = t.task_id ? taskById.get(t.task_id) : undefined;
    if (!task) return t;
    return {
      ...t,
      recording_tasks: {
        id: task.id,
        type: task.type || "lead",
        start_ms: task.start_ms ?? null,
        end_ms: task.end_ms ?? null,
        title: task.title ?? null,
        active: task.active,
        selected_in_plan: task.selected_in_plan,
        status: task.status ?? null,
      },
    };
  });

  logProduce({
    event: "active_plan_matched_recordings",
    jobId,
    projectId,
    selectedTaskIds: [...activePlanTaskIds(planTasks)],
    matchedRecordingTaskIds: takes.map((t) => t.task_id),
    matchedCount: takes.length,
    candidateCount: candidates.length,
    planTaskCount: planTasks.length,
  });

  if (takes.length === 0) {
    throw new Error(
      "No recordings on your active plan. Select at least one part, record it, wait for Saved, then Produce."
    );
  }

  for (const t of takes) {
    if (!t.is_selected) {
      await supabase.from("recordings").update({ is_selected: true }).eq("id", t.id);
    }
  }

  return takes;
}
