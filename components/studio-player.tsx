"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { routePlaybackToPreferredOutput } from "@/components/mic-input-picker";
import { useTheme } from "@/lib/theme";

function usePlayerColors() {
  const { colors, mode } = useTheme();
  return useMemo(
    () => ({
      ...colors,
      signalSoft: mode === "light" ? "rgba(10,138,118,0.12)" : "rgba(123,235,212,0.14)",
      waveMuted: mode === "light" ? "rgba(28,25,22,0.12)" : "rgba(255,255,255,0.14)",
    }),
    [colors, mode]
  );
}

const COVER_GRADIENTS: [string, string][] = [
  ["#3A2E52", "#0B0A0F"],
  ["#2E4A4A", "#0B0A0F"],
  ["#4A2E3A", "#0B0A0F"],
  ["#39422E", "#0B0A0F"],
  ["#2E3A4A", "#0B0A0F"],
];

function seededRandom(seed: string) {
  let s = 0;
  for (let i = 0; i < seed.length; i++) s = (s * 31 + seed.charCodeAt(i)) >>> 0;
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return (s & 0xfffffff) / 0xfffffff;
  };
}


function mediaErrorLabel(code: number | undefined | null): string {
  switch (code) {
    case 1:
      return "MEDIA_ERR_ABORTED";
    case 2:
      return "MEDIA_ERR_NETWORK";
    case 3:
      return "MEDIA_ERR_DECODE";
    case 4:
      return "MEDIA_ERR_SRC_NOT_SUPPORTED";
    default:
      return code != null ? `MEDIA_ERR_${code}` : "unknown";
  }
}

export function makeWave(seed: string, n = 48) {
  const rnd = seededRandom(seed || "studio");
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const base = 0.35 + 0.3 * Math.sin(i / 3.1 + (seed?.length || 1)) + rnd() * 0.35;
    out.push(Math.max(0.12, Math.min(1, base)));
  }
  return out;
}

export function coverGradientFor(seed: string): [string, string] {
  let h = 0;
  for (let i = 0; i < (seed || "x").length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return COVER_GRADIENTS[h % COVER_GRADIENTS.length];
}

function PlayIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M8 5.5v13l11-6.5L8 5.5Z" />
    </svg>
  );
}

function PauseIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </svg>
  );
}

export function Waveform({
  bars,
  progress = 0,
  height = 48,
  activeColor,
  mutedColor,
}: {
  bars: number[];
  progress?: number;
  height?: number;
  activeColor?: string;
  mutedColor?: string;
}) {
  const C = usePlayerColors();
  const active = activeColor || C.brass;
  const muted = mutedColor || C.waveMuted;
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height, width: "100%" }}>
      {bars.map((v, i) => {
        const on = i / bars.length <= progress;
        return (
          <div
            key={i}
            style={{
              flex: 1,
              height: `${Math.max(12, v * 100)}%`,
              borderRadius: 2,
              background: on ? active : muted,
              transition: "background 0.15s ease",
            }}
          />
        );
      })}
    </div>
  );
}

const COVER_ICON_HUES = [28, 160, 200, 280, 340, 45, 190];

function MusicNoteIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      style={{ display: "block" }}
    >
      <path
        d="M9 18V6.5l10-2V16"
        stroke={color}
        strokeWidth="1.85"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="7" cy="18" r="2.6" fill={color} />
      <circle cx="17" cy="16" r="2.6" fill={color} />
    </svg>
  );
}

/** Album-style cover: seed gradient + music icon that shifts hue with the seed. */
export function CoverArt({
  seed,
  size = 64,
  showIcon = true,
}: {
  seed: string;
  size?: number;
  showIcon?: boolean;
}) {
  const C = usePlayerColors();
  const [a, b] = coverGradientFor(seed);
  let h = 0;
  for (let i = 0; i < (seed || "x").length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const hue = COVER_ICON_HUES[h % COVER_ICON_HUES.length];
  const iconColor = `hsla(${hue}, 72%, 72%, 0.95)`;
  const iconSize = Math.max(18, Math.round(size * 0.42));
  const radius = size >= 56 ? 14 : 12;

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        flexShrink: 0,
        background: `linear-gradient(145deg, ${a}, ${b})`,
        boxShadow: C.cardShadow,
        position: "relative",
        overflow: "hidden",
        display: "grid",
        placeItems: "center",
      }}
      aria-hidden
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "radial-gradient(circle at 30% 20%, rgba(255,255,255,0.16), transparent 60%)",
        }}
      />
      {/* Soft accent ring that picks up the icon hue */}
      <div
        style={{
          position: "absolute",
          inset: size * 0.12,
          borderRadius: "50%",
          border: `1px solid hsla(${hue}, 60%, 70%, 0.22)`,
          pointerEvents: "none",
        }}
      />
      {showIcon && (
        <div
          style={{
            position: "relative",
            zIndex: 1,
            filter: `drop-shadow(0 2px 6px hsla(${hue}, 80%, 40%, 0.45))`,
            animation: "coverIconPulse 4.5s ease-in-out infinite",
            animationDelay: `${(h % 7) * 0.15}s`,
          }}
        >
          <MusicNoteIcon size={iconSize} color={iconColor} />
        </div>
      )}
      <style>{`
        @keyframes coverIconPulse {
          0%, 100% { opacity: 0.88; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.06); }
        }
      `}</style>
    </div>
  );
}

