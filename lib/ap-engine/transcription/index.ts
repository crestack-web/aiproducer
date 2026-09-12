import type { PcmStereo } from "../types";
import type { LyricPhrase, TranscriptionResult } from "./types";
import { transcribeWithOpenAI } from "./openai-whisper";

export type { LyricPhrase, LyricWord, TranscriptionResult } from "./types";
export { groupWordsIntoPhrases } from "./group-phrases";

/**
 * Transcribe a vocal layer. Returns empty phrases if no provider configured.
 */
export async function transcribeVocalLayer(pcm: PcmStereo): Promise<TranscriptionResult> {
  const openai = await transcribeWithOpenAI(pcm);
  if (openai && openai.phrases.length) return openai;
  return { phrases: [], source: "none" };
}

/** Map transcription into Producer Mind layer.lyrics shape (startMs/endMs). */
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
