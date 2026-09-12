/** Aligned lyric units for Producer Mind — matches layer.lyrics contract. */

export type LyricWord = {
  text: string;
  startMs: number;
  endMs: number;
  confidence?: number;
};

export type LyricPhrase = {
  text: string;
  startMs: number;
  endMs: number;
  words?: LyricWord[];
  /** ASR confidence 0–1 for this phrase (min/avg of words when available) */
  confidence?: number;
};

export type TranscriptionResult = {
  phrases: LyricPhrase[];
  language?: string | null;
  source: "openai_whisper" | "none" | "empty";
  durationMs?: number;
};
