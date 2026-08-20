/**
 * Active-plan recording membership — single authoritative rule.
 *
 * ACTIVE PLAN → selected recording_tasks.id → recordings.task_id
 *
 * Do NOT use nested embeds or timestamps for membership.
 */

export type PlanTaskFlags = {
  id: string;
  active?: boolean | null;
  selected_in_plan?: boolean | null;
  status?: string | null;
};

export type RecordingTaskRef = {
  id: string;
  task_id: string | null;
  is_selected?: boolean | null;
};

/**
 * Legacy sessions used several equivalent terminal statuses.
 * Keep Preview/progress behavior consistent across schema generations.
 */
export function isCompletedTaskStatus(status?: string | null): boolean {
  const normalized = (status || "").trim().toLowerCase();
  return ["completed", "complete", "done", "recorded", "produced"].includes(normalized);
}

export function isActivePlanTask(t: PlanTaskFlags): boolean {
  if (t.active === false) return false;
  if (t.selected_in_plan === false) return false;
  if (t.status === "skipped") return false;
  return true;
}

/**
 * Legacy: if no plan flags exist on any task, treat all tasks as active.
 */
export function hasPlanMembershipFlags(tasks: PlanTaskFlags[]): boolean {
  return tasks.some((t) => t.active != null || t.selected_in_plan != null);
}

export function activePlanTaskIds(tasks: PlanTaskFlags[]): Set<string> {
  const hasFlags = hasPlanMembershipFlags(tasks);
  if (!hasFlags) {
    return new Set(tasks.map((t) => t.id));
  }
  return new Set(tasks.filter(isActivePlanTask).map((t) => t.id));
}

/**
 * Match recordings to the active plan by task_id only.
 */
export function matchRecordingsToActivePlan<T extends RecordingTaskRef>(
  planTasks: PlanTaskFlags[],
  recordings: T[]
): T[] {
  const hasFlags = hasPlanMembershipFlags(planTasks);
  const activeIds = activePlanTaskIds(planTasks);
  return recordings.filter((r) => {
    if (!hasFlags) return true;
    if (activeIds.size === 0) return false;
    return Boolean(r.task_id) && activeIds.has(r.task_id as string);
  });
}

/** Prefer is_selected take per task; else first seen. */
export function oneTakePerTask<T extends RecordingTaskRef>(recordings: T[]): T[] {
  const byTask = new Map<string, T>();
  for (const t of recordings) {
    const tid = t.task_id || t.id;
    const prev = byTask.get(tid);
    if (!prev) {
      byTask.set(tid, t);
      continue;
    }
    if (t.is_selected && !prev.is_selected) byTask.set(tid, t);
  }
  return [...byTask.values()];
}
