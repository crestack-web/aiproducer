import type { LyricPhrase, LyricWord } from "./types";

/**
 * Group word-level timestamps into breath-to-breath phrases using pause gaps.
 */
export function groupWordsIntoPhrases(
  words: LyricWord[],
  opts?: { pauseMs?: number; maxPhraseMs?: number }
): LyricPhrase[] {
  const pauseMs = opts?.pauseMs ?? 280;
  const maxPhraseMs = opts?.maxPhraseMs ?? 12000;
  if (!words.length) return [];

  const phrases: LyricPhrase[] = [];
  let bucket: LyricWord[] = [words[0]];

  const flush = () => {
    if (!bucket.length) return;
    const text = bucket
      .map((w) => w.text)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    const confs = bucket.map((w) => w.confidence).filter((c): c is number => c != null);
    const confidence = confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : undefined;
    phrases.push({
      text,
      startMs: bucket[0].startMs,
      endMs: bucket[bucket.length - 1].endMs,
      words: [...bucket],
      confidence,
    });
    bucket = [];
  };

  for (let i = 1; i < words.length; i++) {
    const prev = words[i - 1];
    const cur = words[i];
    const gap = cur.startMs - prev.endMs;
    const span = cur.endMs - bucket[0].startMs;
    if (gap >= pauseMs || span >= maxPhraseMs) {
      flush();
    }
    bucket.push(cur);
  }
  flush();
  return phrases;
}
