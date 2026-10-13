/**
 * Timeline automation for Track FX parameters.
 * Stored on recording_tasks.metadata.fx_automation (JSON).
 * Applied in live monitor (sampled each tick) and offline Produce (future).
 */

export type AutomationParamKey =
  | "gainDb"
  | "pan"
  | "reverb"
  | "delay"
  | "plateReverb"
  | "highPassHz"
  | "width"
  | "compress";

export type AutomationPoint = {
  id: string;
  /** Timeline position in ms */
  timeMs: number;
  value: number;
  /** linear only for v1 */
  curve?: "linear";
};

export type AutomationLane = {
  id: string;
  trackId: string;
  param: AutomationParamKey;
  points: AutomationPoint[];
};

export type FxAutomationDoc = {
  version: 1;
  lanes: AutomationLane[];
};

export function emptyAutomation(): FxAutomationDoc {
  return { version: 1, lanes: [] };
}

export function parseFxAutomation(raw: unknown): FxAutomationDoc {
  if (!raw || typeof raw !== "object") return emptyAutomation();
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.lanes)) return emptyAutomation();
  return {
    version: 1,
    lanes: o.lanes
      .filter((l) => l && typeof l === "object")
      .map((l) => {
        const lane = l as Record<string, unknown>;
        return {
          id: String(lane.id || `lane_${Math.random().toString(36).slice(2, 9)}`),
          trackId: String(lane.trackId || ""),
          param: (lane.param as AutomationParamKey) || "gainDb",
          points: Array.isArray(lane.points)
            ? (lane.points as AutomationPoint[])
                .filter((p) => p && typeof p.timeMs === "number")
                .map((p) => ({
                  id: String(p.id || `pt_${Math.random().toString(36).slice(2, 9)}`),
                  timeMs: Number(p.timeMs),
                  value: Number(p.value),
                  curve: "linear" as const,
                }))
                .sort((a, b) => a.timeMs - b.timeMs)
            : [],
        };
      })
      .filter((l) => l.trackId),
  };
}

/** Sample lane value at timeMs with linear interpolation */
export function sampleLane(lane: AutomationLane, timeMs: number): number | null {
  const pts = lane.points;
  if (!pts.length) return null;
  if (timeMs <= pts[0].timeMs) return pts[0].value;
  if (timeMs >= pts[pts.length - 1].timeMs) return pts[pts.length - 1].value;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (timeMs >= a.timeMs && timeMs <= b.timeMs) {
      const t = (timeMs - a.timeMs) / Math.max(1, b.timeMs - a.timeMs);
      return a.value + (b.value - a.value) * t;
    }
  }
  return pts[pts.length - 1].value;
}

export function upsertPoint(
  doc: FxAutomationDoc,
  trackId: string,
  param: AutomationParamKey,
  timeMs: number,
  value: number
): FxAutomationDoc {
  const lanes = [...doc.lanes];
  let lane = lanes.find((l) => l.trackId === trackId && l.param === param);
  if (!lane) {
    lane = {
      id: `lane_${trackId}_${param}`,
      trackId,
      param,
      points: [],
    };
    lanes.push(lane);
  }
  const pts = [...lane.points];
  const existing = pts.find((p) => Math.abs(p.timeMs - timeMs) < 40);
  if (existing) {
    existing.value = value;
    existing.timeMs = timeMs;
  } else {
    pts.push({
      id: `pt_${Math.random().toString(36).slice(2, 9)}`,
      timeMs,
      value,
      curve: "linear",
    });
  }
  pts.sort((a, b) => a.timeMs - b.timeMs);
  lane = { ...lane, points: pts };
  return {
    version: 1,
    lanes: lanes.map((l) => (l.id === lane!.id ? lane! : l)),
  };
}
