/**
 * AI Choir generation — provider-agnostic types.
 * Controlla Voice is the product reference for quality; Kits AI is the
 * currently documented public API for multi-voice conversion + pitch shift.
 */

export type ChoirStyle =
  | "african_gospel"
  | "contemporary_gospel"
  | "worship"
  | "soul"
  | "pop"
  | "cinematic";

export type ChoirArrangement = "light" | "medium" | "full" | "powerful";

export type ChoirBalance = "female" | "male" | "mixed";

export type HarmonyIntensity = "subtle" | "moderate" | "rich";

export type ChoirSectionRole = "soprano" | "alto" | "tenor" | "bass" | "double";

export type ChoirGenerateRequest = {
  /** Dry lead vocal (wav/mp3/flac bytes) */
  sourceAudio: Buffer;
  sourceFileName?: string;
  style: ChoirStyle;
  arrangement: ChoirArrangement;
  balance: ChoirBalance;
  harmonyIntensity: HarmonyIntensity;
  /** Optional musical key hint e.g. "E minor" — passed when provider supports it */
  keyHint?: string | null;
};

export type GeneratedChoirPart = {
  role: ChoirSectionRole;
  label: string;
  /** Raw audio bytes (wav/mp3 as returned by provider or local encode) */
  audio: Buffer;
  contentType: string;
  /** Relative gain suggestion in dB under the lead */
  gainDb: number;
  pan: number;
  /** Provider job id when applicable */
  providerJobId?: string | number;
  voiceModelId?: number | string;
};

export type ChoirGenerateResult = {
  provider: string;
  /** true when outputs come from AI voice models, not local DSP clones */
  isAiGenerated: boolean;
  parts: GeneratedChoirPart[];
  warnings: string[];
};

export interface ChoirProvider {
  readonly id: string;
  readonly displayName: string;
  isConfigured(): boolean;
  generate(req: ChoirGenerateRequest): Promise<ChoirGenerateResult>;
}
