/**
 * Timeline automation for Track FX parameters.
 * Stored on recording_tasks.metadata.fx_automation (JSON).
 * Applied in live monitor (Audio clock / playhead sample) and offline Produce.
 */

export type AutomationParamKey =
  | "gainDb"
  | "pan"
  | "reverb"
  | "delay"
  | "plateReverb"
  | "highPassHz"
  | "lowPassHz"
  | "eqLowDb"
  | "eqMidDb"
  | "eqHighDb"
  | "air"
  | "width"
  | "compress"
  | "saturation"
  | "chorus"
  | "doubler"
  | "slapDelay"
  | "deEss"
  | "limiter"
  | "telephone";

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
  enabled?: boolean;
};

export type FxAutomationDoc = {
  version: 1;
  lanes: AutomationLane[];
};

/** Valid value ranges for automated parameters */
export const AUTOMATION_PARAM_RANGE: Record<
  AutomationParamKey,
  { min: number; max: number; unit: string; live: boolean; produce: boolean }
> = {
  gainDb: { min: -24, max: 12, unit: "dB", live: true, produce: true },
  pan: { min: -1, max: 1, unit: "", live: true, produce: true },
  reverb: { min: 0, max: 1, unit: "", live: true, produce: true },
  delay: { min: 0, max: 1, unit: "", live: true, produce: true },
  plateReverb: { min: 0, max: 1, unit: "", live: true, produce: true },
  highPassHz: { min: 0, max: 400, unit: "Hz", live: true, produce: true },
  lowPassHz: { min: 0, max: 18000, unit: "Hz", live: true, produce: true },
  eqLowDb: { min: -12, max: 12, unit: "dB", live: true, produce: true },
  eqMidDb: { min: -12, max: 12, unit: "dB", live: true, produce: true },
  eqHighDb: { min: -12, max: 12, unit: "dB", live: true, produce: true },
  air: { min: 0, max: 1, unit: "", live: true, produce: true },
  width: { min: 0, max: 1, unit: "", live: true, produce: true },
  compress: { min: 0, max: 1, unit: "", live: true, produce: true },
  saturation: { min: 0, max: 1, unit: "", live: true, produce: true },
  chorus: { min: 0, max: 1, unit: "", live: true, produce: true },
  doubler: { min: 0, max: 1, unit: "", live: true, produce: true },
  slapDelay: { min: 0, max: 1, unit: "", live: true, produce: true },
  deEss: { min: 0, max: 1, unit: "", live: true, produce: true },
  limiter: { min: 0, max: 1, unit: "", live: true, produce: true },
  telephone: { min: 0, max: 1, unit: "", live: true, produce: true },
};

const VALID_PARAMS = new Set<string>(Object.keys(AUTOMATION_PARAM_RANGE));

export function emptyAutomation(): FxAutomationDoc {
  return { version: 1, lanes: [] };
}

function clampParam(param: AutomationParamKey, value: number): number {
  const r = AUTOMATION_PARAM_RANGE[param];
  if (!r || !Number.isFinite(value)) return r?.min ?? 0;
  return Math.max(r.min, Math.min(r.max, value));
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
        const paramRaw = String(lane.param || "gainDb");
        const param = (VALID_PARAMS.has(paramRaw) ? paramRaw : "gainDb") as AutomationParamKey;
        return {
          id: String(lane.id || `lane_${Math.random().toString(36).slice(2, 9)}`),
          trackId: String(lane.trackId || ""),
          param,
          enabled: lane.enabled !== false,
          points: Array.isArray(lane.points)
            ? (lane.points as AutomationPoint[])
                .filter(
                  (p) =>
                    p &&
                    typeof p === "object" &&
                    Number.isFinite(Number((p as AutomationPoint).timeMs)) &&
                    Number.isFinite(Number((p as AutomationPoint).value))
                )
                .map((p) => ({
                  id: String(p.id || `pt_${Math.random().toString(36).slice(2, 9)}`),
                  timeMs: Math.max(0, Number(p.timeMs)),
                  value: clampParam(param, Number(p.value)),
                  curve: "linear" as const,
                }))
                .sort((a, b) => a.timeMs - b.timeMs)
            : [],
        };
      })
      .filter((l) => l.trackId),
  };
}

