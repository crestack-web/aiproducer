/**
 * Deterministic song blueprint for DEV_MODE / fallback.
 * Later: replace with LLM JSON (Zod-validated).
 */

export type SectionType =
  | "intro"
  | "verse"
  | "pre_chorus"
  | "chorus"
  | "bridge"
  | "outro";

export type TaskType = "lead" | "double" | "harmony" | "adlib" | "hum" | "background_vocal";

export interface BlueprintTask {
  type: TaskType;
  instruction: string;
  required: boolean;
  priority: number;
}

export interface BlueprintSection {
  type: SectionType;
  label: string;
  role: string;
  start_ms: number;
  end_ms: number;
  order_index: number;
  energy: string;
  tasks: BlueprintTask[];
}

const LAYER: Record<TaskType, { instruction: string; required: boolean; priority: number }> = {
  lead: {
    instruction: "Sing the main melody here. Keep it clear and natural.",
    required: true,
    priority: 10,
  },
  double: {
    instruction: "Sing the same line again with slightly less intensity.",
    required: false,
    priority: 7,
  },
  harmony: {
    instruction: "Sing softly underneath your main vocal.",
    required: false,
    priority: 6,
  },
  adlib: {
    instruction: "Add a few short vocal responses in the empty spaces.",
    required: false,
    priority: 4,
  },
  hum: {
    instruction: "Give me a soft hum to set the mood.",
    required: false,
    priority: 3,
  },
  background_vocal: {
    instruction: "Layer a quiet background vocal under this section.",
    required: false,
    priority: 5,
  },
};

function tasks(...types: TaskType[]): BlueprintTask[] {
  return types.map((t) => ({ type: t, ...LAYER[t] }));
}

export function generateDevBlueprint(input: {
  genre?: string | null;
  mood?: string | null;
  bpm?: number | null;
  durationMs?: number | null;
}): BlueprintSection[] {
  const genre = (input.genre || "R&B").toLowerCase();
  const duration = input.durationMs && input.durationMs > 5000 ? input.durationMs : 180_000;

  const templates: {
    type: SectionType;
    label: string;
    role: string;
    energy: string;
    weight: number;
    taskTypes: TaskType[];
  }[] =
    genre.includes("afro") || genre.includes("amapiano") || genre.includes("highlife")
      ? [
          { type: "intro", label: "Intro", role: "Set the groove", energy: "low", weight: 1, taskTypes: ["hum"] },
          { type: "verse", label: "Verse 1", role: "Tell the story", energy: "medium", weight: 2, taskTypes: ["lead"] },
          { type: "chorus", label: "Chorus", role: "The hook", energy: "high", weight: 2, taskTypes: ["lead", "double", "adlib"] },
          { type: "verse", label: "Verse 2", role: "Continue the story", energy: "medium", weight: 2, taskTypes: ["lead"] },
          { type: "chorus", label: "Chorus", role: "Hook again", energy: "high", weight: 2, taskTypes: ["lead", "harmony", "adlib"] },
          { type: "outro", label: "Outro", role: "Land the song", energy: "low", weight: 1, taskTypes: ["hum"] },
        ]
      : genre.includes("hip")
        ? [
            { type: "intro", label: "Intro", role: "Atmosphere", energy: "low", weight: 1, taskTypes: ["adlib"] },
            { type: "verse", label: "Verse 1", role: "Bars", energy: "medium", weight: 3, taskTypes: ["lead"] },
            { type: "chorus", label: "Hook", role: "Catchy hook", energy: "high", weight: 2, taskTypes: ["lead", "double"] },
            { type: "verse", label: "Verse 2", role: "More bars", energy: "medium", weight: 3, taskTypes: ["lead"] },
            { type: "chorus", label: "Hook", role: "Hook out", energy: "high", weight: 2, taskTypes: ["lead", "adlib"] },
            { type: "outro", label: "Outro", role: "Fade", energy: "low", weight: 1, taskTypes: ["adlib"] },
          ]
        : [
            { type: "intro", label: "Intro", role: "Set the mood", energy: "low", weight: 1, taskTypes: ["hum"] },
            { type: "verse", label: "Verse 1", role: "Tell your story — keep it relaxed", energy: "medium", weight: 2, taskTypes: ["lead"] },
            { type: "pre_chorus", label: "Pre-Chorus", role: "Build into the hook", energy: "medium", weight: 1, taskTypes: ["lead"] },
            { type: "chorus", label: "Chorus", role: "Your strongest melody", energy: "high", weight: 2, taskTypes: ["lead", "double", "harmony", "adlib"] },
            { type: "verse", label: "Verse 2", role: "Second verse", energy: "medium", weight: 2, taskTypes: ["lead"] },
            { type: "chorus", label: "Chorus", role: "Hook again", energy: "high", weight: 2, taskTypes: ["lead", "double", "adlib"] },
            { type: "bridge", label: "Bridge", role: "Something different", energy: "medium", weight: 1.5, taskTypes: ["lead", "harmony"] },
            { type: "chorus", label: "Final Chorus", role: "Big finish", energy: "high", weight: 2, taskTypes: ["lead", "double", "harmony", "adlib"] },
            { type: "outro", label: "Outro", role: "Soft landing", energy: "low", weight: 1, taskTypes: ["hum"] },
          ];

  const totalWeight = templates.reduce((s, t) => s + t.weight, 0);
  let cursor = 0;
  return templates.map((t, i) => {
    const len = Math.floor((t.weight / totalWeight) * duration);
    const start_ms = cursor;
    const end_ms = i === templates.length - 1 ? duration : cursor + len;
    cursor = end_ms;
    return {
      type: t.type,
      label: t.label,
      role: t.role,
      start_ms,
      end_ms,
      order_index: i,
      energy: t.energy,
      tasks: tasks(...t.taskTypes),
    };
  });
}

export interface AnalysisSnapshot {
  duration_ms: number;
  bpm: number | null;
  key: string | null;
  source: "dev_mock" | "audio_analysis";
}
