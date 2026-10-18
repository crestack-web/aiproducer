import { DEFAULT_PPQ } from "./types";

/**
 * Musical time helpers.
 * seconds = ticks * (60 / tempoBpm / ppq)
 * ticks   = seconds / (60 / tempoBpm / ppq)
 */

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

/** Pattern length in ticks from bars + time signature */
export function patternLengthTicks(
  bars: number,
  timeSignature: [number, number],
  ppq: number = DEFAULT_PPQ
): number {
  const [num, den] = timeSignature;
  const beatsPerBar = num * (4 / Math.max(1, den));
  return Math.max(1, Math.round(Math.max(1, bars) * beatsPerBar * ppq));
}

export function quantizeTick(tick: number, gridTicks: number): number {
  const g = Math.max(1, gridTicks);
  return Math.round(tick / g) * g;
}

/** 16th-note grid in ticks */
export function sixteenthGridTicks(ppq: number = DEFAULT_PPQ): number {
  return Math.max(1, Math.round(ppq / 4));
}
