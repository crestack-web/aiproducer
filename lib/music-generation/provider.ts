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

export function buildInstrumentalPrompt(input: {
  prompt?: string;
  genre?: string;
  mood?: string;
  bpm?: number;
  key?: string;
  energy?: string;
  structure?: string;
}): string {
  if (input.prompt?.trim()) {
    const p = input.prompt.trim();
    if (/instrumental|no vocals|no singing|no lyrics/i.test(p)) return p;
    return `${p}. Instrumental only. No vocals. No lyrics. No spoken words. Leave space in the midrange for a lead vocal.`;
  }
  const genre = input.genre || "contemporary";
  const mood = input.mood || "emotional";
  const bpm = input.bpm || 95;
  const energy = input.energy || "medium";
  const key = input.key ? `in ${input.key}` : "";
  const structure =
    input.structure ||
    "short intro, verse with space for vocals, fuller chorus, brief bridge, outro";
  return [
    `Create an instrumental ${genre} production`,
    `mood: ${mood}`,
    `energy: ${energy}`,
    `${bpm} BPM`,
    key,
    structure,
    "drums, bass, harmony instruments, atmospheric textures",
    "spacious midrange designed for a lead vocal to sit on top",
    "professional contemporary arrangement",
    "Instrumental only. No vocals. No lyrics. No spoken words.",
  ]
    .filter(Boolean)
    .join(". ");
}
