/**
 * Editable musical starter patterns — not AI-generated.
 */

import type { BeatStudioDoc, BeatStudioNote } from "./types";
import { emptyBeatStudioDoc, DEFAULT_PPQ } from "./types";
import { newNoteId } from "./engine";
import {
  DRUM_LANES,
  STEPS_PER_BAR,
  stepGridToNotes,
  defaultStepGrid,
  emptyStepGrid,
  type StepGrid,
  type DrumLaneId,
} from "./drums";

export type BeatPresetId =
  | "rnb"
  | "afrobeat"
  | "hiphop"
  | "trap"
  | "lofi"
  | "empty";

export type BeatPreset = {
  id: BeatPresetId;
  label: string;
  description: string;
  tempoBpm: number;
  bars: number;
  /** Build drum grid */
  drums: (steps: number) => StepGrid;
  /** Optional melody notes (MIDI) */
  melody?: (ppq: number) => BeatStudioNote[];
  instrumentId?: "pluck" | "synth_lead" | "synth_bass";
};

function setSteps(g: StepGrid, lane: DrumLaneId, indices: number[]) {
  for (const i of indices) {
    if (i >= 0 && i < g[lane].length) g[lane][i] = true;
  }
}

export const BEAT_PRESETS: BeatPreset[] = [
  {
    id: "rnb",
    label: "Emotional R&B",
    description: "Soft kick, snare on 2 & 4, light hats",
    tempoBpm: 78,
    bars: 2,
    instrumentId: "pluck",
    drums: (steps) => {
      const g = emptyStepGrid(steps);
      setSteps(g, "kick", [0, 6, 10, 16, 22, 26]);
      setSteps(g, "snare", [8, 24]);
      setSteps(g, "hihat_closed", [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30].filter((x) => x < steps));
      setSteps(g, "clap", [8, 24]);
      return g;
    },
    melody: (ppq) => {
      // simple Am progression outline
      const q = ppq; // quarter
      const notes: BeatStudioNote[] = [];
      const add = (pitch: number, start: number, dur: number) =>
        notes.push({ id: newNoteId(), pitch, startTick: start, durationTicks: dur, velocity: 90 });
      add(57, 0, q * 2); // A3
      add(60, q * 2, q * 2); // C4
      add(64, q * 4, q * 2); // E4
      add(62, q * 6, q * 2); // D4
      return notes;
    },
  },
  {
    id: "afrobeat",
    label: "Afrobeat",
    description: "Syncopated kick, busy hats, rim energy",
    tempoBpm: 108,
    bars: 2,
    instrumentId: "synth_bass",
    drums: (steps) => {
      const g = emptyStepGrid(steps);
      setSteps(g, "kick", [0, 5, 8, 11, 16, 21, 24, 27].filter((x) => x < steps));
      setSteps(g, "snare", [4, 12, 20, 28].filter((x) => x < steps));
      setSteps(g, "hihat_closed", Array.from({ length: steps }, (_, i) => i).filter((i) => i % 2 === 0));
      setSteps(g, "hihat_open", [6, 14, 22, 30].filter((x) => x < steps));
      setSteps(g, "perc", [2, 10, 18, 26].filter((x) => x < steps));
      return g;
    },
  },
  {
    id: "hiphop",
    label: "Hip-hop",
    description: "Boom-bap pocket",
    tempoBpm: 90,
    bars: 2,
    instrumentId: "synth_bass",
    drums: (steps) => {
      const g = emptyStepGrid(steps);
      setSteps(g, "kick", [0, 7, 10, 16, 23, 26].filter((x) => x < steps));
      setSteps(g, "snare", [8, 24]);
      setSteps(g, "hihat_closed", [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30].filter((x) => x < steps));
      return g;
    },
  },
  {
    id: "trap",
    label: "Trap",
    description: "808s feel + rolling hats",
    tempoBpm: 140,
    bars: 2,
    instrumentId: "synth_bass",
    drums: (steps) => {
      const g = emptyStepGrid(steps);
      setSteps(g, "kick", [0, 7, 10, 16, 19, 26].filter((x) => x < steps));
      setSteps(g, "snare", [8, 24]);
      setSteps(g, "hihat_closed", Array.from({ length: steps }, (_, i) => i));
      setSteps(g, "clap", [8, 24]);
      return g;
    },
  },
  {
    id: "lofi",
    label: "Lo-fi",
    description: "Lazy swing-friendly pocket",
    tempoBpm: 84,
    bars: 2,
    instrumentId: "pluck",
    drums: (steps) => {
      const g = emptyStepGrid(steps);
      setSteps(g, "kick", [0, 10, 16, 26].filter((x) => x < steps));
      setSteps(g, "snare", [8, 24]);
      setSteps(g, "hihat_closed", [2, 6, 10, 14, 18, 22, 26, 30].filter((x) => x < steps));
      return g;
    },
  },
  {
    id: "empty",
    label: "Blank",
    description: "Empty grid — start from scratch",
    tempoBpm: 100,
    bars: 2,
    drums: (steps) => emptyStepGrid(steps),
  },
];

export function applyPreset(preset: BeatPreset): BeatStudioDoc {
  const steps = preset.bars * STEPS_PER_BAR;
  const grid = preset.drums(steps);
  const drumNotes = stepGridToNotes(grid, steps, DEFAULT_PPQ);
  const melodyNotes = preset.melody?.(DEFAULT_PPQ) ?? [];
  return emptyBeatStudioDoc({
    tempoBpm: preset.tempoBpm,
    bars: preset.bars,
    loop: true,
    tracks: [
      {
        id: "track_drums",
        name: "Drums",
        instrumentId: "drum_kit",
        notes: drumNotes,
      },
      {
        id: "track_melody",
        name: "Melody",
        instrumentId: preset.instrumentId || "pluck",
        notes: melodyNotes,
      },
    ],
  });
}

export { defaultStepGrid };
