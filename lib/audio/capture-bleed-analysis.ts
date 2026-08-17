/**
 * Diagnostic-only analysis of the ORIGINAL MediaRecorder capture.
 *
 * - Does NOT modify, normalize, compress, gate, or denoise the blob
 * - decodeAudioData works on a copy of the ArrayBuffer; the Blob is left intact
 * - Used only to measure whether speaker ducking reduced acoustic bleed
 *
 * Limitations (browser):
 * - No reliable isolated "beat track" reference inside the mic capture
 * - Low-band energy during non-vocal regions is a PROXY for acoustic beat bleed,
 *   not a perfect spectral separation of kick vs room noise
 * - WebM/Opus decode may fail on some Safari builds; analysis is best-effort
 * - Comparing before/during/after duck requires duck event timestamps aligned
 *   to recording wall-clock start
 */

import type { SpeakerDuckDiagnostics, SpeakerDuckEvent } from "@/lib/audio/speaker-monitor-duck";

export type CaptureClassification =
  | "DIGITAL_BEAT_IN_CAPTURE"
  | "ACOUSTIC_BLEED"
  | "IMPROVED_ACOUSTIC_CAPTURE"
  | "CLEAN_CAPTURE"
  | "UNKNOWN";

export type CaptureBleedAnalysis = {
  ok: boolean;
  reason?: string;
  originalDurationMs: number | null;
  sampleRate: number | null;
  /** Whole-file RMS */
  fullRms: number | null;
  fullPeak: number | null;
  /** Energy in frames classified as vocal (high mid-band + high RMS) */
  vocalRms: number | null;
  vocalPeak: number | null;
  vocalFrameCount: number;
  /** Energy in frames classified as non-vocal / background */
  backgroundRms: number | null;
  backgroundPeak: number | null;
  backgroundFrameCount: number;
  /**
   * Mean low-band (≲180 Hz) magnitude during non-vocal frames.
   * Proxy for kick/bass acoustic bleed — NOT a definitive beat detector.
   */
  backgroundLowBandEnergy: number | null;
  /** vocalRms / max(backgroundRms, eps) */
  voiceToBackgroundRatio: number | null;
  /**
   * Background RMS in time windows mapped from duck events
   * (recording-relative). Null if no events or decode failed.
   */
  backgroundRmsBeforeDuck: number | null;
  backgroundRmsDuringDuck: number | null;
  backgroundRmsAfterDuck: number | null;
  /** Relative reduction during duck vs before: (before - during) / before */
  duckBackgroundReduction: number | null;
  classification: CaptureClassification;
  classificationReason: string;
  analysisMethod: string;
  limitations: string[];
};

export type CaptureDiagnosticSummary = {
  route: string;
  requestedInput: string | null;
  actualInput: string | null;
  requestedOutput: string | null;
  actualOutput: string | null;
  beatInMediaRecorder: boolean;
  duckEventCount: number;
  originalDurationMs: number | null;
  vocalEnergy: number | null;
  backgroundEnergy: number | null;
  voiceToBackgroundRatio: number | null;
  backgroundLowBandEnergy: number | null;
  backgroundRmsBeforeDuck: number | null;
  backgroundRmsDuringDuck: number | null;
  backgroundRmsAfterDuck: number | null;
  duckBackgroundReduction: number | null;
  classification: CaptureClassification;
  classificationReason: string;
};

const FRAME_SEC = 0.05;
const VOCAL_RMS_ON = 0.02;
const BACKGROUND_BLEED_RMS = 0.008;
const BACKGROUND_LOWBAND_BLEED = 0.04;
const MATERIAL_REDUCTION = 0.15; // 15% lower background during duck vs before

function rmsOf(channel: Float32Array, start: number, end: number): { rms: number; peak: number } {
  const n = Math.max(0, end - start);
  if (n <= 0) return { rms: 0, peak: 0 };
  let sum = 0;
  let peak = 0;
  for (let i = start; i < end; i++) {
    const v = channel[i];
    sum += v * v;
    const a = Math.abs(v);
    if (a > peak) peak = a;
  }
  return { rms: Math.sqrt(sum / n), peak };
}

