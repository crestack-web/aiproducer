/**
 * ProductionPlanner — decides what the SONG needs to sound professional,
 * then turns that into one-at-a-time human recording instructions.
 *
 * Song Blueprint  = sections
 * Production Blueprint = ordered ProductionTasks
 * User never sees stems, busses, EQ, or multitrack UI.
 */

import type { SectionType } from "./blueprint";

export type ProductionTaskType =
  | "LEAD"
  | "DOUBLE"
  | "HIGH_HARMONY"
  | "LOW_HARMONY"
  | "BACKGROUND"
  | "CALL_RESPONSE"
  | "ADLIB"
  | "HUM"
  | "CHANT"
  | "WHISPER"
  | "TEXTURE"
  | "SPOKEN"
  | "TRANSITION"
  | "SUSTAIN"
  | "EMOTIONAL_TAKE"
  | "INTRO_VOCAL"
  | "OUTRO_VOCAL";

export interface SongSectionInput {
  id?: string;
  type: SectionType | string;
  label: string;
  start_ms: number;
  end_ms: number;
  order_index: number;
  energy?: string | null;
}

export interface ProductionTask {
  type: ProductionTaskType;
  title: string;
  instruction: string;
  reason: string;
  start_ms: number;
  end_ms: number;
  required: boolean;
  priority: number;
  section_order: number;
  section_label: string;
  section_type: string;
  depends_on_type?: ProductionTaskType | null;
  metadata: Record<string, unknown>;
}

export interface ProductionBlueprint {
  energy_curve: { section_order: number; label: string; energy_pct: number }[];
  tasks: ProductionTask[];
  notes: string[];
}

export interface PlannerInput {
  genre?: string | null;
  mood?: string | null;
  sections: SongSectionInput[];
  lyrics_by_section?: Record<string, string>;
}

const ENERGY_BY_TYPE: Record<string, number> = {
  intro: 20,
  verse: 40,
  pre_chorus: 65,
  chorus: 90,
  bridge: 35,
  outro: 20,
};

const LAYER_BUDGET: Record<string, number> = {
  intro: 1,
  verse: 2,
  pre_chorus: 3,
  chorus: 5,
  bridge: 3,
  outro: 2,
};

type LayerSpec = { type: ProductionTaskType; required: boolean; priority: number };

function normalizeGenre(g?: string | null): "rnb" | "afro" | "hiphop" | "gospel" | "pop" | "default" {
  const x = (g || "").toLowerCase();
  if (x.includes("gospel") || x.includes("faith")) return "gospel";
  if (x.includes("afro") || x.includes("amapiano") || x.includes("highlife")) return "afro";
  if (x.includes("hip")) return "hiphop";
  if (x.includes("r&b") || x.includes("rnb") || x.includes("soul")) return "rnb";
  if (x.includes("pop")) return "pop";
  return "default";
}

function energyFor(section: SongSectionInput, index: number, total: number): number {
  const base = ENERGY_BY_TYPE[section.type] ?? 50;
  if (section.type === "chorus" && index >= total - 3) return Math.max(base, 100);
  if (section.type === "verse" && index > 2) return Math.min(base + 5, 50);
  return base;
}

function budgetFor(sectionType: string, energyPct: number): number {
  const base = LAYER_BUDGET[sectionType] ?? 3;
  if (energyPct >= 95) return base + 1;
  if (energyPct <= 30) return Math.min(base, 2);
  return base;
}

