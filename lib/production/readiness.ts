/**
 * Canonical production readiness — shared by Console, Booth (via canProduce), and produce job.
 * Backend enqueue remains the authority; this module encodes the same rules for UI + pre-checks.
 */

import { canProduce, type PlanTaskRow } from "@/lib/plan";
import { createServiceClient } from "@/lib/supabase/server";

export type ProduceReadinessCode =
  | "ok"
  | "no_active_plan"
  | "missing_recording"
  | "takes_not_on_plan"
  | "not_found";

export type ProduceReadiness = {
  canProduce: boolean;
  code: ProduceReadinessCode;
  /** User-facing, no DB/provider jargon */
  reason: string;
};

/** Client-safe: same rules as Booth `canProduce`. */
export function produceReadinessFromTasks(tasks: PlanTaskRow[]): ProduceReadiness {
  const gate = canProduce(tasks);
  if (gate.ok) {
    return { canProduce: true, code: "ok", reason: "" };
  }
  const reason = gate.reason || "Record at least one selected part before producing.";
  let code: ProduceReadinessCode = "missing_recording";
  if (/select at least one part/i.test(reason)) code = "no_active_plan";
  return { canProduce: false, code, reason };
}

/**
 * Server-side readiness aligned with enqueueProduceSong recording/plan resolution.
 * Does not create a job. Call before enqueue (after ownership).
 */
export async function checkProjectProduceReady(projectId: string): Promise<ProduceReadiness> {
  const supabase = createServiceClient();

  const { data: activePlanTasks } = await supabase
    .from("recording_tasks")
    .select("id, active, selected_in_plan, status, type, title")
    .eq("project_id", projectId);

  const tasks = (activePlanTasks || []) as PlanTaskRow[];
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

  // Soft client-aligned gate first
  if (!fromTasks.canProduce) {
    // Prefer friendlier lead-focused copy when only incomplete leads
    const active = tasks.filter((t) => {
      const a = (t as { active?: boolean | null }).active;
      const sel = (t as { selected_in_plan?: boolean | null }).selected_in_plan;
      if (a === false || sel === false) return false;
      if ((t.status || "") === "skipped") return false;
      return true;
    });
    const hasLead = active.some((t) => /lead|main|melody/i.test(String(t.type || t.title || "")));
    const leadDone = active.some(
      (t) =>
        /lead|main|melody/i.test(String(t.type || t.title || "")) &&
        (t.status || "").toLowerCase() === "completed"
    );
    if (hasLead && !leadDone && active.every((t) => (t.status || "").toLowerCase() !== "completed")) {
      return {
        canProduce: false,
        code: "missing_recording",
        reason: "Your song still needs a lead vocal before AP can produce it.",
      };
    }
    return fromTasks;
  }

  // Mirror enqueue: need at least one recording on active plan tasks
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

  const hasPlanFields = tasks.some(
    (t) =>
      (t as { active?: boolean | null }).active != null ||
      (t as { selected_in_plan?: boolean | null }).selected_in_plan != null
  );

  const { data: selected } = await supabase
    .from("recordings")
    .select("id, task_id, is_selected, audio_path")
    .eq("project_id", projectId);

  let rows = (selected || []).filter((r: { task_id?: string | null }) => {
    if (!hasPlanFields) return true;
    if (activeTaskIds.size === 0) return false;
    return Boolean(r.task_id) && activeTaskIds.has(String(r.task_id));
  });

  if (rows.length === 0) {
    const completedTasks = tasks.filter((t) => (t.status || "").toLowerCase() === "completed");
    const taskIds = completedTasks
      .filter((t) => {
        const a = (t as { active?: boolean | null }).active;
        const sel = (t as { selected_in_plan?: boolean | null }).selected_in_plan;
        if (a === false || sel === false) return false;
        return true;
      })
      .map((t) => t.id);
    if (taskIds.length > 0) {
      const { data: viaTasks } = await supabase
        .from("recordings")
        .select("id, task_id, is_selected, audio_path")
        .in("task_id", taskIds);
      rows = viaTasks || [];
    }
  }

  if (rows.length === 0) {
    const completedCount = tasks.filter((t) => (t.status || "").toLowerCase() === "completed").length;
    if (completedCount > 0) {
      return {
        canProduce: false,
        code: "takes_not_on_plan",
        reason:
          "You have recordings, but none are on your active plan. Restore a part in your plan, or record a selected part.",
      };
    }
    return {
      canProduce: false,
      code: "missing_recording",
      reason: "Record at least one selected part before producing.",
    };
  }

  const withAudio = rows.filter(
    (r: { audio_path?: string | null }) =>
      typeof r.audio_path === "string" &&
      r.audio_path.length > 0 &&
      !r.audio_path.startsWith("mock://")
  );
  if (withAudio.length === 0) {
    return {
      canProduce: false,
      code: "missing_recording",
      reason: "Record at least one vocal part with audio before producing.",
    };
  }

  return { canProduce: true, code: "ok", reason: "" };
}
