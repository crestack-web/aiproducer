/**
 * Full-song timeline-aligned vocal stem rendering (pure TypeScript).
 * Places a section-length recording onto a full-song timeline with silence pad.
 * Does NOT stretch or auto-truncate vocals.
 */

import { decodeWav, encodeWavMono, isWavBuffer, type PcmAudio } from "@/lib/audio/wav";

export type AlignmentStatus = "ALIGNED" | "SHORT" | "LONG" | "OUT_OF_BOUNDS";

export type RenderTimelineAlignedStemInput = {
  sourceBuffer: Buffer;
  timelineStartMs: number;
  timelineEndMs?: number | null;
  songDurationMs: number;
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
  const sr = 1000;
  const songMs = 120_000;
  const total = Math.round((songMs / 1000) * sr);
  const vocal = new Float32Array(10_000);
  for (let i = 0; i < vocal.length; i++) vocal[i] = 0.5;

  const out = placeVocalOnTimeline(vocal, 30_000, total);
  if (out.length !== total) throw new Error("self-test: length");
  if (out[29_999] !== 0) throw new Error("self-test: pre-silence");
  if (out[30_000] !== 0.5) throw new Error("self-test: vocal start");
  if (out[39_999] !== 0.5) throw new Error("self-test: vocal end");
  if (out[40_000] !== 0) throw new Error("self-test: post-silence");

  const out0 = placeVocalOnTimeline(vocal, 0, total);
  if (out0[0] !== 0.5 || out0[10_000] !== 0) throw new Error("self-test: start0");

  if (
    assessPlacementAlignment({
      timelineStartMs: 30_000,
      timelineEndMs: 50_000,
      songDurationMs: songMs,
      actualVocalMs: 10_000,
    }) !== "SHORT"
  ) {
    throw new Error("self-test: SHORT");
  }

  if (
    assessPlacementAlignment({
      timelineStartMs: 30_000,
      timelineEndMs: 40_000,
      songDurationMs: songMs,
      actualVocalMs: 12_000,
    }) !== "LONG"
  ) {
    throw new Error("self-test: LONG");
  }

  const tiny = new Float32Array(sr * 2);
  tiny[0] = 0.25;
  const buf = encodeWavMono(tiny, sr);
  const rendered = renderTimelineAlignedStem({
    sourceBuffer: buf,
    timelineStartMs: 5_000,
    timelineEndMs: 7_000,
    songDurationMs: 20_000,
  });
  if (!rendered.timelineAligned || rendered.durationMs !== 20_000) {
    throw new Error("self-test: render");
  }
  if (rendered.alignmentStatus !== "ALIGNED") {
    throw new Error("self-test: alignment status");
  }
}

export type CompositeSourceInput = {
  sourceBuffer: Buffer;
  timelineStartMs: number;
  timelineEndMs?: number | null;
  label?: string;
};

/**
 * Place multiple section recordings onto one full-song mono WAV (summed).
 * Each source is 0-based at its own timelineStartMs — used so Produce mixes
 * verse + chorus + bridge leads (etc.) instead of only the first of each kind.
 */
export function renderCompositeTimelineAlignedStem(input: {
  sources: CompositeSourceInput[];
  songDurationMs: number;
  targetSampleRate?: number;
}): RenderTimelineAlignedStemResult & { sourceCount: number } {
  if (!input.sources.length) {
    throw new Error("Composite stem requires at least one vocal source");
  }
  const songDurationMs = Math.max(1000, Math.floor(input.songDurationMs));
  const targetRate = input.targetSampleRate || 44100;
  const totalSamples = Math.max(1, Math.round((songDurationMs / 1000) * targetRate));
  const out = new Float32Array(totalSamples);

  let firstStart = Number.POSITIVE_INFINITY;
  let maxEnd = 0;
  let anyStatus: AlignmentStatus = "ALIGNED";

  for (const src of input.sources) {
    if (!isWavBuffer(src.sourceBuffer)) {
      throw new Error(
        `Composite stem source ${src.label || "take"} is not WAV. Re-record so the take saves as WAV.`
      );
    }
    const pcm: PcmAudio = decodeWav(src.sourceBuffer);
    let samples = pcm.samples;
    const rate = pcm.sampleRate || targetRate;
    if (rate !== targetRate && samples.length > 0) {
      const ratio = targetRate / rate;
      const next = new Float32Array(Math.max(1, Math.round(samples.length * ratio)));
      for (let i = 0; i < next.length; i++) {
        const s = i / ratio;
        const i0 = Math.floor(s);
        const i1 = Math.min(samples.length - 1, i0 + 1);
        const t = s - i0;
        next[i] = (samples[i0] || 0) * (1 - t) + (samples[i1] || 0) * t;
      }
      samples = next;
    }
    const timelineStartMs = Math.max(0, Math.floor(src.timelineStartMs));
    const actualVocalMs = Math.round((samples.length / targetRate) * 1000);
    const status = assessPlacementAlignment({
      timelineStartMs,
      timelineEndMs: src.timelineEndMs,
      songDurationMs,
      actualVocalMs,
    });
    if (status === "OUT_OF_BOUNDS") anyStatus = "OUT_OF_BOUNDS";
    else if (anyStatus === "ALIGNED" && status !== "ALIGNED") anyStatus = status;

    const startSample = Math.round((timelineStartMs / 1000) * targetRate);
    for (let i = 0; i < samples.length; i++) {
      const dest = startSample + i;
      if (dest < 0 || dest >= totalSamples) continue;
      // Soft sum; clamp later to avoid harsh digital clip on overlaps
      out[dest] = (out[dest] || 0) + (samples[i] || 0);
    }
    firstStart = Math.min(firstStart, timelineStartMs);
    maxEnd = Math.max(maxEnd, timelineStartMs + actualVocalMs);
  }

  // Soft limit peaks
  let peak = 0;
  for (let i = 0; i < out.length; i++) {
    const a = Math.abs(out[i] || 0);
    if (a > peak) peak = a;
  }
  if (peak > 1) {
    const g = 0.95 / peak;
    for (let i = 0; i < out.length; i++) out[i] *= g;
  }

  const wavBuffer = encodeWavMono(out, targetRate);
  return {
    wavBuffer,
    sampleRate: targetRate,
    durationMs: songDurationMs,
    alignmentStatus: anyStatus === "OUT_OF_BOUNDS" ? "OUT_OF_BOUNDS" : anyStatus,
    actualVocalMs: Math.max(0, maxEnd - (Number.isFinite(firstStart) ? firstStart : 0)),
    expectedSectionMs: null,
    timelineStartMs: Number.isFinite(firstStart) ? firstStart : 0,
    timelineAligned: true,
    sourceCount: input.sources.length,
  };
}
