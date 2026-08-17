/**
 * Temporary developer forensics for Recorded Section review.
 * Enabled only when localStorage.studio_debug_audio === "1".
 * Diagnostic only — never mutates playback, rates, or stored audio.
 */

export type ReviewTickSample = {
  timestamp: number;
  beatCurrentTime: number | null;
  vocalCurrentTime: number | null;
  placementStartMs: number;
  expectedVocalTime: number | null;
  actualVocalTime: number | null;
  driftMs: number | null;
  beatPlaybackRate: number | null;
  vocalPlaybackRate: number | null;
  beatVolume: number | null;
  vocalVolume: number | null;
  beatPaused: boolean | null;
  vocalPaused: boolean | null;
  reviewMode: "voice_only" | "beat_plus_voice";
};

export type ReviewSessionSummary = {
  placementStartMs: number;
  reviewMode: "voice_only" | "beat_plus_voice";
  maxDriftMs: number | null;
  averageDriftMs: number | null;
  correctionCount: number;
  largestCorrectionMs: number | null;
  sampleCount: number;
  vocalElementDurationSec: number | null;
  beatElementDurationSec: number | null;
  vocalPlaybackRate: number | null;
  beatPlaybackRate: number | null;
  vocalVolume: number | null;
  beatVolume: number | null;
  activeReviewBeatSources: number;
  samples: ReviewTickSample[];
  at: number;
};

const STORAGE_KEY = "studio_last_review_forensics";
const SAMPLES_KEY = "studio_review_forensics_samples";
const MAX_SAMPLES = 400;

export function isStudioAudioDebugEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem("studio_debug_audio") === "1";
  } catch {
    return false;
  }
}

export function logStudioAudio(label: string, payload: Record<string, unknown>): void {
  if (!isStudioAudioDebugEnabled()) return;
  try {
    // eslint-disable-next-line no-console
    console.info(`[studio-audio:${label}]`, payload);
  } catch {
    /* ignore */
  }
}

/** Accumulate review ticks; flush summary on demand. */
export class ReviewForensicsCollector {
  placementStartMs: number;
  reviewMode: "voice_only" | "beat_plus_voice";
  samples: ReviewTickSample[] = [];
  correctionCount = 0;
  largestCorrectionMs = 0;
  private driftAbsSum = 0;
  private driftAbsCount = 0;
  private maxAbsDrift = 0;
  private lastLogAt = 0;
  private vocalDurationSec: number | null = null;
  private beatDurationSec: number | null = null;
  private lastRates: {
    vocalPlaybackRate: number | null;
    beatPlaybackRate: number | null;
    vocalVolume: number | null;
    beatVolume: number | null;
  } = {
    vocalPlaybackRate: null,
    beatPlaybackRate: null,
    vocalVolume: null,
    beatVolume: null,
  };

  constructor(placementStartMs: number, reviewMode: "voice_only" | "beat_plus_voice") {
    this.placementStartMs = placementStartMs;
    this.reviewMode = reviewMode;
  }

  setDurations(vocalSec: number | null, beatSec: number | null) {
    if (vocalSec != null && Number.isFinite(vocalSec)) this.vocalDurationSec = vocalSec;
    if (beatSec != null && Number.isFinite(beatSec)) this.beatDurationSec = beatSec;
  }

  noteCorrection(correctionAbsMs: number) {
    if (!isStudioAudioDebugEnabled()) return;
    this.correctionCount += 1;
    if (correctionAbsMs > this.largestCorrectionMs) {
      this.largestCorrectionMs = correctionAbsMs;
    }
  }

