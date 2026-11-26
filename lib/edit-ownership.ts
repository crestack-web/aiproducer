/**
 * Booth ⇄ Console ownership rules.
 *
 * A song starts in Booth (edit_mode = 'booth'). "Open in Console" is a one-way
 * hand-off: Booth takes are copied to Console-owned parts and edit_mode flips
 * to 'console'. From then on the AI plan never edits that song again.
 *
 * Every recording_tasks row has an owner, derived from plan_source:
 *   Booth   → ai | restored_ai | artist   (default 'ai')
 *   Console → console | scratch
 */

export type EditMode = "booth" | "console";
export type PartOwner = "booth" | "console";

export const BOOTH_PLAN_SOURCES = ["ai", "restored_ai", "artist"] as const;
export const CONSOLE_PLAN_SOURCES = ["console", "scratch"] as const;

export function normalizeEditMode(value: unknown): EditMode {
  return String(value || "").toLowerCase() === "console" ? "console" : "booth";
}

/** Missing plan_source counts as Booth: the column defaults to 'ai'. */
export function partOwner(planSource: unknown): PartOwner {
  const src = String(planSource || "").toLowerCase();
  return (CONSOLE_PLAN_SOURCES as readonly string[]).includes(src) ? "console" : "booth";
}

export function isBoothOwned(planSource: unknown): boolean {
  return partOwner(planSource) === "booth";
}

export function isConsoleOwned(planSource: unknown): boolean {
  return partOwner(planSource) === "console";
}

/** Read a task's plan_source from the column, falling back to metadata. */
export function taskPlanSource(task: {
  plan_source?: string | null;
  metadata?: unknown;
}): string | null {
  if (task.plan_source) return task.plan_source;
  const meta = (task.metadata || {}) as Record<string, unknown>;
  return typeof meta.plan_source === "string" ? meta.plan_source : null;
}

/** The AI plan / analyze routes may run only while Booth owns the song. */
export function canAiPlanRun(editMode: unknown): boolean {
  return normalizeEditMode(editMode) === "booth";
}

/** The AI plan may change a part only if Booth owns the song AND the part. */
export function canAiPlanTouch(editMode: unknown, planSource: unknown): boolean {
  return canAiPlanRun(editMode) && isBoothOwned(planSource);
}

/** Console may change a part only once it owns the song AND the part. */
export function canConsoleTouch(editMode: unknown, planSource: unknown): boolean {
  return normalizeEditMode(editMode) === "console" && isConsoleOwned(planSource);
}

/** Keep only the parts the AI plan is allowed to change. */
export function filterAiTouchable<T extends { plan_source?: string | null; metadata?: unknown }>(
  editMode: unknown,
  tasks: T[]
): T[] {
  return tasks.filter((t) => canAiPlanTouch(editMode, taskPlanSource(t)));
}

export const CONSOLE_LOCK_MESSAGE =
  "This song is being edited in Console. The AI plan no longer changes it.";
