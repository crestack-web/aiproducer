/**
 * Diagnostic-only analysis of the ORIGINAL MediaRecorder capture.
 *
 * - Does NOT modify, normalize, compress, or re-encode the blob.
 * - Measures vocal vs background energy and classifies acoustic bleed.
 * - Used to validate whether VAD speaker-ducking actually reduced
 *   the beat energy that physically entered the microphone.
 */

export type CaptureClassification =
  | "DIGITAL_BEAT_IN_CAPTURE"
  | "ACOUSTIC_BLEED"
  | "IMPROVED_ACOUSTIC_CAPTURE"
  | "CLEAN_CAPTURE"
  | "UNKNOWN";

export type DuckWindowEnergy = {
  beforeRms: number | null;
  duringRms: number | null;
  afterRms: number | null;
  beforePeak: number | null;
  duringPeak: number | null;
  afterPeak: number | null;
};

export type OriginalCaptureBleedReport = {
  originalDurationMs: number;
  sampleRate: number;
  channelCount: number;
  frameMs: number;
  vocalEnergy: number;
  backgroundEnergy: number;
  voiceToBackgroundRatio: number;
  vocalPeak: number;
  backgroundPeak: number;
  nonVocalFrameCount: number;
  vocalFrameCount: number;
  lowBandBackgroundEnergy: number;
  duckWindow: DuckWindowEnergy;
  classification: CaptureClassification;
  notes: string[];
};

const FRAME_MS = 50;
const VOCAL_RMS_THRESHOLD = 0.02;
const BLEED_RATIO_THRESHOLD = 4.0;
const IMPROVED_RATIO_THRESHOLD = 8.0;
const CLEAN_BG_THRESHOLD = 0.008;

function rmsOf(samples: Float32Array): number {
  if (!samples.length) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i];
    sum += v * v;
  }
  return Math.sqrt(sum / samples.length);
}

function peakOf(samples: Float32Array): number {
  let p = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i]);
    if (a > p) p = a;
  }
  return p;
}

/** Rough low-band energy proxy (beat fundamental region) via simple box average. */
function lowBandEnergy(samples: Float32Array, sampleRate: number): number {
  // Decimate-ish average over ~20ms windows as a crude low-frequency proxy
  const win = Math.max(1, Math.floor(sampleRate * 0.02));
  let energy = 0;
  let count = 0;
  for (let i = 0; i + win < samples.length; i += win) {
    let sum = 0;
    for (let j = 0; j < win; j++) sum += samples[i + j];
    const mean = sum / win;
    energy += mean * mean;
    count += 1;
  }
  return count ? Math.sqrt(energy / count) : 0;
}

export type DuckEventLite = {
  tMs: number;
  type: "duck" | "release";
  volume?: number;
};

