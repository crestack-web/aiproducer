/**
 * Try It — real sung take → matched instrumental → production mix.
 * No voice clone, no TTS. Artist hears their own performance produced.
 */
import { normalizeToInternalPcm } from "@/lib/ap-engine/ingestion/normalize";
import { generateStack } from "@/lib/ap-engine/fullness";
import { mixVocalAndBeat } from "@/lib/ap-engine/mix/engine";
import { applyGainStereo, cloneStereo, peakOf, rmsOf, stereoToMono } from "@/lib/ap-engine/dsp";
import { extractSongFingerprint } from "@/lib/ap-engine/master/song-fingerprint";
import type { MixDecision, PcmStereo } from "@/lib/ap-engine/types";
import { encodeWavStereoFromMono } from "@/lib/audio/wav";
import { getMusicProvider } from "@/lib/music-generation/service";
import { buildInstrumentalPrompt } from "@/lib/music-generation/provider";
import {
  TRY_IT_PREVIEW_BEAT_SEC,
  TRY_IT_PREVIEW_MAX_SEC,
  TRY_IT_PREVIEW_MIN_SEC,
} from "./config";

const SR = 44100;

/** Keep the densest ~targetSec of the take (hook window), not silence tails. */
export function trimToActiveWindow(pcm: PcmStereo, targetSec: number): {
  pcm: PcmStereo;
  startMs: number;
  durationMs: number;
} {
  const mono = stereoToMono(pcm);
  const targetSamples = Math.min(mono.length, Math.round(targetSec * SR));
  if (mono.length <= targetSamples) {
    return {
      pcm,
      startMs: 0,
      durationMs: Math.round((mono.length / SR) * 1000),
    };
  }

  const win = Math.max(1, Math.floor(SR * 0.05));
  const nWin = Math.floor(mono.length / win);
  const energy = new Float32Array(nWin);
  for (let i = 0; i < nWin; i++) {
    let s = 0;
    const a = i * win;
    const b = Math.min(mono.length, a + win);
    for (let j = a; j < b; j++) s += Math.abs(mono[j] || 0);
    energy[i] = s / Math.max(1, b - a);
  }

  const need = Math.max(1, Math.floor(targetSamples / win));
  let best = -1;
  let bestIdx = 0;
  let run = 0;
  for (let i = 0; i < need && i < nWin; i++) run += energy[i] || 0;
  best = run;
  for (let i = need; i < nWin; i++) {
    run += (energy[i] || 0) - (energy[i - need] || 0);
    if (run > best) {
      best = run;
      bestIdx = i - need + 1;
    }
  }

  const start = bestIdx * win;
  const end = Math.min(mono.length, start + targetSamples);
  return {
    pcm: {
      left: pcm.left.subarray(start, end),
      right: pcm.right.subarray(start, end),
      sampleRate: pcm.sampleRate,
    },
    startMs: Math.round((start / SR) * 1000),
    durationMs: Math.round(((end - start) / SR) * 1000),
  };
}

function padOrTrimBeat(beat: PcmStereo, samples: number): PcmStereo {
  if (beat.left.length === samples) return beat;
  const left = new Float32Array(samples);
  const right = new Float32Array(samples);
  const n = Math.min(samples, beat.left.length);
  left.set(beat.left.subarray(0, n));
  right.set(beat.right.subarray(0, n));
  // loop short beats
  if (beat.left.length > 0 && n < samples) {
    for (let i = n; i < samples; i++) {
      left[i] = beat.left[i % beat.left.length] || 0;
      right[i] = beat.right[i % beat.right.length] || 0;
    }
  }
  return { left, right, sampleRate: beat.sampleRate };
}

function stackOntoLead(lead: PcmStereo): PcmStereo {
  const voices = generateStack({ lead, mode: "choir_light", startMs: 0 });
  const out = cloneStereo(lead);
  for (const v of voices) {
    const n = Math.min(out.left.length, v.pcm.left.length);
    for (let i = 0; i < n; i++) {
      out.left[i] = (out.left[i] || 0) + (v.pcm.left[i] || 0);
      out.right[i] = (out.right[i] || 0) + (v.pcm.right[i] || 0);
    }
  }
  // Soft headroom after stack
  const peak = Math.max(peakOf(out.left), peakOf(out.right));
  if (peak > 0.92) applyGainStereo(out, 0.92 / peak);
  return out;
}

