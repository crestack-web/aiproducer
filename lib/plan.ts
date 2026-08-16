/**
 * Artist-approved production plan helpers.
 * AI suggests; artist decides. Produce uses only the active artist plan.
 */

export type PlanMode = "ai" | "customize" | "scratch";

export type PlanRecommendation = "recommended" | "optional";

export type PlanTaskRow = {
  id: string;
  type: string;
  title?: string | null;
  instruction?: string | null;
  reason?: string | null;
  start_ms: number | null;
  end_ms: number | null;
  required?: boolean | null;
  priority?: number | null;
  status: string;
  section_id?: string | null;
  active?: boolean | null;
  selected_in_plan?: boolean | null;
  plan_source?: string | null;
  recommendation?: string | null;
  metadata?: Record<string, unknown> | null;
};

/** Task is part of the active artist plan (not removed, explicitly selected). */
export function isActivePlanTask(t: PlanTaskRow): boolean {
  if (t.active === false) return false;
  // Legacy rows without selected_in_plan: treat as selected if not skipped/removed
  if (t.selected_in_plan === false) return false;
  if (t.status === "skipped") return false;
  return true;
}

/** Open work in the active plan (needs recording). */
export function activePlanOpen(tasks: PlanTaskRow[]): PlanTaskRow[] {
  return tasks.filter((t) => isActivePlanTask(t) && (t.status === "pending" || t.status === "in_progress"));
}

/** Completed work in the active plan. */
export function activePlanDone(tasks: PlanTaskRow[]): PlanTaskRow[] {
  return tasks.filter((t) => isActivePlanTask(t) && t.status === "completed");
}

/**
 * Produce is allowed when the artist has at least one completed take on the active plan.
 * AI-recommended-but-unselected tasks never block.
 */
export function canProduce(tasks: PlanTaskRow[]): { ok: boolean; reason?: string } {
  const active = tasks.filter(isActivePlanTask);
  if (active.length === 0) {
    return { ok: false, reason: "Select at least one part in your plan, then record it." };
  }
  const done = active.filter((t) => t.status === "completed");
  if (done.length === 0) {
    return { ok: false, reason: "Record at least one selected part before Produce." };
  }
  return { ok: true };
}

export function recommendationLabel(t: PlanTaskRow): string {
  const r = (t.recommendation || (t.required ? "recommended" : "optional")).toLowerCase();
  if (r === "recommended" || t.required) return "AI recommended";
  return "Optional";
}