export async function analyzeOriginalCaptureBleed(
  blob: Blob,
  opts?: {
    beatInMediaRecorder?: boolean;
    duckEvents?: DuckEventLite[];
  }
): Promise<OriginalCaptureBleedReport> {
  const notes: string[] = [];
  const beatIn = opts?.beatInMediaRecorder === true;

  if (typeof AudioContext === "undefined" && typeof (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext === "undefined") {
    return {
      originalDurationMs: 0,
      sampleRate: 0,
      channelCount: 0,
      frameMs: FRAME_MS,
      vocalEnergy: 0,
      backgroundEnergy: 0,
      voiceToBackgroundRatio: 0,
      vocalPeak: 0,
      backgroundPeak: 0,
      nonVocalFrameCount: 0,
      vocalFrameCount: 0,
      lowBandBackgroundEnergy: 0,
      duckWindow: {
        beforeRms: null,
        duringRms: null,
        afterRms: null,
        beforePeak: null,
        duringPeak: null,
        afterPeak: null,
      },
      classification: beatIn ? "DIGITAL_BEAT_IN_CAPTURE" : "UNKNOWN",
      notes: ["AudioContext unavailable in this environment"],
    };
  }

  const AC =
    typeof AudioContext !== "undefined"
      ? AudioContext
      : (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AC();
  let buffer: AudioBuffer;
  try {
    const ab = await blob.arrayBuffer();
    buffer = await ctx.decodeAudioData(ab.slice(0));
  } catch (e) {
    notes.push(`decode failed: ${e instanceof Error ? e.message : String(e)}`);
    try {
      await ctx.close();
    } catch {
      /* ignore */
    }
    return {
      originalDurationMs: 0,
      sampleRate: 0,
      channelCount: 0,
      frameMs: FRAME_MS,
      vocalEnergy: 0,
      backgroundEnergy: 0,
      voiceToBackgroundRatio: 0,
      vocalPeak: 0,
      backgroundPeak: 0,
      nonVocalFrameCount: 0,
      vocalFrameCount: 0,
      lowBandBackgroundEnergy: 0,
      duckWindow: {
        beforeRms: null,
        duringRms: null,
        afterRms: null,
        beforePeak: null,
        duringPeak: null,
        afterPeak: null,
      },
      classification: beatIn ? "DIGITAL_BEAT_IN_CAPTURE" : "UNKNOWN",
      notes,
    };
  }

  const sampleRate = buffer.sampleRate;
  const channelCount = buffer.numberOfChannels;
  const durationMs = buffer.duration * 1000;
  const ch0 = buffer.getChannelData(0);
  const frameSamples = Math.max(1, Math.floor((sampleRate * FRAME_MS) / 1000));

  let vocalSum = 0;
  let vocalCount = 0;
  let bgSum = 0;
  let bgCount = 0;
  let vocalPeak = 0;
  let bgPeak = 0;
  let lowBandBg = 0;
  let lowBandCount = 0;

  const frameRms: { tMs: number; rms: number; peak: number; isVocal: boolean }[] = [];

  for (let i = 0; i + frameSamples <= ch0.length; i += frameSamples) {
    const slice = ch0.subarray(i, i + frameSamples);
    const r = rmsOf(slice);
    const p = peakOf(slice);
    const tMs = (i / sampleRate) * 1000;
    const isVocal = r >= VOCAL_RMS_THRESHOLD;
    frameRms.push({ tMs, rms: r, peak: p, isVocal });
    if (isVocal) {
      vocalSum += r;
      vocalCount += 1;
      if (p > vocalPeak) vocalPeak = p;
    } else {
      bgSum += r;
      bgCount += 1;
      if (p > bgPeak) bgPeak = p;
      lowBandBg += lowBandEnergy(slice, sampleRate);
      lowBandCount += 1;
    }
  }

  const vocalEnergy = vocalCount ? vocalSum / vocalCount : 0;
  const backgroundEnergy = bgCount ? bgSum / bgCount : 0;
  const voiceToBackgroundRatio =
    backgroundEnergy > 1e-9 ? vocalEnergy / backgroundEnergy : vocalEnergy > 0 ? 999 : 0;
  const lowBandBackgroundEnergy = lowBandCount ? lowBandBg / lowBandCount : 0;

  // Duck window comparison from duck events (if provided)
  const duckEvents = opts?.duckEvents || [];
  let beforeRms: number | null = null;
  let duringRms: number | null = null;
  let afterRms: number | null = null;
  let beforePeak: number | null = null;
  let duringPeak: number | null = null;
  let afterPeak: number | null = null;

  if (duckEvents.length > 0) {
    const duckStarts = duckEvents.filter((e) => e.type === "duck").map((e) => e.tMs);
    const releases = duckEvents.filter((e) => e.type === "release").map((e) => e.tMs);
    const firstDuck = duckStarts[0];
    const firstRelease = releases.find((t) => firstDuck != null && t > firstDuck);

    if (firstDuck != null) {
      const beforeFrames = frameRms.filter((f) => !f.isVocal && f.tMs < firstDuck);
      if (beforeFrames.length) {
        beforeRms = beforeFrames.reduce((s, f) => s + f.rms, 0) / beforeFrames.length;
        beforePeak = Math.max(...beforeFrames.map((f) => f.peak));
      }
      if (firstRelease != null) {
        const duringFrames = frameRms.filter(
          (f) => !f.isVocal && f.tMs >= firstDuck && f.tMs <= firstRelease
        );
        if (duringFrames.length) {
          duringRms = duringFrames.reduce((s, f) => s + f.rms, 0) / duringFrames.length;
          duringPeak = Math.max(...duringFrames.map((f) => f.peak));
        }
        const afterFrames = frameRms.filter((f) => !f.isVocal && f.tMs > firstRelease);
        if (afterFrames.length) {
          afterRms = afterFrames.reduce((s, f) => s + f.rms, 0) / afterFrames.length;
          afterPeak = Math.max(...afterFrames.map((f) => f.peak));
        }
      }
    }
  }

  let classification: CaptureClassification;
  if (beatIn) {
    classification = "DIGITAL_BEAT_IN_CAPTURE";
    notes.push("beat_in_media_recorder === true");
  } else if (backgroundEnergy <= CLEAN_BG_THRESHOLD && voiceToBackgroundRatio >= IMPROVED_RATIO_THRESHOLD) {
    classification = "CLEAN_CAPTURE";
  } else if (
    duringRms != null &&
    beforeRms != null &&
    duringRms < beforeRms * 0.7 &&
    voiceToBackgroundRatio >= BLEED_RATIO_THRESHOLD
  ) {
    classification = "IMPROVED_ACOUSTIC_CAPTURE";
    notes.push("background energy dropped during duck windows");
  } else if (backgroundEnergy > CLEAN_BG_THRESHOLD && voiceToBackgroundRatio < IMPROVED_RATIO_THRESHOLD) {
    classification = "ACOUSTIC_BLEED";
    notes.push("non-vocal energy suggests speaker bleed into mic");
  } else if (voiceToBackgroundRatio >= IMPROVED_RATIO_THRESHOLD) {
    classification = "IMPROVED_ACOUSTIC_CAPTURE";
  } else {
    classification = "UNKNOWN";
  }

  try {
    await ctx.close();
  } catch {
    /* ignore */
  }

  return {
    originalDurationMs: durationMs,
    sampleRate,
    channelCount,
    frameMs: FRAME_MS,
    vocalEnergy,
    backgroundEnergy,
    voiceToBackgroundRatio,
    vocalPeak,
    backgroundPeak: bgPeak,
    nonVocalFrameCount: bgCount,
    vocalFrameCount: vocalCount,
    lowBandBackgroundEnergy,
    duckWindow: {
      beforeRms,
      duringRms,
      afterRms,
      beforePeak,
      duringPeak,
      afterPeak,
    },
    classification,
    notes,
  };
}

export function summarizeCaptureForensics(report: OriginalCaptureBleedReport, extra?: Record<string, unknown>) {
  return {
    route: extra?.route ?? null,
    requestedInput: extra?.requestedInput ?? null,
    actualInput: extra?.actualInput ?? null,
    requestedOutput: extra?.requestedOutput ?? null,
    actualOutput: extra?.actualOutput ?? null,
    beatInMediaRecorder: extra?.beatInMediaRecorder === true,
    duckEventCount: extra?.duckEventCount ?? 0,
    originalDurationMs: report.originalDurationMs,
    vocalEnergy: report.vocalEnergy,
    backgroundEnergy: report.backgroundEnergy,
    voiceToBackgroundRatio: report.voiceToBackgroundRatio,
    classification: report.classification,
    duckWindow: report.duckWindow,
    notes: report.notes,
  };
}