async function generateMatchedBeat(opts: {
  sessionId: string;
  userId: string;
  genre: string;
  bpm: number;
  durationSec: number;
}): Promise<PcmStereo> {
  const durationSec = Math.min(
    TRY_IT_PREVIEW_MAX_SEC,
    Math.max(TRY_IT_PREVIEW_MIN_SEC, Math.round(opts.durationSec))
  );
  const provider = getMusicProvider();
  const prompt = buildInstrumentalPrompt({
    genre: opts.genre,
    mood: "energetic",
    bpm: opts.bpm,
    instrumentation: "drums, bass, keys, supporting synths — leave space for lead vocal",
  });
  const genReq = {
    projectId: opts.sessionId,
    userId: opts.userId,
    prompt,
    durationSec,
    genre: opts.genre,
    mood: "energetic",
    bpm: opts.bpm,
    kind: "preview" as const,
    instrumentalOnly: true,
  };

  let buffer: Buffer;
  if (typeof provider.generate === "function") {
    const r = await provider.generate(genReq);
    buffer = r.buffer;
  } else {
    const submitted = await provider.submitPrediction(genReq);
    let poll = await provider.pollPrediction(submitted.providerPredictionId);
    for (let i = 0; i < 40 && poll.status !== "succeeded" && poll.status !== "failed"; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      poll = await provider.pollPrediction(submitted.providerPredictionId);
    }
    if (poll.status !== "succeeded" || !poll.outputUrl) {
      throw new Error(poll.error || "Beat generation failed");
    }
    const dl = await provider.downloadOutput(poll.outputUrl);
    buffer = dl.buffer;
  }

  const norm = await normalizeToInternalPcm(buffer, "beat.mp3");
  return norm.pcm;
}

export type FromVocalResult = {
  mixWav: Buffer;
  durationSec: number;
  bpm: number;
  windowStartMs: number;
  usedChoir: boolean;
  vocalRms: number;
};

/**
 * Core Try It produce path:
 * sung take → trim active window → BPM → instrumental → light choir → mix.
 */
export async function produceFromVocalTake(opts: {
  sampleBuffer: Buffer;
  pathHint?: string;
  sessionId: string;
  userId: string;
  genre?: string;
  tempoHint?: number | null;
  addChoir?: boolean;
  maxSec?: number;
}): Promise<FromVocalResult> {
  const maxSec = Math.min(
    TRY_IT_PREVIEW_MAX_SEC,
    Math.max(TRY_IT_PREVIEW_MIN_SEC, opts.maxSec ?? TRY_IT_PREVIEW_BEAT_SEC)
  );

  const norm = await normalizeToInternalPcm(opts.sampleBuffer, opts.pathHint);
  const trimmed = trimToActiveWindow(norm.pcm, maxSec);

  const monoRms = rmsOf(stereoToMono(trimmed.pcm));
  if (monoRms < 0.008) {
    throw new Error("Recording is too quiet — sing closer to the mic and try again");
  }

  const fp = extractSongFingerprint(trimmed.pcm, opts.tempoHint ?? null);
  let bpm =
    opts.tempoHint && opts.tempoHint >= 70 && opts.tempoHint <= 180
      ? opts.tempoHint
      : fp.bpm && fp.bpm >= 70 && fp.bpm <= 180
        ? Math.round(fp.bpm)
        : 100;

  const durationSec = Math.max(
    TRY_IT_PREVIEW_MIN_SEC,
    Math.min(maxSec, Math.ceil(trimmed.durationMs / 1000))
  );

  const genre = (opts.genre || "afrobeats").slice(0, 40);
  const beat = await generateMatchedBeat({
    sessionId: opts.sessionId,
    userId: opts.userId,
    genre,
    bpm,
    durationSec,
  });

  let vocal = cloneStereo(trimmed.pcm);
  const usedChoir = opts.addChoir !== false;
  if (usedChoir) {
    try {
      vocal = stackOntoLead(vocal);
    } catch {
      // Choir is enhancement only — never fail the demo
    }
  }

  const samples = vocal.left.length;
  const beatAligned = padOrTrimBeat(beat, samples);

  const decision: MixDecision = {
    vocalGainDb: 1.5,
    beatGainDb: -1.5,
    duckDb: 3.2,
    duckMidFocus: 0.85,
    vocalPan: 0,
    beatPresenceCutDb: 2.5,
  };

  const mix = mixVocalAndBeat(vocal, beatAligned, decision);

  // Soft peak limit
  const peak = Math.max(peakOf(mix.left), peakOf(mix.right));
  if (peak > 0.95) applyGainStereo(mix, 0.95 / peak);

  const monoOut = stereoToMono(mix);
  const mixWav = encodeWavStereoFromMono(monoOut, mix.sampleRate);

  return {
    mixWav,
    durationSec: samples / SR,
    bpm,
    windowStartMs: trimmed.startMs,
    usedChoir,
    vocalRms: monoRms,
  };
}
