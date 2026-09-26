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
    !String(path).includes("pending")
  );
}

function isActivePlanTask(t: {
  active?: boolean | null;
  selected_in_plan?: boolean | null;
  status?: string | null;
}): boolean {
  if (t.active === false) return false;
  if (t.selected_in_plan === false) return false;
  if ((t.status || "") === "skipped") return false;
  return true;
}

/**
 * Produce only when the CURRENT active plan has at least one real vocal.
 * Removed / deselected AI blueprint tracks never count and are never re-activated.
 */
export async function checkProjectProduceReady(projectId: string): Promise<ProduceReadiness> {
  const supabase = createServiceClient();

  const { data: planTasks } = await supabase
    .from("recording_tasks")
    .select("id, active, selected_in_plan, status, type, title")
    .eq("project_id", projectId);

  const tasks = (planTasks || []) as PlanTaskRow[];
  const activeTasks = tasks.filter((t) =>
    isActivePlanTask({
      active: (t as { active?: boolean | null }).active,
      selected_in_plan: (t as { selected_in_plan?: boolean | null }).selected_in_plan,
      status: t.status,
    })
  );
  const activeIds = new Set(activeTasks.map((t) => t.id));

  const { data: allRecs } = await supabase
    .from("recordings")
    .select("id, task_id, is_selected, audio_path")
    .eq("project_id", projectId);

  const recs = allRecs || [];

  // Heal status only for active-plan tasks that already have audio (never flip selected_in_plan)
  for (const r of recs) {
    if (!hasRealAudio((r as { audio_path?: string }).audio_path)) continue;
    const tid = (r as { task_id?: string | null }).task_id;
    if (!tid || !activeIds.has(String(tid))) continue;
    const task = activeTasks.find((x) => x.id === tid);
    if (task && String(task.status || "").toLowerCase() !== "completed") {
      await supabase.from("recording_tasks").update({ status: "completed" }).eq("id", tid);
      (task as { status?: string }).status = "completed";
    }
  }

  const onPlanAudio = recs.filter((r) => {
    if (!hasRealAudio((r as { audio_path?: string }).audio_path)) return false;
    const tid = (r as { task_id?: string | null }).task_id;
    if (!tid) return false;
    return activeIds.has(String(tid));
  });

  if (onPlanAudio.length > 0) {
    return { canProduce: true, code: "ok", reason: "" };
  }

  // Explain removed-vs-missing clearly
  const removedWithAudio = recs.filter((r) => {
    if (!hasRealAudio((r as { audio_path?: string }).audio_path)) return false;
    const tid = (r as { task_id?: string | null }).task_id;
    if (!tid) return false;
    return !activeIds.has(String(tid));
  });

  if (activeTasks.length === 0) {
    return {
      canProduce: false,
      code: "no_active_plan",
      reason:
        "No tracks on your current plan. Add a part on the timeline, then record or upload a vocal.",
    };
  }

  if (removedWithAudio.length > 0 && onPlanAudio.length === 0) {
    return {
      canProduce: false,
      code: "takes_not_on_plan",
      reason:
        "Older takes are only on removed tracks. Record or upload on a track that is still on your plan.",
    };
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
  return fromTasks;
}