function candidateLayers(
  sectionType: string,
  genre: ReturnType<typeof normalizeGenre>,
  energyPct: number
): LayerSpec[] {
  const lead: LayerSpec = { type: "LEAD", required: true, priority: 100 };
  if (sectionType === "intro") {
    return genre === "hiphop"
      ? [{ type: "ADLIB", required: false, priority: 40 }]
      : [{ type: "HUM", required: false, priority: 40 }];
  }
  if (sectionType === "outro") {
    return [
      { type: "HUM", required: false, priority: 40 },
      { type: "TEXTURE", required: false, priority: 30 },
    ];
  }
  const layers: LayerSpec[] = [lead];
  if (sectionType === "verse") {
    if (energyPct >= 45) layers.push({ type: "ADLIB", required: false, priority: 35 });
    return layers;
  }
  if (sectionType === "pre_chorus") {
    layers.push({ type: "HIGH_HARMONY", required: false, priority: 55 });
    return layers;
  }
  if (sectionType === "bridge") {
    layers.push({ type: "WHISPER", required: false, priority: 50 });
    layers.push({ type: "HIGH_HARMONY", required: false, priority: 45 });
    return layers;
  }
  if (sectionType === "chorus") {
    layers.push({ type: "DOUBLE", required: false, priority: 80 });
    if (genre === "afro" || genre === "gospel") {
      layers.push({ type: "CALL_RESPONSE", required: false, priority: 70 });
      layers.push({ type: "ADLIB", required: false, priority: 50 });
      if (genre === "gospel") layers.push({ type: "BACKGROUND", required: false, priority: 60 });
    } else if (genre === "hiphop") {
      layers.push({ type: "ADLIB", required: false, priority: 65 });
    } else {
      layers.push({ type: "HIGH_HARMONY", required: false, priority: 70 });
      layers.push({ type: "ADLIB", required: false, priority: 55 });
      if (energyPct >= 90) layers.push({ type: "BACKGROUND", required: false, priority: 50 });
      if (energyPct >= 100) layers.push({ type: "SUSTAIN", required: false, priority: 45 });
    }
  }
  return layers;
}

export function humanCopy(
  type: ProductionTaskType,
  sectionLabel: string,
  opts?: { isFinalChorus?: boolean; mood?: string | null }
): { title: string; instruction: string; reason: string } {
  const section = sectionLabel || "this part";
  switch (type) {
    case "LEAD":
      return {
        title: `Main ${section.toLowerCase()}`,
        instruction: section.toLowerCase().includes("chorus") || section.toLowerCase().includes("hook")
          ? "Give me your strongest version of this part. Clear, confident, and natural."
          : "Sing the main melody here. Keep it clear and natural — like you're telling the story.",
        reason: "This is the core performance everything else supports.",
      };
    case "DOUBLE":
      return {
        title: "Make it bigger",
        instruction: "Sing this part again, but slightly softer than your main take.",
        reason: "A second pass makes the important lines feel wider and more polished.",
      };
    case "HIGH_HARMONY":
      return {
        title: "Add another color",
        instruction: "Sing underneath your main vocal with a softer, different melody.",
        reason: "A higher harmony adds depth without competing with the lead.",
      };
    case "LOW_HARMONY":
      return {
        title: "Warm it from below",
        instruction: "Sing a lower, softer melody under your main lines.",
        reason: "A low harmony thickens the vocal without getting in the way.",
      };
    case "BACKGROUND":
      return {
        title: "Soft support",
        instruction: "Give me a soft 'ooh' or 'ahh' underneath the final lines.",
        reason: "Background support makes the ending of the section feel finished.",
      };
    case "CALL_RESPONSE":
      return {
        title: "Answer yourself",
        instruction: "After each main line, answer with a short response — like a second voice in the room.",
        reason: "Call-and-response is part of what makes this style feel alive.",
      };
    case "ADLIB":
      return {
        title: "Fill the empty spaces",
        instruction: "Add a few short reactions in the gaps between your main lines.",
        reason: "Small reactions add personality and fill space the beat leaves open.",
      };
    case "HUM":
      return {
        title: "Set the mood",
        instruction: "Give me a soft hum — no words needed.",
        reason: "A hum opens or closes the song without competing with the beat.",
      };
    case "WHISPER":
      return {
        title: "Keep it close",
        instruction: "Whisper or sing very softly — intimate, almost private.",
        reason: "A quieter texture creates contrast before the song opens back up.",
      };
    case "SUSTAIN":
      return {
        title: "Hold the last line",
        instruction: "On the final line, hold a soft sustained note underneath.",
        reason: "A sustain helps the biggest section land emotionally.",
      };
    case "TEXTURE":
      return {
        title: "Atmosphere",
        instruction: "Add a soft vocal texture — light, airy, in the background.",
        reason: "Texture fills the space without needing another full take.",
      };
    default:
      return {
        title: section,
        instruction: "Perform this part in your natural voice.",
        reason: "Every part should serve the song.",
      };
  }
}

