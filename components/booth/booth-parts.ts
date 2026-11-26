/** Pure helpers for the Booth song plan cards (no React). */

export type BoothPartState = "done" | "skipped" | "todo";

export type BoothPart = {
  id: string;
  label: string;
  title: string;
  hint: string | null;
  durationSec: number | null;
  state: BoothPartState;
  optional: boolean;
};

export type BoothPartInput = {
  id: string;
  type?: string | null;
  title?: string | null;
  instruction?: string | null;
  status?: string | null;
  required?: boolean | null;
  start_ms?: number | null;
  end_ms?: number | null;
  metadata?: { section_label?: string | null } | null;
};

export function partState(status: string | null | undefined): BoothPartState {
  const s = String(status || "").toLowerCase();
  if (s === "completed" || s === "done" || s === "recorded") return "done";
  if (s === "skipped" || s === "cancelled") return "skipped";
  return "todo";
}

export function toBoothParts(
  rows: BoothPartInput[],
  labelFor: (row: BoothPartInput) => string,
  titleFor: (type: string) => string
): BoothPart[] {
  return [...rows]
    .sort((a, b) => (Number(a.start_ms) || 0) - (Number(b.start_ms) || 0))
    .map((r) => {
      const start = Number(r.start_ms);
      const end = Number(r.end_ms);
      const dur =
        Number.isFinite(start) && Number.isFinite(end) && end > start ? Math.round((end - start) / 1000) : null;
      return {
        id: r.id,
        label: labelFor(r),
        title: r.title?.trim() || titleFor(String(r.type || "")),
        hint: r.instruction?.trim() || null,
        durationSec: dur,
        state: partState(r.status),
        optional: r.required === false,
      };
    });
}

/** Required parts that still need a take. "Make my song" unlocks at zero. */
export function remainingRequired(parts: BoothPart[]): number {
  return parts.filter((p) => !p.optional && p.state === "todo").length;
}

export function canMakeSong(parts: BoothPart[]): boolean {
  return parts.some((p) => p.state === "done") && remainingRequired(parts) === 0;
}

export function nextPart(parts: BoothPart[]): BoothPart | null {
  return (
    parts.find((p) => !p.optional && p.state === "todo") ||
    parts.find((p) => p.state === "todo") ||
    null
  );
}

export function progressRatio(parts: BoothPart[]): number {
  const counted = parts.filter((p) => p.state !== "skipped");
  if (!counted.length) return 0;
  return counted.filter((p) => p.state === "done").length / counted.length;
}

/** 4-beat count-in length at the song tempo, clamped to a sane range. */
export function countInMs(tempoBpm: number | null | undefined): number {
  const bpm = Number(tempoBpm);
  if (!Number.isFinite(bpm) || bpm <= 0) return 3000;
  return Math.min(4000, Math.max(1500, Math.round((4 * 60000) / bpm)));
}

/** Beats left (4 → 1) for a count-in with `remainingMs` to go. */
export function countInBeatsLeft(remainingMs: number, totalMs: number): number {
  if (remainingMs <= 0) return 0;
  const beatMs = totalMs / 4;
  return Math.min(4, Math.max(1, Math.ceil(remainingMs / beatMs)));
}

export function fmtSeconds(sec: number | null): string {
  if (sec == null) return "";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, "0")}` : `${s}s`;
}
