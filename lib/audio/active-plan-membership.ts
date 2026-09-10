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
  /** Optional — when present, prefer takes that actually have audio */
  audio_path?: string | null;
  processed_path?: string | null;
  original_path?: string | null;
  original_audio_path?: string | null;
  created_at?: string | null;
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

function hasUsablePath(r: RecordingTaskRef): boolean {
  const p =
    r.original_path || r.original_audio_path || r.processed_path || r.audio_path || null;
  return Boolean(p && String(p).length > 2);
}

/**
 * Prefer is_selected take per task; else take with a usable path; else newest.
 * Always keeps ONE entry per distinct task_id so multi-section songs retain
 * verse + chorus + bridge (etc.) instead of collapsing to a single vocal.
 */
export function oneTakePerTask<T extends RecordingTaskRef>(recordings: T[]): T[] {
  const byTask = new Map<string, T>();
  for (const t of recordings) {
    const tid = t.task_id || t.id;
    const prev = byTask.get(tid);
    if (!prev) {
      byTask.set(tid, t);
      continue;
    }
    // Prefer selected
    if (t.is_selected && !prev.is_selected) {
      byTask.set(tid, t);
      continue;
    }
    if (!t.is_selected && prev.is_selected) continue;
    // Prefer usable storage path
    const tPath = hasUsablePath(t);
    const pPath = hasUsablePath(prev);
    if (tPath && !pPath) {
      byTask.set(tid, t);
      continue;
    }
    if (!tPath && pPath) continue;
    // Prefer newer if timestamps exist
    if (t.created_at && prev.created_at && t.created_at > prev.created_at) {
      byTask.set(tid, t);
    }
  }
  return [...byTask.values()];
}

/**
 * Ensure every active/completed task that has a recording is represented.
 * Call after oneTakePerTask when membership may have dropped sections.
 */
export function recoverMissingTaskTakes<T extends RecordingTaskRef>(opts: {
  planTasks: PlanTaskFlags[];
  allRecordings: T[];
  currentTakes: T[];
}): T[] {
  const { planTasks, allRecordings, currentTakes } = opts;
  const activeIds = activePlanTaskIds(planTasks);
  const completedActive = planTasks.filter(
    (t) => activeIds.has(t.id) && (isCompletedTaskStatus(t.status) || !t.status)
  );
  const have = new Set(
    currentTakes.map((t) => t.task_id || t.id).filter(Boolean) as string[]
  );
  const out = [...currentTakes];

  for (const task of completedActive) {
    if (have.has(task.id)) continue;
    const candidates = allRecordings.filter((r) => r.task_id === task.id && hasUsablePath(r));
    if (!candidates.length) continue;
    // Prefer selected, else first with path
    const pick =
      candidates.find((c) => c.is_selected) ||
      candidates.find((c) => hasUsablePath(c)) ||
      candidates[0];
    out.push(pick);
    have.add(task.id);
  }

  // Last-resort: if still only 0–1 takes but many recordings exist with distinct task_ids,
  // include one per task_id that maps to any plan task (or all if no flags).
  if (out.length <= 1) {
    const byTask = oneTakePerTask(
      matchRecordingsToActivePlan(planTasks, allRecordings.filter(hasUsablePath))
    );
    if (byTask.length > out.length) return byTask;
  }

  return out;
}
