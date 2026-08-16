/**
 * Audio Analysis layer (v1).
 * Pure TypeScript over mono PCM — no ffmpeg, no paid AI.
 * Reuses energy ideas from beat-detect; does not invent LUFS or high-confidence pitch.
 */

import {
  ANALYZER_VERSION,
  type AudioAnalysis,
} from "@/lib/audio/analysis-types";

export type AnalyzePcmInput = {
  samples: Float32Array;
  sampleRate: number;
  channels?: number;
  recordingId?: string | null;
  projectId?: string | null;
  sectionId?: string | null;
  role?: string | null;
  timelineStartMs?: number | null;
  timelineEndMs?: number | null;
  expectedDurationMs?: number | null;
};

const CLIP_THRESH = 0.988;
const SILENCE_RMS = 0.012;
const FRAME = 1024;
const HOP = 512;

function frameRms(samples: Float32Array, start: number, len: number): number {
  let sum = 0;
  const n = Math.min(len, samples.length - start);
  if (n <= 0) return 0;
  for (let i = 0; i < n; i++) {
    const v = samples[start + i] || 0;
    sum += v * v;
  }
  return Math.sqrt(sum / n);
}

function detectSilenceEdges(samples: Float32Array, sampleRate: number) {
  const frameMs = (HOP / sampleRate) * 1000;
  const nFrames = Math.max(0, Math.floor((samples.length - FRAME) / HOP) + 1);
  if (nFrames === 0) {
    return { leadingSilenceMs: 0, trailingSilenceMs: 0, silenceDetected: true };
  }
  let first = nFrames;
  let last = -1;
  for (let f = 0; f < nFrames; f++) {
    const rms = frameRms(samples, f * HOP, FRAME);
    if (rms >= SILENCE_RMS) {
      if (first === nFrames) first = f;
      last = f;
    }
  }
  if (last < 0) {
    return {
      leadingSilenceMs: Math.round((samples.length / sampleRate) * 1000),
      trailingSilenceMs: 0,
      silenceDetected: true,
    };
  }
  const leadingSilenceMs = Math.round(first * frameMs);
  const trailingSilenceMs = Math.round((nFrames - 1 - last) * frameMs);
  const silenceDetected = leadingSilenceMs > 250 || trailingSilenceMs > 250;
  return { leadingSilenceMs, trailingSilenceMs, silenceDetected };
}

function detectClipping(samples: Float32Array): boolean {
  let hits = 0;
  const step = Math.max(1, Math.floor(samples.length / 200_000));
  for (let i = 0; i < samples.length; i += step) {
    if (Math.abs(samples[i]) >= CLIP_THRESH) hits++;
  }
  return hits > 8;
}

function overallRmsPeak(samples: Float32Array): { rms: number; peak: number } {
  let sum = 0;
  let peak = 0;
  const step = Math.max(1, Math.floor(samples.length / 500_000));
  let n = 0;
  for (let i = 0; i < samples.length; i += step) {
    const v = samples[i] || 0;
    sum += v * v;
    const a = Math.abs(v);
    if (a > peak) peak = a;
    n++;
  }
  return { rms: n ? Math.sqrt(sum / n) : 0, peak };
}

/**
 * Lightweight autocorrelation pitch estimate on a mid window.
 * Returns nulls when confidence is low — never invents a “good” pitch.
 */
function estimatePitch(samples: Float32Array, sampleRate: number): {
  available: boolean;
  medianHz: number | null;
  minHz: number | null;
  maxHz: number | null;
  confidence: number | null;
} {
  if (samples.length < sampleRate * 0.2) {
    return { available: false, medianHz: null, minHz: null, maxHz: null, confidence: null };
  }
  const minF = 70;
  const maxF = 600;
  const minLag = Math.floor(sampleRate / maxF);
  const maxLag = Math.floor(sampleRate / minF);
  const winLen = Math.min(samples.length, Math.floor(sampleRate * 0.35));
  const start = Math.floor((samples.length - winLen) / 2);
  const window = samples.subarray(start, start + winLen);

  let bestLag = 0;
  let bestCorr = 0;
  let energy = 0;
  for (let i = 0; i < window.length; i++) energy += window[i] * window[i];
  if (energy < 1e-8) {
    return { available: false, medianHz: null, minHz: null, maxHz: null, confidence: null };
  }

  for (let lag = minLag; lag <= maxLag; lag++) {
    let corr = 0;
    const n = window.length - lag;
    for (let i = 0; i < n; i++) corr += window[i] * window[i + lag];
    corr /= energy;
    if (corr > bestCorr) {
      bestCorr = corr;
      bestLag = lag;
    }
  }

  if (bestLag <= 0 || bestCorr < 0.25) {
    return { available: false, medianHz: null, minHz: null, maxHz: null, confidence: null };
  }

  const hz = sampleRate / bestLag;
  return {
    available: true,
    medianHz: Math.round(hz * 10) / 10,
    minHz: null,
    maxHz: null,
    confidence: Math.min(1, Math.max(0, bestCorr)),
  };
}

function firstOnsetMs(samples: Float32Array, sampleRate: number): {
  onsetMs: number | null;
  confidence: number | null;
} {
  const nFrames = Math.max(0, Math.floor((samples.length - FRAME) / HOP) + 1);
  if (nFrames < 3) return { onsetMs: null, confidence: null };
  let prev = frameRms(samples, 0, FRAME);
  for (let f = 1; f < nFrames; f++) {
    const rms = frameRms(samples, f * HOP, FRAME);
    const flux = rms - prev;
    prev = rms;
    if (flux > SILENCE_RMS * 1.5 && rms > SILENCE_RMS) {
      return {
        onsetMs: Math.round((f * HOP * 1000) / sampleRate),
        confidence: 0.55,
      };
    }
  }
  return { onsetMs: 0, confidence: 0.3 };
}