/** Simple DFT magnitude sum for low bins of one frame (diagnostic proxy only). */
function lowBandEnergy(frame: Float32Array, sampleRate: number): number {
  const n = frame.length;
  if (n < 32) return 0;
  // Rectangular-window DFT for bins under ~180 Hz
  const maxBin = Math.max(1, Math.floor((180 * n) / sampleRate));
  let energy = 0;
  for (let k = 1; k <= maxBin; k++) {
    let re = 0;
    let im = 0;
    const w = (2 * Math.PI * k) / n;
    for (let i = 0; i < n; i++) {
      const x = frame[i];
      re += x * Math.cos(w * i);
      im -= x * Math.sin(w * i);
    }
    energy += Math.sqrt(re * re + im * im) / n;
  }
  return energy / maxBin;
}

function midBandEnergy(frame: Float32Array, sampleRate: number): number {
  const n = frame.length;
  if (n < 32) return 0;
  const lo = Math.max(1, Math.floor((250 * n) / sampleRate));
  const hi = Math.min(Math.floor(n / 2) - 1, Math.floor((3000 * n) / sampleRate));
  if (hi <= lo) return 0;
  let energy = 0;
  let bins = 0;
  // Sparse bins for speed
  const step = Math.max(1, Math.floor((hi - lo) / 12));
  for (let k = lo; k <= hi; k += step) {
    let re = 0;
    let im = 0;
    const w = (2 * Math.PI * k) / n;
    for (let i = 0; i < n; i++) {
      const x = frame[i];
      re += x * Math.cos(w * i);
      im -= x * Math.sin(w * i);
    }
    energy += Math.sqrt(re * re + im * im) / n;
    bins++;
  }
  return bins > 0 ? energy / bins : 0;
}

type FrameStat = {
  t0: number;
  t1: number;
  rms: number;
  peak: number;
  isVocal: boolean;
  lowBand: number;
  midBand: number;
};

function buildFrames(channel: Float32Array, sampleRate: number): FrameStat[] {
  const frameSamples = Math.max(64, Math.floor(sampleRate * FRAME_SEC));
  const frames: FrameStat[] = [];
  for (let start = 0; start + frameSamples <= channel.length; start += frameSamples) {
    const end = start + frameSamples;
    const { rms, peak } = rmsOf(channel, start, end);
    const slice = channel.subarray(start, end);
    // Mid-band preference: high mid + high RMS ⇒ vocal; high low + low mid ⇒ likely bleed/background
    const mid = midBandEnergy(slice, sampleRate);
    const low = lowBandEnergy(slice, sampleRate);
    const isVocal = rms >= VOCAL_RMS_ON && mid >= low * 0.85;
    frames.push({
      t0: start / sampleRate,
      t1: end / sampleRate,
      rms,
      peak,
      isVocal,
      lowBand: low,
      midBand: mid,
    });
  }
  return frames;
}

