import type {
  MusicGenerationRequest,
  MusicProviderName,
  ProviderGenerateResult,
  ProviderPollResult,
  ProviderSubmitResult,
} from "./types";

export interface MusicGenerationProvider {
  readonly name: MusicProviderName;
  checkAvailability?(): Promise<void>;
  submitPrediction(req: MusicGenerationRequest & { prompt: string }): Promise<ProviderSubmitResult>;
  pollPrediction(providerPredictionId: string): Promise<ProviderPollResult>;
  downloadOutput(outputUrl: string): Promise<{ buffer: Buffer; contentType: string; extension: string }>;
  generate?(req: MusicGenerationRequest & { prompt: string }): Promise<ProviderGenerateResult>;
  maxDurationSec(kind: "preview" | "full"): number;
}

/** True when the free-text prompt is too vague to generate without more controls. */
export function isVagueBeatPrompt(prompt?: string | null): boolean {
  const p = (prompt || "").trim().toLowerCase();
  if (!p) return true;
  if (p.length < 12) return true;
  const vague = /^(make|create|give|generate|need|want)\s+(me\s+)?(a\s+)?(beat|track|instrumental|song)s?\.?$/i;
  if (vague.test(p)) return true;
  if (/^(beat|instrumental|music|track)$/i.test(p)) return true;
  return false;
}

/**
 * Build a specific instrumental prompt for the provider.
 * Prefer explicit artist controls over generic defaults.
 */
export function buildInstrumentalPrompt(input: {
  prompt?: string;
  genre?: string;
  mood?: string;
  bpm?: number;
  key?: string;
  energy?: string;
  structure?: string;
  instrumentation?: string;
  referenceStyle?: string;
}): string {
  const genre = (input.genre || "").trim();
  const mood = (input.mood || "").trim();
  const energy = (input.energy || "").trim();
  const instrumentation = (input.instrumentation || "").trim();
  const referenceStyle = (input.referenceStyle || "").trim();
  const bpm = input.bpm && input.bpm > 0 ? input.bpm : undefined;
  const key = (input.key || "").trim();
  const structure =
    (input.structure || "").trim() ||
    "short intro, verse with space for vocals, fuller chorus, brief bridge, outro";

  const parts: string[] = [];

  if (input.prompt?.trim() && !isVagueBeatPrompt(input.prompt)) {
    parts.push(input.prompt.trim());
  }

  if (genre) parts.push(`${genre} instrumental production`);
  if (mood) parts.push(`mood: ${mood}`);
  if (energy) parts.push(`energy: ${energy}`);
  if (bpm) parts.push(`${bpm} BPM`);
  if (key) parts.push(`key: ${key}`);
  if (instrumentation) {
    parts.push(`instrumentation emphasis: ${instrumentation}`);
  } else {
    parts.push("drums, bass, harmony instruments, atmospheric textures");
  }
  if (referenceStyle) {
    parts.push(`in the style / feel of: ${referenceStyle} (inspired by, not a copy)`);
  }
  parts.push(structure);
  parts.push("spacious midrange designed for a lead vocal to sit on top");
  parts.push("professional contemporary arrangement");
  parts.push("Instrumental only. No vocals. No lyrics. No spoken words.");

  return parts.filter(Boolean).join(". ");
}