export function planProduction(input: PlannerInput): ProductionBlueprint {
  const genre = normalizeGenre(input.genre);
  const sections = [...input.sections].sort((a, b) => a.order_index - b.order_index);
  const notes: string[] = [];
  const energy_curve = sections.map((sec, i) => ({
    section_order: sec.order_index,
    label: sec.label,
    energy_pct: energyFor(sec, i, sections.length),
  }));

  const tasks: ProductionTask[] = [];
  let globalPriority = 1000;

  for (let i = 0; i < sections.length; i++) {
    const sec = sections[i];
    const energyPct = energy_curve[i].energy_pct;
    const budget = budgetFor(sec.type, energyPct);
    const candidates = candidateLayers(sec.type, genre, energyPct).slice(0, budget);
    if (candidates.length === 0 && sec.type !== "intro" && sec.type !== "outro") {
      candidates.push({ type: "LEAD", required: true, priority: 100 });
    }
    for (const layer of candidates) {
      const copy = humanCopy(layer.type, sec.label, {
        isFinalChorus: energyPct >= 100,
        mood: input.mood,
      });
      let start = sec.start_ms;
      let end = sec.end_ms;
      const dur = Math.max(0, end - start);
      if (layer.type === "ADLIB" || layer.type === "TEXTURE") {
        start = sec.start_ms + Math.floor(dur * 0.15);
        end = sec.end_ms - Math.floor(dur * 0.05);
      }
      if (layer.type === "BACKGROUND" || layer.type === "SUSTAIN") {
        start = sec.start_ms + Math.floor(dur * 0.55);
      }
      tasks.push({
        type: layer.type,
        title: copy.title,
        instruction: copy.instruction,
        reason: copy.reason,
        start_ms: start,
        end_ms: end,
        required: layer.required,
        priority: globalPriority - (100 - layer.priority),
        section_order: sec.order_index,
        section_label: sec.label,
        section_type: sec.type,
        depends_on_type: layer.type === "LEAD" ? null : "LEAD",
        metadata: {
          energy_pct: energyPct,
          genre_family: genre,
          vocal_part: vocalPartLabel(layer.type),
          /** song_section = core lead; production_layer = stacked vocal on same section */
          category: layer.type === "LEAD" ? "song_section" : "production_layer",
          layer_role: layer.type.toLowerCase(),
          parent_section_label: sec.label,
          parent_section_type: sec.type,
          depends_on_lead: layer.type !== "LEAD",
        },
      });
      globalPriority -= 1;
    }
  }

  notes.push(
    `Genre family: ${genre}`,
    `Tasks: ${tasks.length} (required: ${tasks.filter((t) => t.required).length})`,
    "Plan optimizes for contrast: sparse verses, fuller choruses, intimate bridge."
  );

  tasks.sort((a, b) => {
    if (a.start_ms !== b.start_ms) return a.start_ms - b.start_ms;
    if (a.required !== b.required) return a.required ? -1 : 1;
    return b.priority - a.priority;
  });

  return { energy_curve, tasks, notes };
}

function vocalPartLabel(type: ProductionTaskType): string {
  switch (type) {
    case "LEAD":
    case "EMOTIONAL_TAKE":
      return "Lead";
    case "DOUBLE":
      return "Double";
    case "HIGH_HARMONY":
    case "LOW_HARMONY":
      return "Harmony";
    case "BACKGROUND":
    case "TEXTURE":
    case "HUM":
      return "Backing";
    case "CALL_RESPONSE":
      return "Response";
    case "ADLIB":
    case "CHANT":
      return "Adlib";
    case "WHISPER":
      return "Texture";
    default:
      return "Vocal";
  }
}

/** Adaptive stub for post-take decisions (full audio analysis later). */
export function adaptPlanAfterTake(input: {
  tasks: ProductionTask[];
  completedType?: ProductionTaskType;
  perceivedFullness?: number;
}): { skipTaskTypes: ProductionTaskType[]; message: string } {
  const fullness = input.perceivedFullness ?? 0.5;
  if (input.completedType === "LEAD" && fullness >= 0.85) {
    return {
      skipTaskTypes: ["DOUBLE"],
      message: "Your lead already feels full. We can skip the extra pass and keep moving.",
    };
  }
  if (input.completedType === "LEAD" && fullness <= 0.35) {
    return {
      skipTaskTypes: [],
      message: "Nice start. Let's make this part bigger with one more soft take.",
    };
  }
  if (input.completedType === "DOUBLE" && fullness >= 0.75) {
    return {
      skipTaskTypes: ["BACKGROUND"],
      message: "That's enough thickness here. Let's not overdo it.",
    };
  }
  return { skipTaskTypes: [], message: "Good. Here's the next thing this section needs." };
}

export function toDbTaskType(type: ProductionTaskType): string {
  return type.toLowerCase();
}