  /**
   * Sample at most every ~250ms. Does not change playback.
   */
  maybeSample(opts: {
    beat: HTMLAudioElement | null;
    vocal: HTMLAudioElement | null;
    voiceOnly: boolean;
    force?: boolean;
  }): ReviewTickSample | null {
    if (!isStudioAudioDebugEnabled()) return null;
    const now = Date.now();
    if (!opts.force && now - this.lastLogAt < 250) return null;
    this.lastLogAt = now;

    const { beat, vocal, voiceOnly } = opts;
    const placementStartMs = this.placementStartMs;
    let expectedVocalTime: number | null = null;
    let driftMs: number | null = null;
    let beatCurrentTime: number | null = null;
    let songMs: number | null = null;

    if (beat && !voiceOnly) {
      beatCurrentTime = beat.currentTime;
      songMs = beat.currentTime * 1000;
      expectedVocalTime = (songMs - placementStartMs) / 1000;
      if (vocal && expectedVocalTime >= 0) {
        driftMs = (vocal.currentTime - expectedVocalTime) * 1000;
        const abs = Math.abs(driftMs);
        this.driftAbsSum += abs;
        this.driftAbsCount += 1;
        if (abs > this.maxAbsDrift) this.maxAbsDrift = abs;
      }
    }

    const sample: ReviewTickSample = {
      timestamp: now,
      beatCurrentTime,
      vocalCurrentTime: vocal ? vocal.currentTime : null,
      placementStartMs,
      expectedVocalTime,
      actualVocalTime: vocal ? vocal.currentTime : null,
      driftMs,
      beatPlaybackRate: beat ? beat.playbackRate : null,
      vocalPlaybackRate: vocal ? vocal.playbackRate : null,
      beatVolume: beat ? beat.volume : null,
      vocalVolume: vocal ? vocal.volume : null,
      beatPaused: beat ? beat.paused : null,
      vocalPaused: vocal ? vocal.paused : null,
      reviewMode: voiceOnly ? "voice_only" : "beat_plus_voice",
    };

    this.lastRates = {
      vocalPlaybackRate: sample.vocalPlaybackRate,
      beatPlaybackRate: sample.beatPlaybackRate,
      vocalVolume: sample.vocalVolume,
      beatVolume: sample.beatVolume,
    };

    if (this.samples.length < MAX_SAMPLES) this.samples.push(sample);
    logStudioAudio("review-tick", sample as unknown as Record<string, unknown>);
    return sample;
  }

  countActiveBeatSources(opts: {
    reviewBeat: HTMLAudioElement | null;
    boothBeat?: HTMLAudioElement | null;
    voiceOnly: boolean;
  }): number {
    let n = 0;
    try {
      const rb = opts.reviewBeat;
      if (rb && !opts.voiceOnly && !rb.paused && rb.volume > 0.001) n += 1;
      const booth = opts.boothBeat;
      if (booth && !booth.paused && booth.volume > 0.001) n += 1;
    } catch {
      /* ignore */
    }
    return n;
  }

  summarize(activeReviewBeatSources: number): ReviewSessionSummary {
    const summary: ReviewSessionSummary = {
      placementStartMs: this.placementStartMs,
      reviewMode: this.reviewMode,
      maxDriftMs: this.driftAbsCount ? Math.round(this.maxAbsDrift * 10) / 10 : null,
      averageDriftMs:
        this.driftAbsCount > 0
          ? Math.round((this.driftAbsSum / this.driftAbsCount) * 10) / 10
          : null,
      correctionCount: this.correctionCount,
      largestCorrectionMs:
        this.correctionCount > 0 ? Math.round(this.largestCorrectionMs * 10) / 10 : null,
      sampleCount: this.samples.length,
      vocalElementDurationSec: this.vocalDurationSec,
      beatElementDurationSec: this.beatDurationSec,
      vocalPlaybackRate: this.lastRates.vocalPlaybackRate,
      beatPlaybackRate: this.lastRates.beatPlaybackRate,
      vocalVolume: this.lastRates.vocalVolume,
      beatVolume: this.lastRates.beatVolume,
      activeReviewBeatSources,
      samples: this.samples.slice(-40),
      at: Date.now(),
    };
    return summary;
  }

