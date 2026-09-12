/**
 * Optional OpenAI Whisper transcription (word timestamps).
 * Only runs when OPENAI_API_KEY is set — never required for Produce.
 */
import { writeFile, unlink } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { randomBytes } from "crypto";
import type { LyricWord, TranscriptionResult } from "./types";
import { groupWordsIntoPhrases } from "./group-phrases";
import { encodeStereoWav } from "../dsp";
import type { PcmStereo } from "../types";

function getApiKey(): string | null {
  return process.env.OPENAI_API_KEY?.trim() || null;
}

/** Downsample / trim mono for upload size (Whisper accepts wav). */
function pcmToWavBuffer(pcm: PcmStereo, maxSeconds = 180): Buffer {
  const sr = pcm.sampleRate;
  const maxSamples = Math.floor(maxSeconds * sr);
  const n = Math.min(pcm.left.length, maxSamples);
  const left = pcm.left.subarray(0, n);
  const right = pcm.right.length >= n ? pcm.right.subarray(0, n) : left;
  return encodeStereoWav({ left: new Float32Array(left), right: new Float32Array(right), sampleRate: sr });
}

export async function transcribeWithOpenAI(pcm: PcmStereo): Promise<TranscriptionResult | null> {
  const key = getApiKey();
  if (!key) return null;

  const wav = pcmToWavBuffer(pcm);
  const id = randomBytes(6).toString("hex");
  const path = join(tmpdir(), `ap-asr-${id}.wav`);
  try {
    await writeFile(path, wav);
    const form = new FormData();
    const blob = new Blob([new Uint8Array(wav)], { type: "audio/wav" });
    form.append("file", blob, "vocal.wav");
    form.append("model", process.env.OPENAI_WHISPER_MODEL?.trim() || "whisper-1");
    form.append("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "word");

    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.warn("[ap-asr] openai failed", res.status, errText.slice(0, 200));
      return null;
    }
    const json = (await res.json()) as {
      text?: string;
      language?: string;
      duration?: number;
      words?: Array<{ word?: string; start?: number; end?: number; probability?: number }>;
      segments?: Array<{
        text?: string;
        start?: number;
        end?: number;
        words?: Array<{ word?: string; start?: number; end?: number }>;
      }>;
    };

    let words: LyricWord[] = [];
    if (Array.isArray(json.words) && json.words.length) {
      words = json.words
        .filter((w) => w.word && w.start != null && w.end != null)
        .map((w) => ({
          text: String(w.word).trim(),
          startMs: Math.round(Number(w.start) * 1000),
          endMs: Math.round(Number(w.end) * 1000),
          confidence: typeof w.probability === "number" ? w.probability : undefined,
        }));
    } else if (Array.isArray(json.segments)) {
      for (const seg of json.segments) {
        if (seg.words?.length) {
          for (const w of seg.words) {
            if (w.word == null || w.start == null || w.end == null) continue;
            words.push({
              text: String(w.word).trim(),
              startMs: Math.round(Number(w.start) * 1000),
              endMs: Math.round(Number(w.end) * 1000),
            });
          }
        } else if (seg.text && seg.start != null && seg.end != null) {
          words.push({
            text: String(seg.text).trim(),
            startMs: Math.round(Number(seg.start) * 1000),
            endMs: Math.round(Number(seg.end) * 1000),
          });
        }
      }
    }

    const phrases = groupWordsIntoPhrases(words);
    if (!phrases.length && json.text?.trim()) {
      phrases.push({
        text: json.text.trim(),
        startMs: 0,
        endMs: Math.round((json.duration || 0) * 1000) || pcm.left.length / pcm.sampleRate * 1000,
      });
    }

    return {
      phrases,
      language: json.language ?? null,
      source: "openai_whisper",
      durationMs: json.duration != null ? Math.round(json.duration * 1000) : undefined,
    };
  } catch (e) {
    console.warn("[ap-asr] exception", e instanceof Error ? e.message : e);
    return null;
  } finally {
    await unlink(path).catch(() => undefined);
  }
}