export function StudioPlayer({
  src,
  title,
  subtitle,
  seed = "studio",
  accent = "brass",
}: {
  src: string;
  title?: string;
  subtitle?: string;
  seed?: string;
  accent?: "brass" | "signal";
}) {
  const C = usePlayerColors();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const bars = useMemo(() => makeWave(seed, 56), [seed]);
  const color = accent === "signal" ? C.signal : C.brass;

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onTime = () => {
      if (!el.duration) return;
      setProgress(el.currentTime / el.duration);
    };
    const onEnd = () => setPlaying(false);
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("ended", onEnd);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("ended", onEnd);
    };
  }, []);

  async function toggle() {
    const el = audioRef.current;
    if (!el) return;
    if (playing) {
      el.pause();
      setPlaying(false);
    } else {
      await el.play().catch(() => undefined);
      setPlaying(true);
    }
  }

  return (
    <div
      style={{
        marginTop: 16,
        padding: 14,
        borderRadius: 18,
        border: `1px solid ${C.border}`,
        background: C.surface,
        boxShadow: C.cardShadow,
      }}
    >
      <audio ref={audioRef} src={src} preload="metadata" playsInline />
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <CoverArt seed={seed} size={56} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {title || "Audio"}
          </div>
          {subtitle && (
            <div style={{ fontSize: 12.5, color: C.textMuted, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {subtitle}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? "Pause" : "Play"}
          style={{
            width: 44,
            height: 44,
            borderRadius: 999,
            border: "none",
            background: `linear-gradient(180deg, #F0BC80, ${C.brass})`,
            color: "#1A1208",
            display: "grid",
            placeItems: "center",
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          {playing ? <PauseIcon /> : <PlayIcon />}
        </button>
      </div>
      <div style={{ marginTop: 12 }}>
        <Waveform bars={bars} progress={progress} activeColor={color} height={40} />
      </div>
    </div>
  );
}

export function RecordingVisualizer({
  stream,
  seconds,
  label = "Recording",
  seed = "rec",
  maxSeconds,
}: {
  stream: MediaStream | null;
  seconds: number;
  label?: string;
  seed?: string;
  maxSeconds?: number | null;
}) {
  const C = usePlayerColors();
  const [levels, setLevels] = useState<number[]>(() => Array(32).fill(0.15));
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!stream) return;
    let cancelled = false;
    const ctx = new AudioContext();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);

    const tick = () => {
      if (cancelled) return;
      analyser.getByteFrequencyData(data);
      const step = Math.floor(data.length / 32);
      const next: number[] = [];
      for (let i = 0; i < 32; i++) {
        let sum = 0;
        for (let j = 0; j < step; j++) sum += data[i * step + j] || 0;
        next.push(Math.max(0.08, Math.min(1, sum / step / 180)));
      }
      setLevels(next);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      try {
        source.disconnect();
        analyser.disconnect();
        void ctx.close();
      } catch {
        /* ignore */
      }
    };
  }, [stream]);

  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  const maxLabel =
    maxSeconds != null && maxSeconds > 0
      ? ` / ${String(Math.floor(maxSeconds / 60)).padStart(2, "0")}:${String(Math.floor(maxSeconds % 60)).padStart(2, "0")}`
      : "";

  return (
    <div
      style={{
        marginTop: 12,
        padding: 16,
        borderRadius: 18,
        border: `1px solid ${C.brassLine}`,
        background: `radial-gradient(ellipse at 50% 0%, ${C.brassSoft}, transparent 55%), ${C.surface}`,
        boxShadow: C.cardShadow,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: 0.8, color: C.brass, textTransform: "uppercase" }}>
          {label}
        </span>
        <span style={{ fontFamily: "Georgia, serif", fontSize: 18, color: C.text }}>
          {mm}:{ss}
          {maxLabel ? <span style={{ color: C.textMuted, fontSize: 14 }}>{maxLabel}</span> : null}
        </span>
      </div>
      <Waveform bars={levels} progress={1} activeColor={C.danger} mutedColor={C.waveMuted} height={52} />
    </div>
  );
}

export function PlayerLoadingState({
  title,
  subtitle,
  seed = "load",
}: {
  title: string;
  subtitle?: string;
  seed?: string;
}) {
  const C = usePlayerColors();
  const bars = useMemo(() => makeWave(seed, 40), [seed]);
  const [p, setP] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setP((x) => (x + 0.04) % 1.2), 80);
    return () => clearInterval(id);
  }, []);
  return (
    <div
      style={{
        marginTop: 24,
        padding: 20,
        borderRadius: 18,
        border: `1px solid ${C.border}`,
        background: C.surface,
        boxShadow: C.cardShadow,
        textAlign: "center",
      }}
    >
      <div style={{ fontFamily: "Georgia, serif", fontSize: 20, color: C.text, marginBottom: 6 }}>{title}</div>
      {subtitle && <p style={{ color: C.textMuted, fontSize: 14, margin: "0 0 14px" }}>{subtitle}</p>}
      <Waveform bars={bars} progress={Math.min(1, p)} height={36} />
    </div>
  );
}

