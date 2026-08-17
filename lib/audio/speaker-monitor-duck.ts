/**
 * Phone-speaker monitor ducking (acoustic bleed mitigation).
 *
 * Does NOT touch MediaRecorder or the stored vocal.
 * Only modulates the beat HTMLAudioElement volume while recording
 * when the output route is the phone speaker.
 *
 * MIC → analysis (VAD only) → duck target volume
 * BEAT → HTMLAudioElement volume (monitor only)
 *
 * Constraints:
 * - Never fully mute the beat (artist must still hear timing)
 * - Smooth attack/release (no clicks / rapid pumping)
 * - Prefer not to treat continuous low-band energy (typical of beat bleed)
 *   as voice activity
 * - Headphones / AirPods / external outputs: caller must not start this
 */

export type SpeakerDuckConfig = {
  /** Idle speaker monitor level */
  normalVolume: number;
  /** Level while voice is active — must stay audible for the artist */
  duckedVolume: number;
  /** Absolute floor; volume never goes below this while ducking */
  minUsableVolume: number;
  /** RMS enter threshold 0–1 */
  voiceOnThreshold: number;
  /** RMS exit threshold 0–1 (hysteresis; must be < voiceOnThreshold) */
  voiceOffThreshold: number;
  /** ms voice must stay above on-threshold before duck engages */
  voiceHoldOnMs: number;
  /** ms voice must stay below off-threshold before duck releases */
  voiceHoldOffMs: number;
  /** ms to reach ducked level */
  attackMs: number;
  /** ms to return to normal */
  releaseMs: number;
  /**
   * Weight of mid-band (voice-ish) vs low-band (kick/bass bleed) energy.
   * Higher = less likely to treat beat-only acoustic energy as voice.
   */
  midBandBias: number;
};

export const DEFAULT_SPEAKER_DUCK: SpeakerDuckConfig = {
  /** Idle phone-speaker monitor — still followable, lower acoustic drive into mic */
  normalVolume: 0.045,
  /** While artist is actively singing — strong reduction, not full mute */
  duckedVolume: 0.01,
  /** Absolute floor so timing cues remain; never 0 */
  minUsableVolume: 0.008,
  voiceOnThreshold: 0.018,
  voiceOffThreshold: 0.01,
  voiceHoldOnMs: 50,
  voiceHoldOffMs: 200,
  attackMs: 70,
  releaseMs: 320,
  midBandBias: 1.4,
};

export type SpeakerDuckEvent = {
  type: "duck_start" | "duck_release";
  atMs: number;
  micRms: number;
  beatMonitorVolume: number;
};

export type SpeakerDuckDiagnostics = {
  micRms: number;
  micPeak: number;
  voiceActivity: boolean;
  duckingActive: boolean;
  currentBeatMonitorVolume: number;
  duckingReductionDb: number;
  /** Config / session levels for forensics */
  normalBeatVolume: number;
  duckedBeatVolume: number;
  averageDuckedVolume: number | null;
  /** Average mic RMS while VAD reports no voice (proxy for acoustic beat bleed) */
  rmsSilentAvg: number;
  /** Average mic RMS while VAD reports voice */
  rmsVoiceAvg: number;
  /** Peak mic RMS observed this session */
  rmsPeak: number;
  samplesSilent: number;
  samplesVoice: number;
  /** voice / silent ratio (higher = clearer voice-to-bleed relationship) */
  voiceToBleedRatio: number | null;
  duckEventCount: number;
  lastDuckStartMs: number | null;
  lastDuckReleaseMs: number | null;
  events: SpeakerDuckEvent[];
};

export type SpeakerDuckHandle = {
  /** Call each animation frame or ~50ms while recording */
  tick: (nowMs?: number) => SpeakerDuckDiagnostics;
  stop: () => void;
  getDiagnostics: () => SpeakerDuckDiagnostics;
  getSummary: () => SpeakerDuckDiagnostics;
};

