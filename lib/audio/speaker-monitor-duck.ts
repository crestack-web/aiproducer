/**
 * Phone-speaker monitor ducking (acoustic bleed mitigation).
 *
 * Does NOT touch MediaRecorder or the stored vocal.
 * Only modulates the beat HTMLAudioElement volume while recording
 * when the output route is the phone speaker.
 *
 * MIC → analysis (VAD only) → duck target volume
 * BEAT → HTMLAudioElement volume (monitor only)
 */

export type SpeakerDuckConfig = {
  /** Idle speaker monitor level */
  normalVolume: number;
  /** Level while voice is active */
  duckedVolume: number;
  /** RMS threshold 0–1 for voice activity */
  voiceThreshold: number;
  /** ms to reach ducked level */
  attackMs: number;
  /** ms to return to normal */
  releaseMs: number;
};

export const DEFAULT_SPEAKER_DUCK: SpeakerDuckConfig = {
  normalVolume: 0.05,
  duckedVolume: 0.015,
  voiceThreshold: 0.018,
  attackMs: 80,
  releaseMs: 320,
};

export type SpeakerDuckDiagnostics = {
  micRms: number;
  voiceActivity: boolean;
  duckingActive: boolean;
  currentBeatMonitorVolume: number;
  duckingReductionDb: number;
};

export type SpeakerDuckHandle = {
  /** Call each animation frame or ~50ms while recording */
  tick: (nowMs?: number) => SpeakerDuckDiagnostics;
  stop: () => void;
  getDiagnostics: () => SpeakerDuckDiagnostics;
};

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
  let disposed = false;
  let ctx: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let currentVol = cfg.normalVolume;
  let voiceActivity = false;
  let lastDiag: SpeakerDuckDiagnostics = {
    micRms: 0,
    voiceActivity: false,
    duckingActive: false,
    currentBeatMonitorVolume: cfg.normalVolume,
    duckingReductionDb: 0,
  };
  let lastTickMs = 0;

  try {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new AC();
    analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.4;
    source = ctx.createMediaStreamSource(micStream);
    source.connect(analyser);
    // Intentionally NOT connected to destination — analysis only
  } catch {
    /* VAD unavailable — leave volume at normal */
  }

  const timeData = analyser ? new Uint8Array(analyser.fftSize) : null;

  function computeRms(): number {
    if (!analyser || !timeData) return 0;
    analyser.getByteTimeDomainData(timeData);
    let sum = 0;
    for (let i = 0; i < timeData.length; i++) {
      const v = (timeData[i] - 128) / 128;
      sum += v * v;
    }
    return Math.sqrt(sum / timeData.length);
  }

  function reductionDb(vol: number): number {
    if (vol <= 0.0001 || cfg.normalVolume <= 0.0001) return 0;
    return 20 * Math.log10(vol / cfg.normalVolume);
  }

  function tick(nowMs = performance.now()): SpeakerDuckDiagnostics {
    if (disposed) return lastDiag;
    const rms = computeRms();
    voiceActivity = rms >= cfg.voiceThreshold;
    const target = voiceActivity ? cfg.duckedVolume : cfg.normalVolume;
    const dt = lastTickMs > 0 ? Math.min(80, Math.max(8, nowMs - lastTickMs)) : 16;
    lastTickMs = nowMs;
    const tau = target < currentVol ? cfg.attackMs : cfg.releaseMs;
    const alpha = 1 - Math.exp(-dt / Math.max(1, tau));
    currentVol = currentVol + (target - currentVol) * alpha;

    const beat = getBeatEl();
    if (beat && !beat.muted) {
      try {
        beat.volume = Math.min(cfg.normalVolume, Math.max(0, currentVol));
      } catch {
        /* ignore */
      }
    }

    lastDiag = {
      micRms: rms,
      voiceActivity,
      duckingActive: voiceActivity && currentVol < cfg.normalVolume * 0.95,
      currentBeatMonitorVolume: currentVol,
      duckingReductionDb: reductionDb(currentVol),
    };
    return lastDiag;
  }

  function stop() {
    disposed = true;
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
  };
}

export function isPhoneSpeakerOutput(outputId: string | undefined | null): boolean {
  const o = (outputId || "").toLowerCase();
  return o === "__speaker__" || o === "speaker" || o.includes("speaker");
}
