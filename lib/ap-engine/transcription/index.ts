import type { PcmStereo } from "../types";
import type { TranscriptionResult } from "./types";
import { transcribeWithMistral } from "./mistral-voxtral";
import { transcribeWithOpenAI } from "./openai-whisper";

export type { LyricPhrase, LyricWord, TranscriptionResult } from "./types";
export { groupWordsIntoPhrases } from "./group-phrases";

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<T>((_, rej) => {
        timer = setTimeout(() => rej(new Error(`${label}_timeout_${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Transcribe a vocal layer with hard per-provider timeouts.
 * Prefer Mistral Voxtral; fall back to OpenAI Whisper.
 * On any failure/timeout returns empty phrases (energy-based phrase fallback upstream).
 */
export async function transcribeVocalLayer(pcm: PcmStereo): Promise<TranscriptionResult> {
  if (process.env.AP_SKIP_ASR === "1" || process.env.AP_SKIP_ASR === "true") {
    return { phrases: [], source: "none" };
  }
  const perProviderMs = Number(process.env.AP_ASR_TIMEOUT_MS || 12000);

  try {
    const mistral = await withTimeout(transcribeWithMistral(pcm), perProviderMs, "mistral_asr");
    if (mistral && mistral.phrases.length) return mistral;
  } catch {
    /* soft-fail */
  }

  try {
    const openai = await withTimeout(transcribeWithOpenAI(pcm), perProviderMs, "openai_asr");
    if (openai && openai.phrases.length) return openai;
  } catch {
    /* soft-fail */
  }

  return { phrases: [], source: "none" };
}

/** Map transcription into Producer Mind layer.lyrics shape. */
export function toLayerLyrics(result: TranscriptionResult): Array<{
  text: string;
  startMs: number;
  endMs: number;
  confidence?: number;
}> {
  return result.phrases.map((p) => ({
    text: p.text,
    startMs: p.startMs,
    endMs: p.endMs,
    confidence: p.confidence,
  }));
}