export type CaptureClassification =
  | "DIGITAL_BEAT_IN_CAPTURE"
  | "ACOUSTIC_BLEED"
  | "IMPROVED_ACOUSTIC_CAPTURE"
  | "CLEAN_CAPTURE"
  | "UNKNOWN";

/**
 * Live-mic provisional classification only.
 * Prefer analyzeOriginalCaptureBleed() on the MediaRecorder blob for final label.
 * CLEAN_CAPTURE is never awarded solely because beat_in_media_recorder === false.
 */
export function classifyCapture(opts: {
  beatInMediaRecorder: boolean;
  rmsSilentAvg: number | null | undefined;
  rmsVoiceAvg: number | null | undefined;
  /** Silent RMS above this ⇒ mic is hearing substantial non-voice energy (usually beat) */
  bleedSilentThreshold?: number;
}): {
  classification: CaptureClassification;
  voiceToBleedRatio: number | null;
  reason: string;
} {
  if (opts.beatInMediaRecorder) {
    return {
      classification: "DIGITAL_BEAT_IN_CAPTURE",
      voiceToBleedRatio: null,
      reason: "beat_in_media_recorder === true (architecture violation)",
    };
  }
  const silent = opts.rmsSilentAvg ?? 0;
  const voice = opts.rmsVoiceAvg ?? 0;
  const bleedThresh = opts.bleedSilentThreshold ?? 0.01;
  const ratio =
    silent > 1e-6 && voice > 0 ? voice / silent : voice > 0 && silent <= 1e-6 ? null : null;

  if (silent >= bleedThresh) {
    return {
      classification: "ACOUSTIC_BLEED",
      voiceToBleedRatio: ratio,
      reason: `live silent mic RMS ${silent.toFixed(4)} ≥ ${bleedThresh} — provisional; confirm with original blob analysis`,
    };
  }
  // Live mic quiet is not proof the stored blob is clean
  return {
    classification: "UNKNOWN",
    voiceToBleedRatio: ratio,
    reason: `live silent mic RMS ${silent.toFixed(4)} below threshold — final class requires original blob analysis`,
  };
}

/**
 * Attach lightweight VAD to an existing mic MediaStream (same stream as MediaRecorder).
 * Does not clone tracks into a second recorder — analysis only.
 */
