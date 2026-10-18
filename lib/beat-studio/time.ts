import { DEFAULT_PPQ } from "./types";

/** Seconds per tick at given tempo and PPQ */
export function secondsPerTick(tempoBpm: number, ppq: number = DEFAULT_PPQ): number {
  const bpm = Math.max(20, Math.min(300, tempoBpm || 120));
  const p = Math.max(1, ppq || DEFAULT_PPQ);
  return 60 / bpm / p;
}

export function ticksToSeconds(ticks: number, tempoBpm: number, ppq: number = DEFAULT_PPQ): number {
  return Math.max(0, ticks) * secondsPerTick(tempoBpm, ppq);
}

export function secondsToTicks(seconds: number, tempoBpm: number, ppq: number = DEFAULT_PPQ): number {
  const spt = secondsPerTick(tempoBpm, ppq);
  if (spt <= 0) return 0;
  return Math.round(Math.max(0, seconds) / spt);
}

/** Pattern length in ticks */
export function patternLengthTicks(
  bars: number,
  timeSignature: [number, number],
  ppq: number = DEFAULT_PPQ
): number {
  const [num, den] = timeSignature;
  const beatsPerBar = num * (4 / Math.max(1, den));
  return Math.max(1, Math.round(bars * beatsPerBar * ppq));
}

export function quantizeTick(tick: number, gridTicks: number): number {
  const g = Math.max(1, gridTicks);
  return Math.round(tick / g) * g;
}
