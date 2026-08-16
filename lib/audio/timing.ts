/**
 * Single source of truth for musical timing.
 * All section / recording / stem / planner / RoEx code should use these helpers.
 */

export type TimeSignature = { numerator: number; denominator: number };

export const DEFAULT_TIME_SIGNATURE: TimeSignature = { numerator: 4, denominator: 4 };

export function parseTimeSignature(raw?: string | null): TimeSignature {
  if (!raw || typeof raw !== "string") return { ...DEFAULT_TIME_SIGNATURE };
  const m = raw.trim().match(/^(\d+)\s*\/\s*(\d+)$/);
  if (!m) return { ...DEFAULT_TIME_SIGNATURE };
  const numerator = Math.max(1, parseInt(m[1], 10) || 4);
  const denominator = Math.max(1, parseInt(m[2], 10) || 4);
  return { numerator, denominator };
}

export function beatsPerBar(ts: TimeSignature = DEFAULT_TIME_SIGNATURE): number {
  // For common meters, bar length in quarter-note beats ≈ numerator * (4 / denominator)
  return (ts.numerator * 4) / ts.denominator;
}

export function secondsPerBeat(bpm: number): number {
  const b = Number(bpm);
  if (!Number.isFinite(b) || b <= 0) throw new Error("BPM_REQUIRED");
  return 60 / b;
}

export function secondsPerBar(bpm: number, ts: TimeSignature = DEFAULT_TIME_SIGNATURE): number {
  return secondsPerBeat(bpm) * beatsPerBar(ts);
}

/** Bar numbers are 1-indexed. Bar 1 starts at t=0. */
export function barToSeconds(
  bar: number,
  bpm: number,
  ts: TimeSignature = DEFAULT_TIME_SIGNATURE
): number {
  const b = Math.max(1, Number(bar) || 1);
  return (b - 1) * secondsPerBar(bpm, ts);
}

export function secondsToBar(
  seconds: number,
  bpm: number,
  ts: TimeSignature = DEFAULT_TIME_SIGNATURE
): number {
  const spb = secondsPerBar(bpm, ts);
  if (spb <= 0) return 1;
  return Math.max(1, Math.floor(Number(seconds) / spb) + 1);
}

export function barRangeToTimeRange(
  startBar: number,
  endBar: number,
  bpm: number,
  ts: TimeSignature = DEFAULT_TIME_SIGNATURE
): { start_s: number; end_s: number; duration_s: number; start_ms: number; end_ms: number; duration_ms: number } {
  const start = Math.max(1, Math.min(Number(startBar) || 1, Number(endBar) || 1));
  const end = Math.max(start, Number(endBar) || start);
  // end_bar is inclusive: bars 17–24 → from start of 17 through end of 24
  const start_s = barToSeconds(start, bpm, ts);
  const end_s = barToSeconds(end + 1, bpm, ts);
  const duration_s = Math.max(0, end_s - start_s);
  return {
    start_s,
    end_s,
    duration_s,
    start_ms: Math.round(start_s * 1000),
    end_ms: Math.round(end_s * 1000),
    duration_ms: Math.round(duration_s * 1000),
  };
}

export function timeRangeToBarRange(
  startMs: number,
  endMs: number,
  bpm: number,
  ts: TimeSignature = DEFAULT_TIME_SIGNATURE
): { start_bar: number; end_bar: number } {
  const start_bar = secondsToBar(Math.max(0, startMs) / 1000, bpm, ts);
  // inclusive end bar: last bar that still overlaps the range
  const endSec = Math.max(0, endMs) / 1000;
  const spb = secondsPerBar(bpm, ts);
  const end_bar = Math.max(start_bar, Math.ceil(endSec / spb) || start_bar);
  return { start_bar, end_bar };
}

export function msToDisplay(ms: number): string {
  const total = Math.max(0, Math.round(ms / 100) / 10); // 0.1s precision
  const m = Math.floor(total / 60);
  const s = total - m * 60;
  const ss = s.toFixed(1).padStart(4, "0");
  return `${String(m).padStart(2, "0")}:${ss}`;
}

export type AlignmentStatus = "ok" | "needs_alignment" | "unknown";

/**
 * Compare uploaded duration vs expected section window.
 * Small drift is ok; large mismatch flags NEEDS_ALIGNMENT.
 */
export function assessDurationAlignment(
  actualDurationMs: number | null | undefined,
  expectedDurationMs: number | null | undefined,
  opts?: { toleranceMs?: number; relativeTolerance?: number }
): { status: AlignmentStatus; delta_ms: number | null; expected_ms: number | null; actual_ms: number | null } {
  const toleranceMs = opts?.toleranceMs ?? 800;
  const relativeTolerance = opts?.relativeTolerance ?? 0.12;
  if (actualDurationMs == null || expectedDurationMs == null || expectedDurationMs <= 0) {
    return { status: "unknown", delta_ms: null, expected_ms: expectedDurationMs ?? null, actual_ms: actualDurationMs ?? null };
  }
  const delta = actualDurationMs - expectedDurationMs;
  const abs = Math.abs(delta);
  const rel = abs / expectedDurationMs;
  const status: AlignmentStatus =
    abs <= toleranceMs || rel <= relativeTolerance ? "ok" : "needs_alignment";
  return { status, delta_ms: delta, expected_ms: expectedDurationMs, actual_ms: actualDurationMs };
}

export function resolveProjectBpm(input: {
  projectTempo?: number | null;
  beatBpm?: number | null;
  metadataBpm?: number | null;
}): { bpm: number | null; source: string | null } {
  if (input.beatBpm && Number(input.beatBpm) > 0) return { bpm: Number(input.beatBpm), source: "beat" };
  if (input.projectTempo && Number(input.projectTempo) > 0) return { bpm: Number(input.projectTempo), source: "project" };
  if (input.metadataBpm && Number(input.metadataBpm) > 0) return { bpm: Number(input.metadataBpm), source: "metadata" };
  return { bpm: null, source: null };
}