function mean(xs: number[]): number | null {
  if (!xs.length) return null;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

function maxOf(xs: number[]): number | null {
  if (!xs.length) return null;
  let m = xs[0];
  for (const x of xs) if (x > m) m = x;
  return m;
}

/**
 * Map duck events (performance.now based) onto recording timeline [0, duration].
 * recordingWallStartMs should be Date.now()-style or performance.now at MediaRecorder start —
 * use the same clock as event.atMs when possible.
 */
function duckWindows(
  events: SpeakerDuckEvent[],
  recordingStartPerfMs: number | null,
  durationSec: number
): { before: [number, number][]; during: [number, number][]; after: [number, number][] } {
  const during: [number, number][] = [];
  if (!events.length || recordingStartPerfMs == null || durationSec <= 0) {
    return { before: [], during: [], after: [] };
  }
  let open: number | null = null;
  for (const ev of events) {
    const t = (ev.atMs - recordingStartPerfMs) / 1000;
    if (ev.type === "duck_start") {
      open = Math.max(0, Math.min(durationSec, t));
    } else if (ev.type === "duck_release" && open != null) {
      const t1 = Math.max(0, Math.min(durationSec, t));
      if (t1 > open) during.push([open, t1]);
      open = null;
    }
  }
  if (open != null && open < durationSec) {
    during.push([open, durationSec]);
  }
  // Before = [0, first duck start); After = (last duck release, end]
  const firstStart = during.length ? during[0][0] : null;
  const lastEnd = during.length ? during[during.length - 1][1] : null;
  const before: [number, number][] = firstStart != null && firstStart > 0.05 ? [[0, firstStart]] : [];
  const after: [number, number][] =
    lastEnd != null && lastEnd < durationSec - 0.05 ? [[lastEnd, durationSec]] : [];
  return { before, during, after };
}

function backgroundRmsInWindows(frames: FrameStat[], windows: [number, number][]): number | null {
  if (!windows.length) return null;
  const vals: number[] = [];
  for (const f of frames) {
    if (f.isVocal) continue;
    const mid = (f.t0 + f.t1) / 2;
    for (const [a, b] of windows) {
      if (mid >= a && mid <= b) {
        vals.push(f.rms);
        break;
      }
    }
  }
  return mean(vals);
}

function classifyFromAnalysis(
  beatInMediaRecorder: boolean,
  backgroundRms: number | null,
  backgroundLowBand: number | null,
  duckReduction: number | null,
  hadDuckEvents: boolean
): { classification: CaptureClassification; reason: string } {
  if (beatInMediaRecorder) {
    return {
      classification: "DIGITAL_BEAT_IN_CAPTURE",
      reason: "beat_in_media_recorder === true (architecture violation)",
    };
  }

  const bg = backgroundRms ?? 0;
  const low = backgroundLowBand ?? 0;
  const bleedPresent =
    bg >= BACKGROUND_BLEED_RMS || low >= BACKGROUND_LOWBAND_BLEED;

  if (
    hadDuckEvents &&
    duckReduction != null &&
    duckReduction >= MATERIAL_REDUCTION &&
    bleedPresent
  ) {
    return {
      classification: "IMPROVED_ACOUSTIC_CAPTURE",
      reason: `background energy during ducked windows ${(duckReduction * 100).toFixed(0)}% lower than pre-duck background; residual bleed still measurable`,
    };
  }

  if (!bleedPresent && bg < BACKGROUND_BLEED_RMS && low < BACKGROUND_LOWBAND_BLEED) {
    return {
      classification: "CLEAN_CAPTURE",
      reason: `non-vocal RMS ${bg.toFixed(4)} and low-band ${low.toFixed(4)} below bleed thresholds`,
    };
  }

  if (bleedPresent) {
    return {
      classification: "ACOUSTIC_BLEED",
      reason: `measurable non-vocal energy (RMS ${bg.toFixed(4)}, low-band ${low.toFixed(4)}) in original capture; beat_in_media_recorder false`,
    };
  }

  return {
    classification: "UNKNOWN",
    reason: "insufficient frame statistics to classify",
  };
}

/**
 * Analyze the ORIGINAL capture blob. Never mutates the blob.
 */
export async function analyzeOriginalCaptureBleed(
  blob: Blob,
  opts: {
    beatInMediaRecorder: boolean;
    duck?: SpeakerDuckDiagnostics | null;
    /** performance.now() (or same clock as duck events) at MediaRecorder start */
    recordingStartPerfMs?: number | null;
  }
): Promise<CaptureBleedAnalysis> {
  const limitations: string[] = [
    "Low-band energy is a proxy for acoustic beat bleed, not a full beat source separator",
    "Vocal vs non-vocal frames use energy/mid-band heuristics; soft speech may be under-counted",
    "Duck before/during/after windows require aligned performance.now timestamps",
    "decodeAudioData may fail for some WebM/Opus encodings on Safari",
  ];

  const fail = (reason: string): CaptureBleedAnalysis => ({
    ok: false,
    reason,
    originalDurationMs: null,
    sampleRate: null,
    fullRms: null,
    fullPeak: null,
    vocalRms: null,
    vocalPeak: null,
    vocalFrameCount: 0,
    backgroundRms: null,
    backgroundPeak: null,
    backgroundFrameCount: 0,
    backgroundLowBandEnergy: null,
    voiceToBackgroundRatio: null,
    backgroundRmsBeforeDuck: null,
    backgroundRmsDuringDuck: null,
    backgroundRmsAfterDuck: null,
    duckBackgroundReduction: null,
    classification: opts.beatInMediaRecorder ? "DIGITAL_BEAT_IN_CAPTURE" : "UNKNOWN",
    classificationReason: reason,
    analysisMethod: "none",
    limitations,
  });

  if (!blob || blob.size < 64) {
    return fail("blob empty or too small");
  }

  let ctx: AudioContext | null = null;
  try {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new AC();
    const ab = await blob.arrayBuffer(); // copy; original Blob untouched
    const audio = await ctx.decodeAudioData(ab.slice(0));
    const channel = audio.getChannelData(0);
    const sampleRate = audio.sampleRate;
    const durationSec = audio.duration;
    const full = rmsOf(channel, 0, channel.length);
    const frames = buildFrames(channel, sampleRate);

    const vocalRmsList: number[] = [];
    const vocalPeakList: number[] = [];
    const bgRmsList: number[] = [];
    const bgPeakList: number[] = [];
    const bgLowList: number[] = [];

    for (const f of frames) {
      if (f.isVocal) {
        vocalRmsList.push(f.rms);
        vocalPeakList.push(f.peak);
      } else {
        bgRmsList.push(f.rms);
        bgPeakList.push(f.peak);
        bgLowList.push(f.lowBand);
      }
    }

    const vocalRms = mean(vocalRmsList);
    const backgroundRms = mean(bgRmsList);
    const backgroundLowBandEnergy = mean(bgLowList);
    const voiceToBackgroundRatio =
      vocalRms != null && backgroundRms != null && backgroundRms > 1e-6
        ? vocalRms / backgroundRms
        : vocalRms != null && (backgroundRms == null || backgroundRms <= 1e-6)
          ? null
          : null;

    const events = opts.duck?.events ?? [];
    const windows = duckWindows(
      events,
      opts.recordingStartPerfMs ?? null,
      durationSec
    );
    const backgroundRmsBeforeDuck = backgroundRmsInWindows(frames, windows.before);
    const backgroundRmsDuringDuck = backgroundRmsInWindows(frames, windows.during);
    const backgroundRmsAfterDuck = backgroundRmsInWindows(frames, windows.after);

    let duckBackgroundReduction: number | null = null;
    if (
      backgroundRmsBeforeDuck != null &&
      backgroundRmsDuringDuck != null &&
      backgroundRmsBeforeDuck > 1e-6
    ) {
      duckBackgroundReduction =
        (backgroundRmsBeforeDuck - backgroundRmsDuringDuck) / backgroundRmsBeforeDuck;
    }

    const { classification, reason } = classifyFromAnalysis(
      opts.beatInMediaRecorder,
      backgroundRms,
      backgroundLowBandEnergy,
      duckBackgroundReduction,
      events.length > 0
    );

    return {
      ok: true,
      originalDurationMs: Math.round(durationSec * 1000),
      sampleRate,
      fullRms: full.rms,
      fullPeak: full.peak,
      vocalRms,
      vocalPeak: maxOf(vocalPeakList),
      vocalFrameCount: vocalRmsList.length,
      backgroundRms,
      backgroundPeak: maxOf(bgPeakList),
      backgroundFrameCount: bgRmsList.length,
      backgroundLowBandEnergy,
      voiceToBackgroundRatio,
      backgroundRmsBeforeDuck,
      backgroundRmsDuringDuck,
      backgroundRmsAfterDuck,
      duckBackgroundReduction,
      classification,
      classificationReason: reason,
      analysisMethod:
        "decodeAudioData + 50ms frames; vocal=mid-band+rms heuristic; low-band DFT proxy for bleed; duck windows from VAD events",
      limitations,
    };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "decodeAudioData failed");
  } finally {
    try {
      await ctx?.close();
    } catch {
      /* ignore */
    }
  }
}

