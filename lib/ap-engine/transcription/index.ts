import type { PcmStereo } from "../types";
import type { TranscriptionResult } from "./types";
import { transcribeWithMistral } from "./mistral-voxtral";
import { transcribeWithOpenAI } from "./openai-whisper";

export type { LyricPhrase, LyricWord, TranscriptionResult } from "./types";
export { groupWordsIntoPhrases } from "./group-phrases";

/**
 * Transcribe a vocal layer.
 * Prefer Mistral Voxtral (MISTRAL_API_KEY); fall back to OpenAI Whisper (OPENAI_API_KEY).
 */
export async function transcribeVocalLayer(pcm: PcmStereo): Promise<TranscriptionResult> {
  const mistral = await transcribeWithMistral(pcm);
  if (mistral && mistral.phrases.length) return mistral;

  const openai = await transcribeWithOpenAI(pcm);
  if (openai && openai.phrases.length) return openai;

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
