/**
 * AP full-engine checkpoint state — allows produce to span multiple Vercel ticks.
 */
export type ApCheckpointPhase = "restoring" | "arranging" | "done";

export type ApRestoredLayerMeta = {
  index: number;
  storagePath: string;
  role: string;
  sectionLabel?: string | null;
  taskType?: string | null;
  startMs: number;
  pathHint?: string;
  noiseFloorBeforeDb?: number;
  noiseFloorAfterDb?: number;
  restoreConfidence?: string;
};

export type ApCheckpoint = {
  phase: ApCheckpointPhase;
  /** Next vocal index to restore (0-based). */
  restoreIndex: number;
  layers: ApRestoredLayerMeta[];
  tickCount: number;
  wallStartedAt: string;
  stageTimingsMs: Record<string, number>;
  lastCheckpointAt?: string;
  resumedFrom?: string;
};

export function emptyCheckpoint(): ApCheckpoint {
  return {
    phase: "restoring",
    restoreIndex: 0,
    layers: [],
    tickCount: 0,
    wallStartedAt: new Date().toISOString(),
    stageTimingsMs: {},
  };
}

export function restoredLayerPath(
  userId: string,
  projectId: string,
  jobId: string,
  index: number
): string {
  return `users/${userId}/projects/${projectId}/production/${jobId}/cp-restored-${index}.wav`;
}