export function analyzeMonoPcm(input: AnalyzePcmInput): AudioAnalysis {
  const samples = input.samples;
  const sampleRate = input.sampleRate || 44100;
  const actualDurationMs =
    samples.length && sampleRate ? Math.round((samples.length / sampleRate) * 1000) : null;

  const silence = detectSilenceEdges(samples, sampleRate);
  const clippingDetected = samples.length ? detectClipping(samples) : null;
  const { rms, peak } = samples.length ? overallRmsPeak(samples) : { rms: 0, peak: 0 };
  const pitch = estimatePitch(samples, sampleRate);
  const onset = firstOnsetMs(samples, sampleRate);

  const expected = input.expectedDurationMs ?? null;
  const timelineStart = input.timelineStartMs ?? null;
  const timelineEnd =
    input.timelineEndMs ??
    (timelineStart != null && expected != null ? timelineStart + expected : null);

  return {
    recordingId: input.recordingId ?? null,
    projectId: input.projectId ?? null,
    sectionId: input.sectionId ?? null,
    role: input.role ?? null,
    durationMs: actualDurationMs,
    sampleRate,
    channels: input.channels ?? 1,
    timeline: {
      startTimeMs: timelineStart,
      endTimeMs: timelineEnd,
      expectedDurationMs: expected,
      actualDurationMs,
    },
    quality: {
      clippingDetected,
      silenceDetected: silence.silenceDetected,
      leadingSilenceMs: silence.leadingSilenceMs,
      trailingSilenceMs: silence.trailingSilenceMs,
    },
    loudness: {
      rms: Math.round(rms * 10000) / 10000,
      peak: Math.round(peak * 10000) / 10000,
      integratedLufs: null,
    },
    pitch,
    timing: {
      onsetMs: onset.onsetMs,
      onsetDeviationMs: onset.onsetMs,
      confidence: onset.confidence,
    },
    analyzerVersion: ANALYZER_VERSION,
    method: "pcm_energy_v1",
    createdAt: new Date().toISOString(),
  };
}

/** Fallback when only duration / form fields exist (no PCM). */
export function analyzeMetadataOnly(input: {
  durationMs?: number | null;
  expectedDurationMs?: number | null;
  timelineStartMs?: number | null;
  timelineEndMs?: number | null;
  recordingId?: string | null;
  projectId?: string | null;
  sectionId?: string | null;
  role?: string | null;
}): AudioAnalysis {
  const actual = input.durationMs ?? null;
  return {
    recordingId: input.recordingId ?? null,
    projectId: input.projectId ?? null,
    sectionId: input.sectionId ?? null,
    role: input.role ?? null,
    durationMs: actual,
    sampleRate: null,
    channels: null,
    timeline: {
      startTimeMs: input.timelineStartMs ?? null,
      endTimeMs: input.timelineEndMs ?? null,
      expectedDurationMs: input.expectedDurationMs ?? null,
      actualDurationMs: actual,
    },
    quality: {
      clippingDetected: null,
      silenceDetected: null,
      leadingSilenceMs: null,
      trailingSilenceMs: null,
    },
    loudness: { rms: null, peak: null, integratedLufs: null },
    pitch: {
      available: false,
      medianHz: null,
      minHz: null,
      maxHz: null,
      confidence: null,
    },
    timing: { onsetMs: null, onsetDeviationMs: null, confidence: null },
    analyzerVersion: ANALYZER_VERSION,
    method: "metadata_only_v1",
    createdAt: new Date().toISOString(),
  };
}

/** Browser helper: decode a Blob/File to mono PCM then analyze. */
export async function analyzeAudioBlob(
  blob: Blob,
  ctx: Omit<AnalyzePcmInput, "samples" | "sampleRate" | "channels">
): Promise<AudioAnalysis> {
  if (typeof window === "undefined") {
    return analyzeMetadataOnly({
      durationMs: null,
      expectedDurationMs: ctx.expectedDurationMs,
      timelineStartMs: ctx.timelineStartMs,
      timelineEndMs: ctx.timelineEndMs,
      recordingId: ctx.recordingId,
      projectId: ctx.projectId,
      sectionId: ctx.sectionId,
      role: ctx.role,
    });
  }
  const AC =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const audioCtx = new AC();
  try {
    const buf = await blob.arrayBuffer();
    const decoded = await audioCtx.decodeAudioData(buf.slice(0));
    const chans: Float32Array[] = [];
    for (let c = 0; c < decoded.numberOfChannels; c++) {
      chans.push(decoded.getChannelData(c));
    }
    let mono: Float32Array;
    if (chans.length <= 1) mono = chans[0] || new Float32Array(0);
    else {
      mono = new Float32Array(chans[0].length);
      const inv = 1 / chans.length;
      for (let i = 0; i < mono.length; i++) {
        let s = 0;
        for (let c = 0; c < chans.length; c++) s += chans[c][i] || 0;
        mono[i] = s * inv;
      }
    }
    return analyzeMonoPcm({
      samples: mono,
      sampleRate: decoded.sampleRate,
      channels: decoded.numberOfChannels,
      ...ctx,
    });
  } finally {
    void audioCtx.close();
  }
}
