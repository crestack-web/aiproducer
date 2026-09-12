/**
 * Mistral Voxtral Mini Transcribe — preferred ASR for Producer Mind lyrics.
 * https://api.mistral.ai/v1/audio/transcriptions
 * Env: MISTRAL_API_KEY, optional MISTRAL_TRANSCRIBE_MODEL (default voxtral-mini-latest)
 */
import { encodeStereoWav } from "../dsp";
import type { PcmStereo } from "../types";
import type { LyricWord, TranscriptionResult } from "./types";
import { groupWordsIntoPhrases } from "./group-phrases";

function getApiKey(): string | null {
  return process.env.MISTRAL_API_KEY?.trim() || null;
}

function pcmToWavBuffer(pcm: PcmStereo, maxSeconds = 180): Buffer {
  const sr = pcm.sampleRate;
  const maxSamples = Math.floor(maxSeconds * sr);
  const n = Math.min(pcm.left.length, maxSamples);
  const left = pcm.left.subarray(0, n);
  const right = pcm.right.length >= n ? pcm.right.subarray(0, n) : left;
  return encodeStereoWav({
    left: new Float32Array(left),
    right: new Float32Array(right),
    sampleRate: sr,
  });
}

function toMs(t: number): number {
  // API may return seconds (float) or already ms
  if (t > 1000) return Math.round(t);
  return Math.round(t * 1000);
}

export async function transcribeWithMistral(pcm: PcmStereo): Promise<TranscriptionResult | null> {
  const key = getApiKey();
  if (!key) return null;

  const model = process.env.MISTRAL_TRANSCRIBE_MODEL?.trim() || "voxtral-mini-latest";
  const wav = pcmToWavBuffer(pcm);

  try {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(wav)], { type: "audio/wav" }), "vocal.wav");
    form.append("model", model);
    // word timestamps for phrase rides; segment as secondary
    form.append("timestamp_granularities", "word");

    const res = await fetch("https://api.mistral.ai/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.warn("[ap-asr] mistral failed", res.status, errText.slice(0, 240));
      return null;
    }

    const json = (await res.json()) as {
      text?: string;
      language?: string;
      duration?: number;
      words?: Array<{
        word?: string;
        text?: string;
        start?: number;
        end?: number;
        confidence?: number;
        probability?: number;
      }>;
      segments?: Array<{
        text?: string;
        start?: number;
        end?: number;
        words?: Array<{ word?: string; text?: string; start?: number; end?: number }>;
      }>;
    };

    let words: LyricWord[] = [];

    if (Array.isArray(json.words) && json.words.length) {
      words = json.words
        .map((w) => {
          const text = (w.word || w.text || "").trim();
          if (!text || w.start == null || w.end == null) return null;
          return {
            text,
            startMs: toMs(Number(w.start)),
            endMs: toMs(Number(w.end)),
            confidence:
              typeof w.confidence === "number"
                ? w.confidence
                : typeof w.probability === "number"
                  ? w.probability
                  : undefined,
          } as LyricWord;
        })
        .filter((w): w is LyricWord => Boolean(w));
    } else if (Array.isArray(json.segments)) {
      for (const seg of json.segments) {
        if (seg.words?.length) {
          for (const w of seg.words) {
            const text = (w.word || w.text || "").trim();
            if (!text || w.start == null || w.end == null) continue;
            words.push({
              text,
              startMs: toMs(Number(w.start)),
              endMs: toMs(Number(w.end)),
            });
          }
        } else if (seg.text && seg.start != null && seg.end != null) {
          words.push({
            text: String(seg.text).trim(),
            startMs: toMs(Number(seg.start)),
            endMs: toMs(Number(seg.end)),
          });
        }
      }
    }

    let phrases = groupWordsIntoPhrases(words);
    if (!phrases.length && json.text?.trim()) {
      phrases = [
        {
          text: json.text.trim(),
          startMs: 0,
          endMs:
            json.duration != null
              ? toMs(Number(json.duration))
              : Math.round((pcm.left.length / pcm.sampleRate) * 1000),
        },
      ];
    }

    if (!phrases.length) return null;

    return {
      phrases,
      language: json.language ?? null,
      source: "mistral_voxtral",
      durationMs: json.duration != null ? toMs(Number(json.duration)) : undefined,
    };
  } catch (e) {
    console.warn("[ap-asr] mistral exception", e instanceof Error ? e.message : e);
    return null;
  }
}