  flush(activeReviewBeatSources: number): ReviewSessionSummary | null {
    if (!isStudioAudioDebugEnabled()) return null;
    const summary = this.summarize(activeReviewBeatSources);
    logStudioAudio("review-summary", summary as unknown as Record<string, unknown>);
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(summary));
      sessionStorage.setItem(
        SAMPLES_KEY,
        JSON.stringify({
          placementStartMs: this.placementStartMs,
          maxDriftMs: summary.maxDriftMs,
          averageDriftMs: summary.averageDriftMs,
          correctionCount: summary.correctionCount,
          largestCorrectionMs: summary.largestCorrectionMs,
          sampleCount: summary.sampleCount,
          activeReviewBeatSources,
          samples: this.samples,
          at: summary.at,
        })
      );
    } catch {
      /* ignore quota */
    }
    return summary;
  }
}

export type DurationProbe = {
  originalBlobDurationSec: number | null;
  reviewSourceDurationSec: number | null;
  mediaElementDurationSec: number | null;
  durationDeltaMs: number | null;
  sourceSampleRate: number | null;
  decodedSampleRate: number | null;
  channelCount: number | null;
  method: string;
};

/**
 * Probe blob duration via Audio element (no decode graph mutation of stored file).
 * Optional Web Audio decode for sample-rate comparison only.
 */
export async function probeReviewSourceDuration(src: string | Blob): Promise<DurationProbe> {
  const result: DurationProbe = {
    originalBlobDurationSec: null,
    reviewSourceDurationSec: null,
    mediaElementDurationSec: null,
    durationDeltaMs: null,
    sourceSampleRate: null,
    decodedSampleRate: null,
    channelCount: null,
    method: "none",
  };

  if (!isStudioAudioDebugEnabled()) return result;

  let objectUrl: string | null = null;
  try {
    const url =
      typeof src === "string"
        ? src
        : (() => {
            objectUrl = URL.createObjectURL(src);
            return objectUrl;
          })();

    const elDuration = await new Promise<number | null>((resolve) => {
      const a = new Audio();
      a.preload = "metadata";
      const done = (v: number | null) => {
        a.removeAttribute("src");
        a.load();
        resolve(v);
      };
      const t = setTimeout(() => done(null), 8000);
      a.onloadedmetadata = () => {
        clearTimeout(t);
        done(Number.isFinite(a.duration) ? a.duration : null);
      };
      a.onerror = () => {
        clearTimeout(t);
        done(null);
      };
      a.src = url;
    });

    result.mediaElementDurationSec = elDuration;
    result.reviewSourceDurationSec = elDuration;
    result.originalBlobDurationSec = elDuration;
    result.method = "html_audio_metadata";

    try {
      const buf =
        typeof src === "string"
          ? await (await fetch(src)).arrayBuffer()
          : await src.arrayBuffer();
      const ctx = new AudioContext();
      try {
        const decoded = await ctx.decodeAudioData(buf.slice(0));
        result.decodedSampleRate = decoded.sampleRate;
        result.channelCount = decoded.numberOfChannels;
        const decodedDur = decoded.duration;
        if (result.mediaElementDurationSec != null && Number.isFinite(decodedDur)) {
          result.durationDeltaMs = Math.round(
            (decodedDur - result.mediaElementDurationSec) * 1000
          );
        }
        if (result.reviewSourceDurationSec == null) {
          result.reviewSourceDurationSec = decodedDur;
          result.originalBlobDurationSec = decodedDur;
        }
        result.method = "html_audio_metadata+decodeAudioData";
      } finally {
        await ctx.close().catch(() => undefined);
      }
    } catch {
      /* decode optional */
    }

    logStudioAudio("duration-probe", result as unknown as Record<string, unknown>);
  } catch (e) {
    logStudioAudio("duration-probe-error", {
      error: e instanceof Error ? e.message : "probe failed",
    });
  } finally {
    if (objectUrl) {
      try {
        URL.revokeObjectURL(objectUrl);
      } catch {
        /* ignore */
      }
    }
  }

  return result;
}

export function readLastReviewForensics(): ReviewSessionSummary | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ReviewSessionSummary;
  } catch {
    return null;
  }
}