export function startSpeakerMonitorDuck(
  micStream: MediaStream,
  getBeatEl: () => HTMLAudioElement | null,
  config: Partial<SpeakerDuckConfig> = {}
): SpeakerDuckHandle {
  const cfg: SpeakerDuckConfig = { ...DEFAULT_SPEAKER_DUCK, ...config };
  // Enforce usable floor so artist can always follow the beat
  const duckedFloor = Math.max(cfg.minUsableVolume, Math.min(cfg.duckedVolume, cfg.normalVolume));
  const normalVol = Math.max(duckedFloor, cfg.normalVolume);

  let disposed = false;
  let ctx: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let currentVol = normalVol;
  let voiceActivity = false;
  let lastTickMs = 0;
  let aboveSinceMs: number | null = null;
  let belowSinceMs: number | null = null;
  let duckingLatched = false;

  let sumSilent = 0;
  let nSilent = 0;
  let sumVoice = 0;
  let nVoice = 0;
  let rmsPeak = 0;
  let sumDuckedVol = 0;
  let nDuckedVol = 0;
  let lastDuckStartMs: number | null = null;
  let lastDuckReleaseMs: number | null = null;
  const events: SpeakerDuckEvent[] = [];
  const MAX_EVENTS = 40;

  let lastDiag: SpeakerDuckDiagnostics = emptyDiag(normalVol);

  try {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new AC();
    analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.45;
    source = ctx.createMediaStreamSource(micStream);
    source.connect(analyser);
    // Intentionally NOT connected to destination — analysis only
  } catch {
    /* VAD unavailable — leave volume at normal */
  }

  const timeData = analyser ? new Uint8Array(analyser.fftSize) : null;
  const freqData = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;

  function computeRmsAndBands(): { rms: number; peak: number; voiceScore: number } {
    if (!analyser || !timeData) return { rms: 0, peak: 0, voiceScore: 0 };
    analyser.getByteTimeDomainData(timeData);
    let sum = 0;
    let peak = 0;
    for (let i = 0; i < timeData.length; i++) {
      const v = (timeData[i] - 128) / 128;
      sum += v * v;
      const a = Math.abs(v);
      if (a > peak) peak = a;
    }
    const rms = Math.sqrt(sum / timeData.length);

    // Prefer mid-band energy (roughly speech formants) over low-band (kick/bass bleed).
    let voiceScore = rms;
    if (freqData && ctx) {
      analyser.getByteFrequencyData(freqData);
      const nyquist = ctx.sampleRate / 2;
      const binHz = nyquist / freqData.length;
      let low = 0;
      let mid = 0;
      let nLow = 0;
      let nMid = 0;
      for (let i = 0; i < freqData.length; i++) {
        const hz = i * binHz;
        const mag = freqData[i] / 255;
        if (hz < 180) {
          low += mag;
          nLow++;
        } else if (hz >= 250 && hz <= 3500) {
          mid += mag;
          nMid++;
        }
      }
      const lowAvg = nLow > 0 ? low / nLow : 0;
      const midAvg = nMid > 0 ? mid / nMid : 0;
      // Score emphasizes mid-band; pure low-band energy scores lower
      voiceScore = midAvg * cfg.midBandBias + rms * 0.35 - lowAvg * 0.25;
      if (voiceScore < 0) voiceScore = 0;
    }
    return { rms, peak, voiceScore };
  }

  function reductionDb(vol: number): number {
    if (vol <= 0.0001 || normalVol <= 0.0001) return 0;
    return 20 * Math.log10(vol / normalVol);
  }

  function pushEvent(type: SpeakerDuckEvent["type"], atMs: number, micRms: number) {
    if (events.length >= MAX_EVENTS) events.shift();
    events.push({
      type,
      atMs,
      micRms,
      beatMonitorVolume: currentVol,
    });
  }

  function buildDiag(rms: number, peak: number): SpeakerDuckDiagnostics {
    const rmsSilentAvg = nSilent > 0 ? sumSilent / nSilent : 0;
    const rmsVoiceAvg = nVoice > 0 ? sumVoice / nVoice : 0;
    const voiceToBleedRatio =
      rmsSilentAvg > 1e-6 && rmsVoiceAvg > 0 ? rmsVoiceAvg / rmsSilentAvg : null;
    return {
      micRms: rms,
      micPeak: peak,
      voiceActivity,
      duckingActive: duckingLatched && currentVol < normalVol * 0.95,
      currentBeatMonitorVolume: currentVol,
      duckingReductionDb: reductionDb(currentVol),
      normalBeatVolume: normalVol,
      duckedBeatVolume: duckedFloor,
      averageDuckedVolume: nDuckedVol > 0 ? sumDuckedVol / nDuckedVol : null,
      rmsSilentAvg,
      rmsVoiceAvg,
      rmsPeak,
      samplesSilent: nSilent,
      samplesVoice: nVoice,
      voiceToBleedRatio,
      duckEventCount: events.length,
      lastDuckStartMs,
      lastDuckReleaseMs,
      events: events.slice(-12),
    };
  }

  function tick(nowMs = performance.now()): SpeakerDuckDiagnostics {
    if (disposed) return lastDiag;
    const { rms, peak, voiceScore } = computeRmsAndBands();
    if (peak > rmsPeak) rmsPeak = peak;
    if (rms > rmsPeak) rmsPeak = rms;

    // Hysteresis + hold times — reduces pumping and beat-as-voice false triggers
    if (voiceScore >= cfg.voiceOnThreshold || rms >= cfg.voiceOnThreshold * 1.15) {
      belowSinceMs = null;
      if (aboveSinceMs == null) aboveSinceMs = nowMs;
      if (!duckingLatched && nowMs - aboveSinceMs >= cfg.voiceHoldOnMs) {
        duckingLatched = true;
        lastDuckStartMs = nowMs;
        pushEvent("duck_start", nowMs, rms);
      }
    } else if (voiceScore <= cfg.voiceOffThreshold && rms <= cfg.voiceOffThreshold * 1.1) {
      aboveSinceMs = null;
      if (belowSinceMs == null) belowSinceMs = nowMs;
      if (duckingLatched && nowMs - belowSinceMs >= cfg.voiceHoldOffMs) {
        duckingLatched = false;
        lastDuckReleaseMs = nowMs;
        pushEvent("duck_release", nowMs, rms);
      }
    } else {
      // In hysteresis band — hold current latch; reset opposing timer
      if (duckingLatched) aboveSinceMs = nowMs;
      else belowSinceMs = nowMs;
    }

    voiceActivity = duckingLatched;

    if (voiceActivity) {
      sumVoice += rms;
      nVoice += 1;
    } else {
      sumSilent += rms;
      nSilent += 1;
    }

    const target = voiceActivity ? duckedFloor : normalVol;
    const dt = lastTickMs > 0 ? Math.min(80, Math.max(8, nowMs - lastTickMs)) : 16;
    lastTickMs = nowMs;
    const tau = target < currentVol ? cfg.attackMs : cfg.releaseMs;
    const alpha = 1 - Math.exp(-dt / Math.max(1, tau));
    currentVol = currentVol + (target - currentVol) * alpha;
    // Hard floor + ceiling — never mute, never exceed normal
    currentVol = Math.min(normalVol, Math.max(cfg.minUsableVolume, currentVol));

    if (duckingLatched) {
      sumDuckedVol += currentVol;
      nDuckedVol += 1;
    }

    const beat = getBeatEl();
    if (beat && !beat.muted) {
      try {
        // Never hard-mute; floor already applied
        beat.volume = currentVol;
      } catch {
        /* ignore */
      }
    }

    lastDiag = buildDiag(rms, peak);
    return lastDiag;
  }

  function stop() {
    disposed = true;
    // Restore normal monitor level if beat element still exists
    try {
      const beat = getBeatEl();
      if (beat && !beat.muted) {
        beat.volume = normalVol;
      }
    } catch {
      /* ignore */
    }
    try {
      source?.disconnect();
      analyser?.disconnect();
      void ctx?.close();
    } catch {
      /* ignore */
    }
    source = null;
    analyser = null;
    ctx = null;
  }

  return {
    tick,
    stop,
    getDiagnostics: () => lastDiag,
    getSummary: () => lastDiag,
  };
}

function emptyDiag(normalVol: number): SpeakerDuckDiagnostics {
  return {
    micRms: 0,
    micPeak: 0,
    voiceActivity: false,
    duckingActive: false,
    currentBeatMonitorVolume: normalVol,
    duckingReductionDb: 0,
    normalBeatVolume: normalVol,
    duckedBeatVolume: 0.01,
    averageDuckedVolume: null,
    rmsSilentAvg: 0,
    rmsVoiceAvg: 0,
    rmsPeak: 0,
    samplesSilent: 0,
    samplesVoice: 0,
    voiceToBleedRatio: null,
    duckEventCount: 0,
    lastDuckStartMs: null,
    lastDuckReleaseMs: null,
    events: [],
  };
}

export function isPhoneSpeakerOutput(outputId: string | undefined | null): boolean {
  const o = (outputId || "").toLowerCase();
  // Explicit speaker routes only — headphones / AirPods / external never match
  if (!o) return false;
  if (o === "__headphones__" || o.includes("headphone") || o.includes("airpod") || o.includes("bluetooth") || o.includes("earpiece")) {
    return false;
  }
  return o === "__speaker__" || o === "speaker" || o.includes("speaker");
}
