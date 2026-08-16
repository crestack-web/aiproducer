/**
 * Full-song timeline-aligned vocal stem rendering (pure TypeScript).
 * Places a section-length recording onto a full-song timeline with silence pad.
 * Does NOT stretch or auto-truncate vocals.
 */

import { decodeWav, encodeWavMono, isWavBuffer, type PcmAudio } from "@/lib/audio/wav";

export type AlignmentStatus = "ALIGNED" | "SHORT" | "LONG" | "OUT_OF_BOUNDS";

export type RenderTimelineAlignedStemInput = {
  /** Source audio bytes (WAV preferred). */
  sourceBuffer: Buffer;
  timelineStartMs: number;
  /** Optional section end; used only for alignment status, not forced trim. */
  timelineEndMs?: number | null;
  songDurationMs: number;
  /** Target sample rate for output (default: source rate). */
  targetSampleRate?: number;
};

export type RenderTimelineAlignedStemResult = {
  wavBuffer: Buffer;
  sampleRate: number;
  durationMs: number;
  alignmentStatus: AlignmentStatus;
  actualVocalMs: number;
  expectedSectionMs: number | null;
  timelineStartMs: number;
  timelineAligned: true;
};

/**
 * Place mono samples at startSample within a full-length buffer of totalSamples.
 * Vocal is never stretched. Overflow past song end is clipped at song boundary only
 * (status LONG / OUT_OF_BOUNDS); samples beyond song end are dropped from output.
 */
export function placeVocalOnTimeline(
  vocal: Float32Array,
  startSample: number,
  totalSamples: number
): Float32Array {
  const out = new Float32Array(totalSamples);
  const start = Math.max(0, Math.floor(startSample));
  for (let i = 0; i < vocal.length; i++) {
    const dest = start + i;
    if (dest >= totalSamples) break;
    if (dest >= 0) out[dest] = vocal[i] || 0;
  }
  return out;
}

export function assessPlacementAlignment(opts: {
  timelineStartMs: number;
  timelineEndMs?: number | null;
  songDurationMs: number;
  actualVocalMs: number;
}): AlignmentStatus {
  const { timelineStartMs, timelineEndMs, songDurationMs, actualVocalMs } = opts;
  if (timelineStartMs < 0 || timelineStartMs >= songDurationMs) return "OUT_OF_BOUNDS";
  if (timelineStartMs + actualVocalMs > songDurationMs + 50) return "OUT_OF_BOUNDS";

  if (timelineEndMs != null && timelineEndMs > timelineStartMs) {
    const expected = timelineEndMs - timelineStartMs;
    const delta = actualVocalMs - expected;
    const tol = Math.max(400, expected * 0.08);
    if (delta < -tol) return "SHORT";
    if (delta > tol) return "LONG";
    return "ALIGNED";
  }
  return "ALIGNED";
}

/**
 * Core renderer: decode source → pad to song length → encode WAV.
 */
export function renderTimelineAlignedStem(
  input: RenderTimelineAlignedStemInput
): RenderTimelineAlignedStemResult {
  const songDurationMs = Math.max(1000, Math.floor(input.songDurationMs));
  const timelineStartMs = Math.max(0, Math.floor(input.timelineStartMs));

  if (!isWavBuffer(input.sourceBuffer)) {
    throw new Error(
      "Timeline stem requires WAV source. Re-record or upload so the take is stored as WAV."
    );
  }

  const pcm: PcmAudio = decodeWav(input.sourceBuffer);
  const sampleRate = input.targetSampleRate || pcm.sampleRate || 44100;
  let samples = pcm.samples;

  // Resample only if rates differ (simple linear — rare path).
  if (pcm.sampleRate && pcm.sampleRate !== sampleRate && samples.length > 0) {
    const ratio = sampleRate / pcm.sampleRate;
    const next = new Float32Array(Math.max(1, Math.round(samples.length * ratio)));
    for (let i = 0; i < next.length; i++) {
      const src = i / ratio;
      const i0 = Math.floor(src);
      const i1 = Math.min(samples.length - 1, i0 + 1);
      const t = src - i0;
      next[i] = (samples[i0] || 0) * (1 - t) + (samples[i1] || 0) * t;
    }
    samples = next;
  }

  const actualVocalMs = Math.round((samples.length / sampleRate) * 1000);
  const totalSamples = Math.max(1, Math.round((songDurationMs / 1000) * sampleRate));
  const startSample = Math.round((timelineStartMs / 1000) * sampleRate);

  const placed = placeVocalOnTimeline(samples, startSample, totalSamples);
  const wavBuffer = encodeWavMono(placed, sampleRate);

  const alignmentStatus = assessPlacementAlignment({
    timelineStartMs,
    timelineEndMs: input.timelineEndMs,
    songDurationMs,
    actualVocalMs,
  });

  return {
    wavBuffer,
    sampleRate,
    durationMs: songDurationMs,
    alignmentStatus,
    actualVocalMs,
    expectedSectionMs:
      input.timelineEndMs != null && input.timelineEndMs > timelineStartMs
        ? input.timelineEndMs - timelineStartMs
        : null,
    timelineStartMs,
    timelineAligned: true,
  };
}

/** Deterministic self-test for placement math (no I/O). Throws on failure. */
export function runTimelineStemSelfTest(): void {
  const sr = 1000; // 1 sample = 1 ms for easy math
  const songMs = 120_000;
  const total = Math.round((songMs / 1000) * sr);
  const vocal = new Float32Array(10_000); // 10s
  for (let i = 0; i < vocal.length; i++) vocal[i] = 0.5;

  // start = 30s
  const startSample = 30_000;
  const out = placeVocalOnTimeline(vocal, startSample, total);
  if (out.length !== total) throw new Error("self-test: length");
  if (out[29_999] !== 0) throw new Error("self-test: pre-silence");
  if (out[30_000] !== 0.5) throw new Error("self-test: vocal start");
  if (out[39_999] !== 0.5) throw new Error("self-test: vocal end");
  if (out[40_000] !== 0) throw new Error("self-test: post-silence");

  // start = 0
  const out0 = placeVocalOnTimeline(vocal, 0, total);
  if (out0[0] !== 0.5 || out0[10_000] !== 0) throw new Error("self-test: start0");

  // middle + short
  if (assessPlacementAlignment({
    timelineStartMs: 30_000,
    timelineEndMs: 50_000,
    songDurationMs: songMs,
    actualVocalMs: 10_000,
  }) !== "SHORT") {
    throw new Error("self-test: SHORT");
  }

  // slightly longer than section — LONG, not truncated in place
  if (assessPlacementAlignment({
    timelineStartMs: 30_000,
    timelineEndMs: 40_000,
    songDurationMs: songMs,
    actualVocalMs: 12_000,
  }) !== "LONG") {
    throw new Error("self-test: LONG");
  }

  // full encode path
  const { encodeWavMono: enc } = require("@/lib/audio/wav") as typeof import("@/lib/audio/wav");
  const tiny = new Float32Array(sr * 2);
  tiny[0] = 0.25;
  const buf = enc(tiny, sr);
  const rendered = renderTimelineAlignedStem({
    sourceBuffer: buf,
    timelineStartMs: 5_000,
    timelineEndMs: 7_000,
    songDurationMs: 20_000,
  });
  if (!rendered.timelineAligned || rendered.durationMs !== 20_000) {
    throw new Error("self-test: render");
  }
}