/**
 * Recorded Section review player.
 * Musical placement (same as Produce):
 *   placementStartMs = sectionStartMs + recordingOffsetMs
 *
 * MODE A — Beat + Voice: CLEAN reference beat + original recorded vocal (both playing).
 * MODE B — Voice Only: recorded vocal only (reference beat stopped/muted).
 *
 * Booth monitor beat must stay paused during review — this player owns its own beat element.
 */
export function CompactAudioPlayer({
  src,
  label,
  seed = "take",
  beatSrc,
  beatStartMs = 0,
  beatEndMs,
  beatVolume = 0.03,
  vocalVolume = 1,
  /** Review/preview output preference — not the recording-monitor route. */
  playbackSinkId,
  debugSectionLabel,
  debugTaskId,
  debugSectionStartMs,
  debugRecordingOffsetMs,
  overdubSrcs,
}: {
  src: string;
  label?: string;
  seed?: string;
  beatSrc?: string | null;
  beatStartMs?: number;
  beatEndMs?: number | null;
  beatVolume?: number;
  vocalVolume?: number;
  playbackSinkId?: string | null;
  debugSectionLabel?: string | null;
  debugTaskId?: string | null;
  debugSectionStartMs?: number | null;
  debugRecordingOffsetMs?: number | null;
  /** Other takes already recorded in this section (lead under a double, etc.) */
  overdubSrcs?: { url: string; volume?: number; label?: string }[] | null;
}) {
  const C = usePlayerColors();
  const vocalRef = useRef<HTMLAudioElement | null>(null);
  const beatRef = useRef<HTMLAudioElement | null>(null);
  const overdubRefs = useRef<HTMLAudioElement[]>([]);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const bars = useMemo(() => makeWave(seed, 40), [seed]);
  const rafRef = useRef<number | null>(null);
  const voiceOnly = beatVolume <= 0.001;
  const placementStartMs = Math.max(0, beatStartMs || 0);
  const pausedSongMsRef = useRef<number | null>(null);
  // Live mode refs so RAF / transitions never use a stale closure from toggle()
  const voiceOnlyRef = useRef(voiceOnly);
  const beatVolumeRef = useRef(beatVolume);
  const vocalVolumeRef = useRef(vocalVolume);
  const playingRef = useRef(playing);
  const placementRef = useRef(placementStartMs);
  const beatFreezeRecoveriesRef = useRef(0);
  // Sync-loop forensics (Beat + Voice)
  const vocalPauseCountRef = useRef(0);
  const vocalSeekCountRef = useRef(0);
  const vocalCorrectionCountRef = useRef(0);
  const lastVocalPauseReasonRef = useRef<string | null>(null);
  const lastVocalSeekTargetRef = useRef<number | null>(null);
  const driftSamplesRef = useRef<{ sum: number; n: number; max: number }>({ sum: 0, n: 0, max: 0 });
  const alignedRef = useRef(false);
  /** Once true, vocal has been started for the current play session after placement. */
  const vocalEngagedRef = useRef(false);
  const vocalStartedAtBeatMsRef = useRef<number | null>(null);
  /** True until beat.currentTime is confirmed near placementStartMs */
  const seekPendingRef = useRef(false);
  /** Detect frozen beat (currentTime not advancing while unpaused). */
  const lastBeatClockRef = useRef<{ t: number; at: number }>({ t: -1, at: 0 });
  /** Throttle RAF-driven re-seek so we don't loop mute/unmute */
  const lastReseekAtRef = useRef(0);
  /** One soft beat nudge per play to cancel start lag (HTTP takes often ~100–200ms late). */
  const syncNudgedRef = useRef(false);
  const syncLastNudgeAtRef = useRef(0);
  voiceOnlyRef.current = voiceOnly;
  beatVolumeRef.current = beatVolume;
  vocalVolumeRef.current = vocalVolume;
  playingRef.current = playing;
  placementRef.current = placementStartMs;
  /** Review mix: vocal at 1.0; beat is a quiet guide only (not final mix).
   * Generated beats are hot vs phone takes — keep linear gain very low. */
  /**
   * Review guide bed only — not a full mix.
   * Mastered instrumentals at 0.10 still mask quiet phone vocals (confirmed in device diagnostics).
   * Cap hard so prop mistakes cannot restore a loud beat.
   */
  /**
   * Review guide bed linear gain.
   * Native element volume (Web Audio dual-graph was killing one stream on device).
   * 0.03 keeps the bed present as a guide without fully masking phone takes on desktop.
   */
  const reviewBeatGain = (v: number) => {
    if (v <= 0.0005) return 0;
    return 0.03;
  };
  /**
   * Review must match record timing: vocal t=0 aligns to placementStartMs on the beat.
   * No artificial delay — delay caused "wrong section of beat" vs what was recorded.
   */
  const REVIEW_BEAT_DELAY_SEC = 0;


  // Section overdubs (prior takes) for review — same musical clock as beat + new take
  useEffect(() => {
    for (const el of overdubRefs.current) {
      try {
        el.pause();
        el.removeAttribute("src");
      } catch {
        /* ignore */
      }
    }
    overdubRefs.current = [];
    const list = overdubSrcs || [];
    for (const o of list.slice(0, 4)) {
      if (!o?.url) continue;
      try {
        const el = new Audio();
        el.preload = "auto";
        el.crossOrigin = "anonymous";
        el.src = o.url;
        el.volume = Math.max(0.05, Math.min(0.85, o.volume ?? 0.55));
        el.muted = false;
        overdubRefs.current.push(el);
        void routePlaybackToPreferredOutput(el, playbackSinkId || undefined).catch(() => undefined);
      } catch {
        /* skip */
      }
    }
    return () => {
      for (const el of overdubRefs.current) {
        try {
          el.pause();
          el.removeAttribute("src");
        } catch {
          /* ignore */
        }
      }
      overdubRefs.current = [];
    };
  }, [overdubSrcs, playbackSinkId, src]);



  // Review listening output (speaker). Never block play if setSinkId fails.
  useEffect(() => {
    if (!playbackSinkId) return;
    const vocal = vocalRef.current;
    const beat = beatRef.current;
    void routePlaybackToPreferredOutput(vocal, playbackSinkId).catch(() => undefined);
    void routePlaybackToPreferredOutput(beat, playbackSinkId).catch(() => undefined);
  }, [playbackSinkId, src, beatSrc]);

  // Take switch: reload vocal element when Review src changes (no duplicate elements).
  useEffect(() => {
    const vocal = vocalRef.current;
    if (!vocal || !src) return;
    try {
      vocal.pause();
      // Ensure the element picks up the new blob/signed URL immediately.
      if (vocal.src !== src && !vocal.src.endsWith(src) && vocal.getAttribute("src") !== src) {
        vocal.src = src;
      }
      vocal.load();
      setPlaying(false);
      setProgress(0);
      setLoadError(null);
      vocalEngagedRef.current = false;
      alignedRef.current = false;
    } catch {
      /* ignore */
    }
  }, [src]);

  // Optional diagnostic: localStorage studio_review_nosync=1 disables continuous vocal seeks
  const noSyncCorrections = () => {
    try {
      return typeof window !== "undefined" && localStorage.getItem("studio_review_nosync") === "1";
    } catch {
      return false;
    }
  };

  const stopRaf = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  };

  const hardStopBeat = useCallback(() => {
    const beat = beatRef.current;
    if (!beat) return;
    try {
      beat.pause();
      beat.volume = 0;
      beat.muted = true;
      try {
        beat.playbackRate = 1;
      } catch {
        /* ignore */
      }
    } catch {
      /* ignore */
    }
  }, []);

  /**
   * Review volumes via native element only (no Web Audio).
   * Dual MediaElementSource broke Beat+Voice on device (one stream died).
   * Desktop respects beat volume; iOS may play beat hotter — still both audible.
   */
  const applyReviewVolumes = useCallback(
    (beat: HTMLAudioElement | null | undefined, vocal: HTMLAudioElement | null | undefined, beatLinear: number) => {
      const g = Math.max(0, Math.min(1, beatLinear));
      try {
        if (beat) {
          beat.muted = g <= 0;
          beat.volume = g <= 0 ? 0 : g;
        }
        if (vocal) {
          vocal.muted = false;
          vocal.volume = 1;
        }
      } catch {
        /* ignore */
      }
    },
    []
  );

  const ensureBeatGuideGain = useCallback(
    async (beat: HTMLAudioElement, linear: number) => {
      applyReviewVolumes(beat, vocalRef.current, linear);
    },
    [applyReviewVolumes]
  );

  const ensureReviewWebAudio = useCallback(
    async (opts: {
      vocal?: HTMLAudioElement | null;
      beat?: HTMLAudioElement | null;
      beatLinear?: number;
      vocalLinear?: number;
    }) => {
      applyReviewVolumes(opts.beat, opts.vocal, opts.beatLinear ?? 0.03);
    },
    [applyReviewVolumes]
  );

  function vocalFileTimeFromSongMs(songMs: number, placeMs: number): number {
    return (songMs - placeMs) / 1000;
  }

  /**
   * Non-blocking beat seek to placement.
   * Never mutes — mute-until-landed was leaving Review Beat+Voice silent.
   * Never pauses the vocal while correcting the beat.
   */
  function scheduleBeatSeek(
    el: HTMLAudioElement,
    targetSec: number,
    onResult: (appliedSec: number, ok: boolean) => void,
    _opts?: { muteUntilLanded?: boolean }
  ): void {
    const target = Math.max(0, targetSec);
    let attempts = 0;
    const maxAttempts = 12;
    let finished = false;

    const ensureAudible = () => {
      try {
        el.muted = false;
        void ensureBeatGuideGain(el, reviewBeatGain(beatVolumeRef.current));
      } catch {
        /* ignore */
      }
    };

    const finish = (applied: number, ok: boolean) => {
      if (finished) return;
      finished = true;
      seekPendingRef.current = !ok && Math.abs(applied - target) >= 1.0;
      ensureAudible();
      onResult(applied, ok);
    };

    const tryOnce = () => {
      if (finished) return;
      attempts += 1;
      try {
        const anyEl = el as HTMLAudioElement & { fastSeek?: (t: number) => void };
        if (typeof anyEl.fastSeek === "function") {
          try {
            anyEl.fastSeek(target);
          } catch {
            el.currentTime = target;
          }
        } else {
          el.currentTime = target;
        }
      } catch {
        /* ignore */
      }
      const check = () => {
        if (finished) return;
        const applied = el.currentTime;
        const ok = Math.abs(applied - target) < 0.85;
        if (ok) {
          finish(applied, true);
          return;
        }
        if (attempts < maxAttempts) {
          window.setTimeout(tryOnce, attempts < 4 ? 50 : 100);
        } else {
          finish(applied, Math.abs(applied - target) < 1.5);
        }
      };
      const onSeeked = () => {
        el.removeEventListener("seeked", onSeeked);
        check();
      };
      el.addEventListener("seeked", onSeeked);
      window.setTimeout(() => {
        el.removeEventListener("seeked", onSeeked);
        check();
      }, 200);
    };

    ensureAudible();
    seekPendingRef.current = target > 0.5;
    tryOnce();
  }

  function writeReviewDiagnostics(_payload?: Record<string, unknown>) {
    /* diagnostics removed */
  }


  async function toggle() {
    const vocal = vocalRef.current;
    if (!vocal) {
      setLoadError("Vocal element missing");
      writeReviewDiagnostics({ event: "no_vocal_element" });
      return;
    }

    // Pause
    if (playingRef.current) {
      const beat = beatRef.current;
      const place = placementRef.current;
      const songMs =
        beat && beatSrc && !voiceOnlyRef.current && !beat.paused && !seekPendingRef.current
          ? beat.currentTime * 1000
          : place + vocal.currentTime * 1000;
      pausedSongMsRef.current = songMs;
      try {
        vocal.pause();
      } catch {
        /* ignore */
      }
      hardStopBeat();
      stopRaf();
      seekPendingRef.current = false;
      syncNudgedRef.current = false;
    beatFreezeRecoveriesRef.current = 0;
      syncLastNudgeAtRef.current = 0;
      setPlaying(false);
      playingRef.current = false;
      writeReviewDiagnostics({ event: "pause" });
      return;
    }

    setLoadError(null);
    const place = placementRef.current;
    let songMs = pausedSongMsRef.current != null ? pausedSongMsRef.current : place;
    // If a prior pause left us past the take, restart from section placement
    try {
      const v = vocalRef.current;
      const takeDur = v?.duration;
      if (
        Number.isFinite(takeDur) &&
        (takeDur as number) > 0 &&
        songMs - place >= (takeDur as number) * 1000 - 80
      ) {
        songMs = place;
        pausedSongMsRef.current = null;
      }
    } catch {
      /* ignore */
    }
    const wantBeat = Boolean(beatSrc && !voiceOnlyRef.current);
    const beat = beatRef.current;
    const startAtPlacement = songMs + 50 >= place;
    // Delay beat so take does not feel late against the instrumental
    const beatSeekTargetSec = Math.max(0, songMs / 1000 + REVIEW_BEAT_DELAY_SEC);

    const vocalSrc = (vocal.currentSrc || vocal.src || src || "").slice(0, 96);
    const isBlobUrl = /^blob:/i.test(vocal.currentSrc || vocal.src || src || "");

    // Prepare elements — wire BOTH through Web Audio before any play() (iOS dual-media)
    try {
      vocal.muted = false;
      vocal.volume = 1;
      vocal.playbackRate = 1;
      try {
        // Take file is always 0-based. Never seek past duration (that yields total silence).
        const target = Math.max(0, vocalFileTimeFromSongMs(songMs, place));
        const dur = vocal.duration;
        if (Number.isFinite(dur) && dur > 0) {
          vocal.currentTime = Math.min(target, Math.max(0, dur - 0.05));
        } else {
          vocal.currentTime = target;
        }
      } catch {
        try {
          vocal.currentTime = 0;
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* ignore */
    }

    try {
      await ensureReviewWebAudio({
        vocal,
        beat: wantBeat && beat ? beat : null,
        beatLinear: reviewBeatGain(beatVolumeRef.current),
        vocalLinear: 1,
      });
    } catch {
      /* ignore */
    }

    if (wantBeat && beat) {
      try {
        beat.muted = false;
        await ensureBeatGuideGain(beat, reviewBeatGain(beatVolumeRef.current));
        beat.playbackRate = 1;
        // Best-effort pre-seek (may not stick on iOS until after play)
        try {
          beat.currentTime = beatSeekTargetSec;
        } catch {
          /* ignore */
        }
      } catch {
        /* ignore */
      }
    } else {
      hardStopBeat();
    }

    let vocalPlaySucceeded = false;
    let beatPlaySucceeded = false;
    let vocalPlayError: string | null = null;
    let beatPlayError: string | null = null;

    // Simultaneous start: same gesture, same clock — matches how the take was recorded.
    // Do NOT wait for vocal to advance before beat (that injected 100–400ms drift).
    if (wantBeat && beat) {
      try {
        beat.muted = false;
        await ensureBeatGuideGain(beat, reviewBeatGain(beatVolumeRef.current));
        beat.playbackRate = 1;
        // Beat song time = placement + vocal file time (0 at start) + optional delay (0)
        const aligned = Math.max(
          0,
          place / 1000 + Math.max(0, vocal.currentTime) + REVIEW_BEAT_DELAY_SEC
        );
        try {
          beat.currentTime = aligned;
        } catch {
          /* ignore */
        }
      } catch {
        /* ignore */
      }
    }

    const playResults = await Promise.allSettled([
      vocal.play().then(() => "vocal" as const),
      wantBeat && beat
        ? beat.play().then(() => "beat" as const)
        : Promise.resolve("beat_skip" as const),
    ]);
    for (const r of playResults) {
      if (r.status === "fulfilled") {
        if (r.value === "vocal") vocalPlaySucceeded = true;
        if (r.value === "beat") beatPlaySucceeded = true;
      } else {
        const msg =
          r.reason instanceof Error
            ? `${r.reason.name}: ${r.reason.message}`
            : String(r.reason);
        // Distinguish which failed when possible
        if (!vocalPlaySucceeded && !vocalPlayError) vocalPlayError = msg;
        if (wantBeat && beat && !beatPlaySucceeded && !beatPlayError) beatPlayError = msg;
      }
    }
    // If vocal failed but beat ran, still try vocal again once (iOS dual-media)
    if (!vocalPlaySucceeded) {
      try {
        await vocal.play();
        vocalPlaySucceeded = true;
        vocalPlayError = null;
      } catch (e: unknown) {
        vocalPlayError = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      }
    }

    // Always keep the take engaged — dual play on mobile often pauses the vocal when beat starts
    vocalEngagedRef.current = true;
    // Overdubs: align file t=0 to same placement as the take under review
    for (const el of overdubRefs.current) {
      try {
        const placeSec = Math.max(0, place / 1000);
        // Overdub takes are also section-aligned at t=0 ≈ their placement; start at 0 with the new take
        el.currentTime = 0;
        el.muted = false;
        void el.play().catch(() => undefined);
      } catch {
        /* ignore */
      }
    }
    if (wantBeat && startAtPlacement) {
      vocalStartedAtBeatMsRef.current = place;
    }

    // Re-assert vocal AFTER beat graph/play (iOS frequently ducks/pauses the other element)
    try {
      await ensureReviewWebAudio({
        vocal,
        beat: wantBeat ? beat : null,
        beatLinear: reviewBeatGain(beatVolumeRef.current),
        vocalLinear: 1,
      });
      vocal.muted = false;
      vocal.volume = 1;
      if (vocal.paused) {
        await vocal.play().catch(() => undefined);
      }
    } catch {
      /* ignore */
    }

    // Recover if the browser accepted play() then immediately paused (common with dual <audio>)
    if (vocal.paused) {
      try {
        vocal.muted = false;
        vocal.volume = 1;
        await vocal.play();
      } catch (ve) {
        const msg = ve instanceof Error ? ve.message : String(ve);
        writeReviewDiagnostics({ event: "vocal_replay_failed", error: msg });
      }
    }
    // Last resort: if still silent, try voice-only so the artist hears the take
    if (vocal.paused && vocalPlaySucceeded === false) {
      setLoadError("Could not play this take. Tap play again, or switch Voice only.");
    }
    if (wantBeat && beat && beatPlaySucceeded && beat.paused) {
      try {
        beat.muted = false;
        await ensureBeatGuideGain(beat, reviewBeatGain(beatVolumeRef.current));
        await beat.play().catch(() => undefined);
      } catch {
        /* ignore */
      }
    }

    if (!wantBeat && !vocalPlaySucceeded) {
      setLoadError(
        vocalPlayError
          ? `Could not play take (${vocalPlayError})`
          : "Could not play your take — tap Play again"
      );
      writeReviewDiagnostics({
        event: "VOCAL_PLAY_ERROR",
        vocalPlaySucceeded: false,
        vocalPlayError,
      });
      setPlaying(false);
      playingRef.current = false;
      return;
    }

    if (wantBeat && !beatPlaySucceeded) {
      // Keep the vocal playing — do not abort the whole Review session.
      hardStopBeat();
      writeReviewDiagnostics({ event: "BEAT_PLAY_ERROR_CONTINUE_VOCAL", beatPlayError });
    }

    // Transport is live from the user gesture
    setPlaying(true);
    playingRef.current = true;
    pausedSongMsRef.current = null;
    syncNudgedRef.current = false;

    let beatSeekAppliedMs: number | null = null;
    let beatSeekOk = false;

    // Avoid post-play seek when already near target — re-seeking a playing element
    // was introducing ~150–200ms start lag between beat and take (see PRE-CHORUS diag).
    if (wantBeat && beat && beatPlaySucceeded) {
      try {
        beat.muted = false;
        void ensureBeatGuideGain(beat, reviewBeatGain(beatVolumeRef.current));
      } catch {
        /* ignore */
      }
      // Prefer free-run: only one short seek if still far from placement
      const alignedTarget = Math.max(0, place / 1000 + REVIEW_BEAT_DELAY_SEC);
      const off = Math.abs(beat.currentTime - alignedTarget);
      if (off > 1.5) {
        seekPendingRef.current = true;
        scheduleBeatSeek(beat, alignedTarget, (appliedSec, ok) => {
          beatSeekAppliedMs = appliedSec * 1000;
          beatSeekOk = ok;
          seekPendingRef.current = false;
          try {
            if (beatRef.current) {
              beatRef.current.muted = false;
              void ensureBeatGuideGain(beatRef.current, reviewBeatGain(beatVolumeRef.current));
              beatRef.current.playbackRate = 1;
            }
          } catch {
            /* ignore */
          }
          lastBeatClockRef.current = {
            t: beatRef.current?.currentTime ?? appliedSec,
            at: Date.now(),
          };
          writeReviewDiagnostics({
            event: "beat_seek_result",
            placementStartMs: place,
            beatSeekRequestedMs: Math.round(alignedTarget * 1000),
            beatSeekAppliedMs,
            beatSeekOk: ok,
            seekPending: false,
            vocalPaused: vocalRef.current?.paused ?? null,
            beatPaused: beatRef.current?.paused ?? null,
            playing: playingRef.current,
          });
        });
      } else {
        seekPendingRef.current = false;
        beatSeekOk = true;
        beatSeekAppliedMs = beat.currentTime * 1000;
        lastBeatClockRef.current = { t: beat.currentTime, at: Date.now() };
      }
    } else {
      seekPendingRef.current = false;
    }

    writeReviewDiagnostics({
      event: "play_attempt",
      reviewMode: wantBeat ? "beat_plus_voice" : "voice_only",
      vocalPlaySucceeded,
      vocalPlayError,
      beatPlaySucceeded,
      beatPlayError,
      placementStartMs: place,
      songMs,
      beatSeekRequestedMs: songMs,
      beatSeekAppliedMs,
      beatSeekOk,
      seekPending: seekPendingRef.current,
      startAtPlacement,
      vocalEngaged: vocalEngagedRef.current,
      vocalPaused: vocal.paused,
      vocalMuted: vocal.muted,
      vocalVolume: vocal.volume,
      vocalCurrentTime: vocal.currentTime,
      beatCurrentTimeMs: beat ? beat.currentTime * 1000 : null,
      beatPaused: beat?.paused ?? null,
      beatVolume: beat?.volume ?? null,
      playing: true,
      progressSource: wantBeat ? "beat_master_after_seek" : "vocal_element",
      isBlobUrl,
      vocalSrc,
    });

    const DRIFT_TOLERANCE_SEC = 0.12;
    const tick = () => {
      const v = vocalRef.current;
      const b = beatRef.current;
      if (!v) return;

      const placeNow = placementRef.current;
      const placeSecNow = placeNow / 1000;
      const vo = voiceOnlyRef.current;
      const bv = beatVolumeRef.current;
      const want = Boolean(beatSrc && !vo);

      // Voice Only
      if (vo || bv <= 0.001) {
        if (b && !b.paused) hardStopBeat();
        try {
          if (v.muted) v.muted = false;
          if (v.volume !== 1) v.volume = 1;
        } catch {
          /* ignore */
        }
        if (v.duration && Number.isFinite(v.duration) && v.duration > 0) {
          setProgress(Math.min(1, v.currentTime / v.duration));
        }
        if (!v.paused) {
          rafRef.current = requestAnimationFrame(tick);
        } else if (playingRef.current) {
          setPlaying(false);
          playingRef.current = false;
        }
        return;
      }

      // Beat + Voice — free-run after initial seek (no re-seek / no vocal snap loop)
      if (want && b) {
        try {
          // ALWAYS clamp beat via Web Audio GainNode (iOS ignores element.volume)
          const g = reviewBeatGain(bv);
          void ensureReviewWebAudio({
            vocal: v,
            beat: b,
            beatLinear: g,
            vocalLinear: 1,
          });
          if (v.muted) v.muted = false;
          if (v.volume !== 1) v.volume = 1;
          // If vocal was ducked when beat connected, nudge it back
          if (v.paused && playingRef.current) {
            void v.play().catch(() => undefined);
          }
        } catch {
          /* ignore */
        }

        // Free-run after start — NEVER seek beat here (device logs: currentTime froze at placement).
        try {
          if (b.playbackRate !== 1) b.playbackRate = 1;
        } catch {
          /* ignore */
        }

        // Soft freeze recovery only — never hardStop the guide bed (that left Review silent).
        // Mobile often reports a stuck currentTime after mid-track seek while audio still flows.
        const now = Date.now();
        const bt = b.currentTime;
        const clock = lastBeatClockRef.current;
        if (!b.paused) {
          if (clock.t >= 0 && Math.abs(bt - clock.t) < 0.03 && now - clock.at > 1200) {
            if (beatFreezeRecoveriesRef.current < 2) {
              beatFreezeRecoveriesRef.current += 1;
              try {
                void b.play().catch(() => undefined);
                b.playbackRate = 1;
                void ensureBeatGuideGain(b, reviewBeatGain(bv));
              } catch {
                /* ignore */
              }
              lastBeatClockRef.current = { t: b.currentTime, at: now };
              writeReviewDiagnostics({
                event: "beat_freeze_recovery",
                beatCurrentTimeMs: Math.round(b.currentTime * 1000),
                vocalCurrentTimeMs: Math.round(v.currentTime * 1000),
                recoveryAttempt: beatFreezeRecoveriesRef.current,
              });
            } else {
              // Leave bed running; just stop spamming play()
              lastBeatClockRef.current = { t: bt, at: now };
              writeReviewDiagnostics({
                event: "beat_freeze_observed",
                beatCurrentTimeMs: Math.round(bt * 1000),
                vocalCurrentTimeMs: Math.round(v.currentTime * 1000),
              });
            }
          } else if (bt > clock.t + 0.05) {
            lastBeatClockRef.current = { t: bt, at: now };
          } else if (clock.t < 0) {
            lastBeatClockRef.current = { t: bt, at: now };
          }
        } else if (playingRef.current && !v.paused) {
          // Beat paused while vocal still running — nudge play once (do not mute)
          if (beatFreezeRecoveriesRef.current < 2) {
            beatFreezeRecoveriesRef.current += 1;
            try {
              void ensureBeatGuideGain(b, reviewBeatGain(bv));
              void b.play().catch(() => undefined);
            } catch {
              /* ignore */
            }
            writeReviewDiagnostics({
              event: "beat_paused_nudge",
              recoveryAttempt: beatFreezeRecoveriesRef.current,
            });
          }
        }

        // Progress from the take only — never rewrite vocal.currentTime from the beat
        try {
          const dur =
            v.duration && Number.isFinite(v.duration) && v.duration > 0 ? v.duration : null;
          if (dur && !v.paused) {
            setProgress(Math.min(1, v.currentTime / dur));
          }
        } catch {
          /* ignore */
        }
        if (now - lastReseekAtRef.current > 500) {
          lastReseekAtRef.current = now;
          writeReviewDiagnostics({ event: "playing_sample" });
        }

        const beatMs = b.currentTime * 1000;
        if (beatEndMs != null && beatMs >= beatEndMs) {
          try {
            b.pause();
            if (!v.paused) v.pause();
          } catch {
            /* ignore */
          }
        }
      }

      if (!v.paused || (b && !b.paused)) {
        rafRef.current = requestAnimationFrame(tick);
      } else if (playingRef.current) {
        setPlaying(false);
        playingRef.current = false;
        seekPendingRef.current = false;
      }
    };
    rafRef.current = requestAnimationFrame(tick);
  }

  useEffect(() => {
    const vocal = vocalRef.current;
    if (!vocal) return;
    const onEnd = () => {
      hardStopBeat();
      stopRaf();
      setPlaying(false);
      playingRef.current = false;
      setProgress(1);
      pausedSongMsRef.current = null;
      writeReviewDiagnostics({ event: "ended" });
    };
    const onError = () => {
      writeReviewDiagnostics({
        event: "vocal_element_error",
        vocalErrorCode: vocal.error?.code ?? null,
        vocalErrorMessage: vocal.error ? mediaErrorLabel(vocal.error.code) : null,
        vocalReadyState: vocal.readyState,
        vocalNetworkState: vocal.networkState,
      });
    };
    const onPause = () => {
      vocalPauseCountRef.current += 1;
      lastVocalPauseReasonRef.current = "element_pause_event";
      writeReviewDiagnostics({
        event: "vocal_pause_event",
        vocalPauseCount: vocalPauseCountRef.current,
        vocalCurrentTime: vocal.currentTime,
        vocalPaused: vocal.paused,
      });
    };
    const onPlay = () => {
      writeReviewDiagnostics({ event: "vocal_play_event", vocalCurrentTime: vocal.currentTime });
    };
    const onPlaying = () => {
      writeReviewDiagnostics({ event: "vocal_playing_event", vocalCurrentTime: vocal.currentTime });
    };
    vocal.addEventListener("ended", onEnd);
    vocal.addEventListener("error", onError);
    vocal.addEventListener("pause", onPause);
    vocal.addEventListener("play", onPlay);
    vocal.addEventListener("playing", onPlaying);
    return () => {
      vocal.removeEventListener("ended", onEnd);
      vocal.removeEventListener("error", onError);
      vocal.removeEventListener("pause", onPause);
      vocal.removeEventListener("play", onPlay);
      vocal.removeEventListener("playing", onPlaying);
    };
  }, [hardStopBeat, src]);



  const modeHint = voiceOnly ? "voice only" : "beat + voice";

  return (
    <div
      style={{
        marginTop: 10,
        padding: 12,
        borderRadius: 14,
        border: `1px solid ${C.border}`,
        background: C.surface,
        boxShadow: C.cardShadow,
      }}
    >
      <audio ref={vocalRef} src={src} preload="auto" playsInline />
      {beatSrc ? <audio ref={beatRef} src={beatSrc} preload="auto" playsInline /> : null}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 6 }}>
            {label || "Take"}
            <span style={{ marginLeft: 8, opacity: 0.7 }}>{modeHint}</span>
          </div>
          <Waveform bars={bars} progress={progress} height={28} />
          {loadError && (
            <div style={{ fontSize: 12, color: C.danger, marginTop: 6 }}>{loadError}</div>
          )}
        </div>
        <button
          type="button"
          onClick={() => void toggle()}
          aria-label={playing ? "Pause" : "Play"}
          style={{
            width: 40,
            height: 40,
            borderRadius: 999,
            border: `1px solid ${C.border}`,
            background: C.inputFill,
            color: C.text,
            display: "grid",
            placeItems: "center",
            cursor: "pointer",
            padding: 0,
          }}
        >
          {playing ? <PauseIcon size={18} /> : <PlayIcon size={18} />}
        </button>
      </div>

      
    </div>
  );
}
