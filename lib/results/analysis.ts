/**
 * Results screen analysis helpers (browser-safe, no DOM).
 * Chorus cue, loudest-window fallback, and the streaming quality badge.
 */
import type { PcmStereo } from "@/lib/ap-engine/types";
import { countClippedSamples, measureIntegratedLufs, truePeakDbtp } from "@/lib/ap-engine/master/lufs";

export type ResultsLayer = {
  audio_url?: string | null;
  start_ms?: number | null;
  end_ms?: number | null;
  section_label?: string | null;
  title?: string | null;
};

export type QualityBadge = {
  lufs: number;
  truePeakDbtp: number;
  clippedSamples: number;
  passed: boolean;
};

const CHORUS_RE = /\b(chorus|hook|refrain)\b/i;

/** Earliest chorus/hook start from the plan layers, in ms. */
export function chorusStartFromLayers(layers: ResultsLayer[]): number | null {
  let best: number | null = null;
  for (const l of layers) {
    const label = `${l.section_label || ""} ${l.title || ""}`;
    if (!CHORUS_RE.test(label)) continue;
    const s = typeof l.start_ms === "number" && Number.isFinite(l.start_ms) ? l.start_ms : null;
    if (s == null) continue;
    if (best == null || s < best) best = s;
  }
  return best;
}

/** Start (ms) of the loudest window of `windowSec` seconds. */
export function loudestWindowStartMs(pcm: PcmStereo, windowSec = 20): number {
  const sr = pcm.sampleRate;
  const n = Math.min(pcm.left.length, pcm.right.length);
  const block = Math.max(1, Math.round(sr * 0.5));
  const blocks: number[] = [];
  for (let s = 0; s < n; s += block) {
    let e = 0;
    const end = Math.min(n, s + block);
    for (let i = s; i < end; i++) {
      const v = 0.5 * ((pcm.left[i] || 0) + (pcm.right[i] || 0));
      e += v * v;
    }
    blocks.push(e);
  }
  const win = Math.max(1, Math.round(windowSec / 0.5));
  if (blocks.length <= win) return 0;
  let acc = 0;
  for (let i = 0; i < win; i++) acc += blocks[i];
  let bestAcc = acc;
  let bestIdx = 0;
  for (let i = win; i < blocks.length; i++) {
    acc += blocks[i] - blocks[i - win];
    if (acc > bestAcc) {
      bestAcc = acc;
      bestIdx = i - win + 1;
    }
  }
  return Math.round(bestIdx * 500);
}

/**
 * Where playback should start: the first chorus minus a one-bar lead-in,
 * else the loudest 20 s window. Songs under 30 s start at 0.
 */
export function resolveStartSec(opts: {
  pcm: PcmStereo;
  layers: ResultsLayer[];
  bpm?: number | null;
}): { startSec: number; from: "chorus" | "loudest" | "start" } {
  const durSec = Math.min(opts.pcm.left.length, opts.pcm.right.length) / opts.pcm.sampleRate;
  if (durSec < 30) return { startSec: 0, from: "start" };
  const bpm = opts.bpm && opts.bpm > 40 && opts.bpm < 220 ? opts.bpm : 96;
  const barSec = (60 / bpm) * 4;
  const chorusMs = chorusStartFromLayers(opts.layers);
  if (chorusMs != null && chorusMs / 1000 < durSec - 5) {
    return { startSec: Math.max(0, chorusMs / 1000 - barSec), from: "chorus" };
  }
  const loudMs = loudestWindowStartMs(opts.pcm, 20);
  return { startSec: Math.max(0, Math.min(durSec - 5, loudMs / 1000)), from: "loudest" };
}

/**
 * Streaming quality badge measured on the decoded master preview.
 * The master is limited to -1 dBTP before MP3 encoding; decoding can add a few tenths
 * of a dB of inter-sample overshoot, so the preview check allows up to -0.5 dBTP.
 */
export function measureQualityBadge(pcm: PcmStereo): QualityBadge {
  const lufs = measureIntegratedLufs(pcm);
  const tp = truePeakDbtp(pcm);
  const clipped = countClippedSamples(pcm);
  const passed = lufs >= -14.5 && lufs <= -8 && tp <= -0.5 && clipped === 0;
  return { lufs, truePeakDbtp: tp, clippedSamples: clipped, passed };
}

/** Gain that makes `pcm` play at the same integrated loudness as `reference`. */
export function loudnessMatchGain(pcm: PcmStereo, referenceLufs: number): number {
  const l = measureIntegratedLufs(pcm);
  if (l <= -69 || referenceLufs <= -69) return 1;
  const g = Math.pow(10, (referenceLufs - l) / 20);
  return Math.max(0.1, Math.min(4, g));
}

export function pcmFromAudioBuffer(buf: AudioBuffer): PcmStereo {
  const left = buf.getChannelData(0);
  const right = buf.numberOfChannels > 1 ? buf.getChannelData(1) : left;
  return { left, right, sampleRate: buf.sampleRate };
}