export function buildCaptureDiagnosticSummary(opts: {
  route: string;
  requestedInput: string | null;
  actualInput: string | null;
  requestedOutput: string | null;
  actualOutput: string | null;
  beatInMediaRecorder: boolean;
  duckEventCount: number;
  analysis: CaptureBleedAnalysis | null;
}): CaptureDiagnosticSummary {
  const a = opts.analysis;
  return {
    route: opts.route,
    requestedInput: opts.requestedInput,
    actualInput: opts.actualInput,
    requestedOutput: opts.requestedOutput,
    actualOutput: opts.actualOutput,
    beatInMediaRecorder: opts.beatInMediaRecorder,
    duckEventCount: opts.duckEventCount,
    originalDurationMs: a?.originalDurationMs ?? null,
    vocalEnergy: a?.vocalRms ?? null,
    backgroundEnergy: a?.backgroundRms ?? null,
    voiceToBackgroundRatio: a?.voiceToBackgroundRatio ?? null,
    backgroundLowBandEnergy: a?.backgroundLowBandEnergy ?? null,
    backgroundRmsBeforeDuck: a?.backgroundRmsBeforeDuck ?? null,
    backgroundRmsDuringDuck: a?.backgroundRmsDuringDuck ?? null,
    backgroundRmsAfterDuck: a?.backgroundRmsAfterDuck ?? null,
    duckBackgroundReduction: a?.duckBackgroundReduction ?? null,
    classification: a?.classification ?? (opts.beatInMediaRecorder ? "DIGITAL_BEAT_IN_CAPTURE" : "UNKNOWN"),
    classificationReason: a?.classificationReason ?? "analysis unavailable",
  };
}
