/**
 * Drum step grid ↔ MIDI notes on drum_kit track.
 * Pitches map to synthesis ranges in createDrumInstrument.
 */

import type { BeatStudioNote, BeatStudioTrack } from "./types";
import { DEFAULT_PPQ } from "./types";
import { newNoteId } from "./engine";

export const STEPS_PER_BAR = 16; // 16ths in 4/4

export type DrumLaneId =
  | "kick"
  | "snare"
  | "clap"
  | "hihat_closed"
  | "hihat_open"
  | "perc";

export type DrumLane = {
  id: DrumLaneId;
  label: string;
  /** MIDI pitch for drum_kit synthesizer bands */
  pitch: number;
  color: string;
};

export const DRUM_LANES: DrumLane[] = [
  { id: "kick", label: "Kick", pitch: 36, color: "#E85A52" },
  { id: "snare", label: "Snare", pitch: 38, color: "#E7A961" },
  { id: "clap", label: "Clap", pitch: 39, color: "#F0BC80" },
  { id: "hihat_closed", label: "Hat Cl", pitch: 42, color: "#7BEBD4" },
  { id: "hihat_open", label: "Hat Op", pitch: 46, color: "#5BC4B0" },
  { id: "perc", label: "Perc", pitch: 56, color: "#C4A0FF" },
];

/** step index → tick (16th notes) */
export function stepToTick(step: number, ppq = DEFAULT_PPQ): number {
  return Math.round(step * (ppq / 4));
}

export function tickToStep(tick: number, ppq = DEFAULT_PPQ): number {
  return Math.round(tick / (ppq / 4));
}

export type StepGrid = Record<DrumLaneId, boolean[]>;

export function emptyStepGrid(steps: number): StepGrid {
  const g = {} as StepGrid;
  for (const lane of DRUM_LANES) {
    g[lane.id] = Array.from({ length: steps }, () => false);
  }
  return g;
}

/** Basic starter: four-on-floor + snare backbeat + hats */
export function defaultStepGrid(steps: number): StepGrid {
  const g = emptyStepGrid(steps);
  for (let i = 0; i < steps; i++) {
    if (i % 4 === 0) g.kick[i] = true;
    if (i % 8 === 4) g.snare[i] = true;
    if (i % 2 === 0) g.hihat_closed[i] = true;
  }
  return g;
}

export function notesToStepGrid(
  notes: BeatStudioNote[],
  steps: number,
  ppq = DEFAULT_PPQ
): StepGrid {
  const g = emptyStepGrid(steps);
  const pitchToLane = new Map(DRUM_LANES.map((l) => [l.pitch, l.id]));
  for (const n of notes) {
    const lane = pitchToLane.get(n.pitch);
    if (!lane) continue;
    const step = tickToStep(n.startTick, ppq);
    if (step >= 0 && step < steps) g[lane][step] = true;
  }
  return g;
}

export function stepGridToNotes(
  grid: StepGrid,
  steps: number,
  ppq = DEFAULT_PPQ,
  velocity = 110
): BeatStudioNote[] {
  const notes: BeatStudioNote[] = [];
  const dur = Math.max(1, Math.round(ppq / 8)); // short hits
  for (const lane of DRUM_LANES) {
    const row = grid[lane.id] || [];
    for (let s = 0; s < steps; s++) {
      if (!row[s]) continue;
      notes.push({
        id: newNoteId(),
        pitch: lane.pitch,
        startTick: stepToTick(s, ppq),
        durationTicks: dur,
        velocity,
      });
    }
  }
  return notes;
}

export function ensureDrumTrack(tracks: BeatStudioTrack[]): BeatStudioTrack[] {
  const has = tracks.some((t) => t.instrumentId === "drum_kit" || t.id === "track_drums");
  if (has) return tracks;
  return [
    {
      id: "track_drums",
      name: "Drums",
      instrumentId: "drum_kit",
      notes: stepGridToNotes(defaultStepGrid(STEPS_PER_BAR * 2), STEPS_PER_BAR * 2),
    },
    ...tracks,
  ];
}

export function totalSteps(bars: number, stepsPerBar = STEPS_PER_BAR): number {
  return Math.max(stepsPerBar, bars * stepsPerBar);
}