/** Sample lane value at timeMs with linear interpolation. Null if empty/disabled. */
export function sampleLane(lane: AutomationLane, timeMs: number): number | null {
  if (lane.enabled === false) return null;
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

/** Overlay automation values onto a base TrackFx-like object at timeMs */
export function sampleTrackAutomation(
  doc: FxAutomationDoc,
  trackId: string,
  timeMs: number
): Partial<Record<AutomationParamKey, number>> {
  const out: Partial<Record<AutomationParamKey, number>> = {};
  for (const lane of doc.lanes) {
    if (lane.trackId !== trackId) continue;
    const v = sampleLane(lane, timeMs);
    if (v !== null) out[lane.param] = v;
  }
  return out;
}

export function upsertPoint(
  doc: FxAutomationDoc,
  trackId: string,
  param: AutomationParamKey,
  timeMs: number,
  value: number
): FxAutomationDoc {
  if (!VALID_PARAMS.has(param)) return doc;
  const t = Math.max(0, Number(timeMs) || 0);
  const val = clampParam(param, value);
  const lanes = doc.lanes.map((l) => ({
    ...l,
    points: l.points.map((p) => ({ ...p })),
  }));
  let lane = lanes.find((l) => l.trackId === trackId && l.param === param);
  if (!lane) {
    lane = {
      id: `lane_${trackId}_${param}`,
      trackId,
      param,
      enabled: true,
      points: [],
    };
    lanes.push(lane);
  }
  const pts = lane.points;
  const existing = pts.find((p) => Math.abs(p.timeMs - t) < 40);
  if (existing) {
    existing.value = val;
    existing.timeMs = t;
  } else {
    pts.push({
      id: `pt_${Math.random().toString(36).slice(2, 9)}`,
      timeMs: t,
      value: val,
      curve: "linear",
    });
  }
  pts.sort((a, b) => a.timeMs - b.timeMs);
  return { version: 1, lanes: lanes };
}

export function clearLane(
  doc: FxAutomationDoc,
  trackId: string,
  param: AutomationParamKey
): FxAutomationDoc {
  return {
    version: 1,
    lanes: doc.lanes.filter((l) => !(l.trackId === trackId && l.param === param)),
  };
}

/** Remove one keyframe by id from a lane */
export function removePoint(
  doc: FxAutomationDoc,
  trackId: string,
  param: AutomationParamKey,
  pointId: string
): FxAutomationDoc {
  return {
    version: 1,
    lanes: doc.lanes
      .map((l) => {
        if (l.trackId !== trackId || l.param !== param) return l;
        return { ...l, points: l.points.filter((p) => p.id !== pointId) };
      })
      .filter((l) => l.points.length > 0),
  };
}

/** Move / set a keyframe by id */
export function updatePoint(
  doc: FxAutomationDoc,
  trackId: string,
  param: AutomationParamKey,
  pointId: string,
  patch: { timeMs?: number; value?: number }
): FxAutomationDoc {
  return {
    version: 1,
    lanes: doc.lanes.map((l) => {
      if (l.trackId !== trackId || l.param !== param) return l;
      const points = l.points
        .map((p) => {
          if (p.id !== pointId) return p;
          return {
            ...p,
            timeMs:
              patch.timeMs != null
                ? Math.max(0, Number(patch.timeMs) || 0)
                : p.timeMs,
            value:
              patch.value != null ? clampParam(param, Number(patch.value)) : p.value,
          };
        })
        .sort((a, b) => a.timeMs - b.timeMs);
      return { ...l, points };
    }),
  };
}

export function setLaneEnabled(
  doc: FxAutomationDoc,
  trackId: string,
  param: AutomationParamKey,
  enabled: boolean
): FxAutomationDoc {
  return {
    version: 1,
    lanes: doc.lanes.map((l) =>
      l.trackId === trackId && l.param === param ? { ...l, enabled } : l
    ),
  };
}

/** Create a two-point linear fade / ramp */
export function applyLinearRamp(
  doc: FxAutomationDoc,
  trackId: string,
  param: AutomationParamKey,
  startMs: number,
  endMs: number,
  startValue: number,
  endValue: number
): FxAutomationDoc {
  let next = upsertPoint(doc, trackId, param, startMs, startValue);
  next = upsertPoint(next, trackId, param, endMs, endValue);
  return next;
}

/** Bars → ms using project BPM (4/4 assumed) */
export function barsToMs(bars: number, bpm: number): number {
  const b = Math.max(1, bpm || 120);
  return (bars * 4 * 60_000) / b;
}

export function secondsToMs(sec: number): number {
  return Math.max(0, sec * 1000);
}
