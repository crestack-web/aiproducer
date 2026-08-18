"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

export function CoverArt({ seed, size = 64 }: { seed: string; size?: number }) {
  const C = usePlayerColors();
  const [a, b] = coverGradientFor(seed);
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 14,
        flexShrink: 0,
        background: `linear-gradient(145deg, ${a}, ${b})`,
        boxShadow: C.cardShadow,
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "radial-gradient(circle at 30% 20%, rgba(255,255,255,0.14), transparent 60%)",
        }}
      />
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
  beatVolume = 0.10,
  vocalVolume = 1,
}: {
  src: string;
  label?: string;
  seed?: string;
  beatSrc?: string | null;
  beatStartMs?: number;
  beatEndMs?: number | null;
  beatVolume?: number;
  vocalVolume?: number;
}) {
  const C = usePlayerColors();
  const vocalRef = useRef<HTMLAudioElement | null>(null);
  const beatRef = useRef<HTMLAudioElement | null>(null);
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
  voiceOnlyRef.current = voiceOnly;
  beatVolumeRef.current = beatVolume;
  vocalVolumeRef.current = vocalVolume;
  playingRef.current = playing;
  placementRef.current = placementStartMs;
  /** Review mix: vocal at 1.0; reference beat ≈0.10 so vocal is clearly dominant. */
  /** Reference beat under the vocal — audible context, never dominant. */
  const reviewBeatGain = (v: number) => (v <= 0.001 ? 0 : 0.06);

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
    } catch {
      /* ignore */
    }
  }, []);

  function vocalFileTimeFromSongMs(songMs: number, placeMs: number): number {
    return (songMs - placeMs) / 1000;
  }

  /**
   * Force HTMLAudioElement to a song position. iOS often ignores currentTime until
   * after play() and may need seeked + retries. Returns applied time in seconds.
   */
  async function forceSeekBeat(
    el: HTMLAudioElement,
    targetSec: number,
    attempts = 5
  ): Promise<{ appliedSec: number; ok: boolean; samples: number[] }> {
    const target = Math.max(0, targetSec);
    const samples: number[] = [];
    for (let i = 0; i < attempts; i++) {
      try {
        el.currentTime = target;
      } catch {
        /* ignore */
      }
      await new Promise<void>((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          el.removeEventListener("seeked", onSeeked);
          el.removeEventListener("timeupdate", onTu);
          clearTimeout(timer);
          resolve();
        };
        const onSeeked = () => finish();
        const onTu = () => {
          if (Math.abs(el.currentTime - target) < 0.6) finish();
        };
        el.addEventListener("seeked", onSeeked);
        el.addEventListener("timeupdate", onTu);
        const timer = setTimeout(finish, 180);
      });
      samples.push(el.currentTime);
      if (Math.abs(el.currentTime - target) < 0.75) {
        return { appliedSec: el.currentTime, ok: true, samples };
      }
    }
    return { appliedSec: el.currentTime, ok: Math.abs(el.currentTime - target) < 1.5, samples };
  }

  function writeReviewDiagnostics(extra: Record<string, unknown> = {}) {
    try {
      if (typeof window === "undefined" || localStorage.getItem("studio_debug_audio") !== "1") return;
      const vocal = vocalRef.current;
      const beat = beatRef.current;
      sessionStorage.setItem(
        "studio_last_review_diagnostics",
        JSON.stringify({
          mode: voiceOnlyRef.current ? "voice_only" : "beat_plus_voice",
          vocalSrcPresent: Boolean(vocal?.src || src),
          vocalReadyState: vocal?.readyState ?? null,
          vocalNetworkState: vocal?.networkState ?? null,
          vocalPaused: vocal?.paused ?? null,
          vocalMuted: vocal?.muted ?? null,
          vocalVolume: vocal?.volume ?? null,
          vocalCurrentTime: vocal?.currentTime ?? null,
          vocalPlaybackRate: vocal?.playbackRate ?? null,
          beatSrcPresent: Boolean(beat?.src || beatSrc),
          beatReadyState: beat?.readyState ?? null,
          beatPaused: beat?.paused ?? null,
          beatMuted: beat?.muted ?? null,
          beatVolume: beat?.volume ?? null,
          beatCurrentTime: beat?.currentTime ?? null,
          beatPlaybackRate: beat?.playbackRate ?? null,
          activeReviewBeatSources:
            beat && !beat.paused && !voiceOnlyRef.current && (beat.volume ?? 0) > 0.001 ? 1 : 0,
          placementStartMs: placementRef.current,
          reviewStartedAt: Date.now(),
          ...extra,
        })
      );
    } catch {
      /* ignore */
    }
  }

  // Reset transport when take / placement changes
  useEffect(() => {
    stopRaf();
    setPlaying(false);
    playingRef.current = false;
    setProgress(0);
    setLoadError(null);
    pausedSongMsRef.current = null;
    const vocal = vocalRef.current;
    if (vocal) {
      try {
        vocal.pause();
        vocal.currentTime = 0;
        vocal.playbackRate = 1;
        vocal.muted = false;
        vocal.volume = Math.min(1, Math.max(0, vocalVolumeRef.current));
      } catch {
        /* ignore */
      }
    }
    const beat = beatRef.current;
    if (beat) {
      try {
        beat.pause();
        beat.playbackRate = 1;
        beat.currentTime = placementStartMs / 1000;
        if (voiceOnlyRef.current) {
          beat.volume = 0;
          beat.muted = true;
        } else {
          beat.muted = false;
          beat.volume = reviewBeatGain(beatVolumeRef.current);
        }
        vocalEngagedRef.current = false;
        vocalStartedAtBeatMsRef.current = null;
      } catch {
        /* ignore */
      }
    }
  }, [src, placementStartMs]);

  useEffect(() => {
    return () => {
      stopRaf();
      vocalRef.current?.pause();
      hardStopBeat();
    };
  }, [hardStopBeat]);

  /**
   * Mode transitions (Voice Only ↔ Beat + Voice).
   * Must fully reverse hardStopBeat state when leaving Voice Only.
   * Do NOT call play() here — iOS requires a user gesture; pause so the
   * next Play tap starts both sources cleanly from that gesture.
   */
  useEffect(() => {
    const beat = beatRef.current;
    const vocal = vocalRef.current;
    if (voiceOnly) {
      hardStopBeat();
      // Keep vocal state usable for Voice Only play
      if (vocal) {
        try {
          vocal.muted = false;
          vocal.volume = Math.min(1, Math.max(0, vocalVolume));
          vocal.playbackRate = 1;
        } catch {
          /* ignore */
        }
      }
      return;
    }
    // Leaving Voice Only → restore beat element (still paused until Play)
    if (beat) {
      try {
        beat.muted = false;
        beat.playbackRate = 1;
        beat.volume = reviewBeatGain(beatVolume);
      } catch {
        /* ignore */
      }
    }
    if (vocal) {
      try {
        vocal.muted = false;
        vocal.volume = Math.min(1, Math.max(0, vocalVolume));
        vocal.playbackRate = 1;
      } catch {
        /* ignore */
      }
    }
    vocalEngagedRef.current = false;
    vocalStartedAtBeatMsRef.current = null;
    // If we were mid-playback under the other mode, stop so next Play is a fresh gesture
    if (playingRef.current) {
      stopRaf();
      try {
        vocal?.pause();
        beat?.pause();
      } catch {
        /* ignore */
      }
      setPlaying(false);
      playingRef.current = false;
    }
    writeReviewDiagnostics({ event: "mode_to_beat_plus_voice" });
  }, [voiceOnly, beatVolume, vocalVolume, hardStopBeat]);

  /**
   * Soft readiness for Review takes (often blob: URLs on iOS).
   * HAVE_METADATA (1) is enough to attempt play — do NOT require HAVE_CURRENT_DATA (2).
   * Never call load() on an element that already has a src and is progressing —
   * load() resets and is a common cause of "Could not load your take" on Safari.
   */
  async function ensureReady(el: HTMLAudioElement, ms = 8000): Promise<{
    ok: boolean;
    readyState: number;
    errorCode: number | null;
    errorMessage: string | null;
  }> {
    const snap = () => ({
      ok: el.readyState >= 1 || (Number.isFinite(el.duration) && el.duration > 0),
      readyState: el.readyState,
      errorCode: el.error?.code ?? null,
      errorMessage: el.error?.message ?? null,
    });

    // Already have metadata or current data — good to try play()
    if (el.readyState >= 1) return { ...snap(), ok: true };
    if (el.error) return { ...snap(), ok: false };

    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        el.removeEventListener("loadedmetadata", onOk);
        el.removeEventListener("loadeddata", onOk);
        el.removeEventListener("canplay", onOk);
        el.removeEventListener("error", onErr);
        clearTimeout(timer);
        const s = snap();
        // Soft pass: metadata OR non-zero duration OR readyState>=1
        const ok =
          !el.error &&
          (s.readyState >= 1 ||
            (Number.isFinite(el.duration) && el.duration > 0) ||
            s.readyState >= 2);
        resolve({ ...s, ok });
      };
      const onOk = () => finish();
      const onErr = () => finish();
      const timer = setTimeout(finish, ms);
      el.addEventListener("loadedmetadata", onOk);
      el.addEventListener("loadeddata", onOk);
      el.addEventListener("canplay", onOk);
      el.addEventListener("error", onErr);
      // Do NOT call el.load() here — React already set src with preload="auto".
      // Calling load() on iOS blob URLs frequently clears buffered state mid-Review.
    });
  }

  function mediaErrorLabel(code: number | null | undefined): string {
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
        return code != null ? `MEDIA_ERR_${code}` : "none";
    }
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
        beat && beatSrc && !voiceOnlyRef.current && !beat.paused
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
      setPlaying(false);
      playingRef.current = false;
      writeReviewDiagnostics({ event: "pause" });
      return;
    }

    setLoadError(null);
    const place = placementRef.current;
    const songMs = pausedSongMsRef.current != null ? pausedSongMsRef.current : place;
    const wantBeat = Boolean(beatSrc && !voiceOnlyRef.current);
    const beat = beatRef.current;

    const vocalSrc = (vocal.currentSrc || vocal.src || src || "").slice(0, 96);
    const isBlobUrl = /^blob:/i.test(vocal.currentSrc || vocal.src || src || "");

    writeReviewDiagnostics({
      event: "play_start",
      vocalSrc,
      vocalSrcType: isBlobUrl ? "blob" : "url",
      vocalSrcLength: (vocal.currentSrc || vocal.src || src || "").length,
      isBlobUrl,
      vocalReadyState: vocal.readyState,
      vocalNetworkState: vocal.networkState,
      vocalErrorCode: vocal.error?.code ?? null,
      vocalErrorMessage: vocal.error ? mediaErrorLabel(vocal.error.code) : null,
      vocalDuration: Number.isFinite(vocal.duration) ? vocal.duration : null,
      vocalMuted: vocal.muted,
      vocalVolume: vocal.volume,
      vocalPaused: vocal.paused,
    });

    // Prepare vocal properties (primary source — independent of beat)
    try {
      vocal.muted = false;
      vocal.volume = Math.min(1, Math.max(0, vocalVolumeRef.current));
      vocal.playbackRate = 1;
    } catch {
      /* ignore */
    }

    if (wantBeat && beat) {
      try {
        beat.muted = false;
        beat.volume = reviewBeatGain(beatVolumeRef.current);
        beat.playbackRate = 1;
      } catch {
        /* ignore */
      }
    } else {
      hardStopBeat();
    }

    // Soft wait for vocal ONLY — never block vocal success on beat readiness
    let vocalReady = vocal.readyState >= 1;
    let vocalReadyMeta = {
      ok: vocalReady,
      readyState: vocal.readyState,
      errorCode: vocal.error?.code ?? null,
      errorMessage: vocal.error?.message ?? null,
    };
    if (!vocalReady && vocal.readyState === 0 && !vocal.error) {
      // Short wait only — avoid long awaits that drop iOS user-gesture for play()
      vocalReadyMeta = await ensureReady(vocal, 2000);
      vocalReady = vocalReadyMeta.ok;
    }

    writeReviewDiagnostics({
      event: "vocal_ready_check",
      vocalLoadAttempted: true,
      vocalLoadSucceeded: vocalReady,
      vocalReadyState: vocalReadyMeta.readyState,
      vocalErrorCode: vocalReadyMeta.errorCode,
      vocalErrorMessage: vocalReadyMeta.errorCode
        ? mediaErrorLabel(vocalReadyMeta.errorCode)
        : vocalReadyMeta.errorMessage,
      vocalDuration: Number.isFinite(vocal.duration) ? vocal.duration : null,
      isBlobUrl,
      vocalSrc,
    });

    // If still not ready, attempt play() anyway — Safari sometimes plays blob at readyState 0/1
    // Only hard-fail when MediaError is set
    if (vocal.error) {
      const label = mediaErrorLabel(vocal.error.code);
      setLoadError(`Could not load your take (${label})`);
      writeReviewDiagnostics({
        event: "VOCAL_LOAD_ERROR",
        vocalLoadSucceeded: false,
        vocalErrorCode: vocal.error.code,
        vocalErrorMessage: label,
        isBlobUrl,
        vocalSrc,
      });
      return;
    }

    // Seek after readiness when possible (seeking before metadata breaks iOS blobs)
    try {
      if (wantBeat && beat && beat.readyState >= 1) {
        const bt = Math.max(0, songMs / 1000);
        if (Math.abs(beat.currentTime - bt) > 0.05) beat.currentTime = bt;
      }
      if (vocal.readyState >= 1) {
        const vt = Math.max(0, vocalFileTimeFromSongMs(songMs, place));
        if (Math.abs(vocal.currentTime - vt) > 0.05) vocal.currentTime = vt;
      }
    } catch {
      /* ignore */
    }

    // Do not await beat readiness here — keeps play() inside the user-gesture chain.
    // Beat load failure is handled after play attempts below.

    let vocalPlaySucceeded = false;
    let beatPlaySucceeded = false;
    let vocalPlayError: string | null = null;
    let beatPlayError: string | null = null;

    // Intentional review song clock (usually placementStartMs on first Play)
    const startAtOrAfterPlacement = songMs + 50 >= place;
    const beatSeekTargetSec = Math.max(0, songMs / 1000);
    let beatSeekAppliedMs: number | null = null;
    let beatSeekOk = false;
    const beatTimelineSamples: number[] = [];

    // Prepare properties in the same gesture turn (seek will be confirmed after play on iOS)
    try {
      if (wantBeat && beat) {
        beat.muted = false;
        beat.volume = reviewBeatGain(beatVolumeRef.current);
        beat.playbackRate = 1;
        try {
          beat.currentTime = beatSeekTargetSec;
        } catch {
          /* ignore */
        }
      }
      const vt0 = Math.max(0, vocalFileTimeFromSongMs(songMs, place));
      try {
        if (vocal.readyState >= 1) vocal.currentTime = vt0;
      } catch {
        /* ignore */
      }
      vocal.muted = false;
      vocal.volume = 1;
      vocal.playbackRate = 1;
    } catch {
      /* ignore */
    }

    /**
     * Fire both play() immediately from the user gesture (native elements only).
     * Then force-confirm beat seek to placement — iOS often only applies currentTime
     * after playback has started.
     */
    const vocalPlayPromise = vocal.play().then(
      () => {
        vocalPlaySucceeded = true;
      },
      (e: unknown) => {
        vocalPlayError =
          e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      }
    );

    let beatPlayPromise: Promise<void> = Promise.resolve();
    if (wantBeat && beat) {
      beatPlayPromise = beat.play().then(
        () => {
          beatPlaySucceeded = true;
        },
        (e: unknown) => {
          beatPlayError =
            e instanceof Error ? `${e.name}: ${e.message}` : String(e);
        }
      );
    } else {
      hardStopBeat();
    }

    await Promise.all([vocalPlayPromise, beatPlayPromise]);

    // CRITICAL: confirm beat is at placementStartMs / songMs — not song start (0)
    if (wantBeat && beat && beatPlaySucceeded) {
      const seekResult = await forceSeekBeat(beat, beatSeekTargetSec, 6);
      beatSeekAppliedMs = seekResult.appliedSec * 1000;
      beatSeekOk = seekResult.ok;
      beatTimelineSamples.push(...seekResult.samples.map((s) => Math.round(s * 1000)));
      try {
        beat.muted = false;
        beat.volume = reviewBeatGain(beatVolumeRef.current);
        beat.playbackRate = 1;
        // If still wrong, one more hard assign
        if (Math.abs(beat.currentTime - beatSeekTargetSec) > 0.75) {
          beat.currentTime = beatSeekTargetSec;
          beatSeekAppliedMs = beat.currentTime * 1000;
        }
      } catch {
        /* ignore */
      }
      // Sample timeline for diagnostics (~250ms × 12 ≈ 3s) without blocking UI long
      void (async () => {
        for (let i = 0; i < 12; i++) {
          await new Promise((r) => setTimeout(r, 250));
          const b = beatRef.current;
          if (!b || b.paused) break;
          beatTimelineSamples.push(Math.round(b.currentTime * 1000));
          try {
            if (
              typeof window !== "undefined" &&
              localStorage.getItem("studio_debug_audio") === "1"
            ) {
              sessionStorage.setItem(
                "studio_last_review_diagnostics",
                JSON.stringify({
                  event: "beat_timeline_sample",
                  placementStartMs: place,
                  beatSeekRequestedMs: songMs,
                  beatSeekAppliedMs,
                  beatSeekOk,
                  beatCurrentTimeMs: b.currentTime * 1000,
                  beatTimelineMs: beatTimelineSamples.slice(-20),
                  at: Date.now(),
                })
              );
            }
          } catch {
            /* ignore */
          }
          // Re-assert if iOS drifted back near 0 while placement is far later
          if (
            place > 2000 &&
            b.currentTime * 1000 < place * 0.25 &&
            Math.abs(b.currentTime - beatSeekTargetSec) > 1
          ) {
            try {
              b.currentTime = beatSeekTargetSec + i * 0.25;
            } catch {
              /* ignore */
            }
          }
        }
      })();
    }

    // Placement engagement decision based on *intent* (songMs), not flaky currentTime
    if (wantBeat && beat) {
      if (startAtOrAfterPlacement) {
        // Started at/after section — vocal MUST stay playing
        try {
          vocal.muted = false;
          vocal.volume = 1;
          if (vocal.paused) {
            await vocal.play().catch((e: unknown) => {
              vocalPlayError =
                e instanceof Error ? `${e.name}: ${e.message}` : String(e);
              vocalPlaySucceeded = false;
            });
            if (!vocal.paused) vocalPlaySucceeded = true;
          }
          vocalEngagedRef.current = true;
          vocalStartedAtBeatMsRef.current = Math.max(place, songMs);
        } catch {
          /* ignore */
        }
      } else {
        // Intentional pre-roll before section — keep vocal silent until RAF crosses placement
        try {
          vocal.pause();
          vocal.currentTime = 0;
          vocalEngagedRef.current = false;
          lastVocalPauseReasonRef.current = "intentional_pre_placement";
        } catch {
          /* ignore */
        }
      }
    } else {
      // Voice Only
      vocalEngagedRef.current = true;
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
      beatTimelineMs: beatTimelineSamples.slice(0, 12),
      startAtOrAfterPlacement,
      beatCurrentTimeMs: beat ? beat.currentTime * 1000 : null,
      expectedVocalTimeMs: beat
        ? beat.currentTime * 1000 - place
        : vocal.currentTime * 1000,
      vocalEngaged: vocalEngagedRef.current,
      vocalPaused: vocal.paused,
      vocalMuted: vocal.muted,
      vocalVolume: vocal.volume,
      vocalReadyState: vocal.readyState,
      vocalNetworkState: vocal.networkState,
      vocalDuration: Number.isFinite(vocal.duration) ? vocal.duration : null,
      vocalCurrentTime: vocal.currentTime,
      beatPaused: beat?.paused ?? null,
      beatMuted: beat?.muted ?? null,
      beatVolume: beat?.volume ?? null,
      beatReadyState: beat?.readyState ?? null,
      activeReviewBeatSources:
        beat && !beat.paused && (beat.volume ?? 0) > 0.001 ? 1 : 0,
      progressSource: wantBeat ? 'beat_master_clock' : 'vocal_element',
      isBlobUrl,
      vocalSrc,
    });

    // Voice Only requires vocal play success
    if (!wantBeat && !vocalPlaySucceeded) {
      const blocked =
        vocalPlayError &&
        /notallowed|interact|user.?gesture|gesture/i.test(vocalPlayError);
      setLoadError(
        blocked
          ? "Playback blocked — tap Play again"
          : vocalPlayError
            ? `Could not play take (${vocalPlayError})`
            : "Could not play your take — tap Play again"
      );
      writeReviewDiagnostics({
        event: blocked ? "AUTOPLAY_BLOCKED" : "VOCAL_PLAY_ERROR",
        vocalPlaySucceeded: false,
        vocalPlayError,
      });
      setPlaying(false);
      playingRef.current = false;
      return;
    }

    // Beat + Voice: beat must start; vocal may be gated only for intentional pre-roll
    if (wantBeat && !beatPlaySucceeded) {
      setLoadError(
        beatPlayError
          ? `Could not play reference beat (${beatPlayError})`
          : "Could not play reference beat — tap Play again"
      );
      try {
        vocal.pause();
      } catch {
        /* ignore */
      }
      writeReviewDiagnostics({ event: "BEAT_PLAY_ERROR", beatPlayError });
      setPlaying(false);
      playingRef.current = false;
      return;
    }

    // If we intended vocal at placement and it is still paused, surface that clearly
    if (wantBeat && startAtOrAfterPlacement && vocal.paused) {
      writeReviewDiagnostics({
        event: "VOCAL_STILL_PAUSED_AFTER_ENGAGE",
        vocalPlaySucceeded,
        vocalPlayError,
        vocalReadyState: vocal.readyState,
      });
      // Last-chance play still inside this call stack
      try {
        await vocal.play();
        vocalPlaySucceeded = true;
        vocalEngagedRef.current = true;
      } catch (e) {
        vocalPlayError =
          e instanceof Error ? `${e.name}: ${e.message}` : String(e);
        setLoadError(`Vocal did not start (${vocalPlayError})`);
        hardStopBeat();
        setPlaying(false);
        playingRef.current = false;
        return;
      }
    }

    try {
      if (!wantBeat) {
        vocal.muted = false;
        vocal.volume = 1;
      }
      if (wantBeat && beat && !beat.paused) {
        beat.muted = false;
        beat.volume = reviewBeatGain(beatVolumeRef.current);
      }
    } catch {
      /* ignore */
    }

    setPlaying(true);
    playingRef.current = true;
    pausedSongMsRef.current = null;
    alignedRef.current = true;
    // Do NOT clear vocalEngagedRef here — set above based on startAtOrAfterPlacement
    vocalPauseCountRef.current = 0;
    vocalSeekCountRef.current = 0;
    vocalCorrectionCountRef.current = 0;
    lastVocalPauseReasonRef.current = null;
    lastVocalSeekTargetRef.current = null;
    driftSamplesRef.current = { sum: 0, n: 0, max: 0 };

    const placeMs = place;
    const placeSec = placeMs / 1000;
    const startSongMs = songMs;

    // Re-assert beat seek once more after transport starts (iOS)
    if (wantBeat && beat && beatPlaySucceeded) {
      try {
        const target = Math.max(0, songMs / 1000);
        if (Math.abs(beat.currentTime - target) > 0.35) {
          beat.currentTime = target;
        }
      } catch {
        /* ignore */
      }
    }

    const DRIFT_TOLERANCE_SEC = 0.08; // 80ms — correct only real drift, not every frame
    let lastGateState: "before" | "after" | null = null;

    const tick = () => {
      const v = vocalRef.current;
      const b = beatRef.current;
      if (!v) return;

      const placeNow = placementRef.current;
      const placeSecNow = placeNow / 1000;
      const vo = voiceOnlyRef.current;
      const bv = beatVolumeRef.current;
      const want = Boolean(beatSrc && !vo);
      const nosync = noSyncCorrections();

      // Voice Only: keep beat dead
      if (vo || bv <= 0.001) {
        if (b && !b.paused) hardStopBeat();
        try {
          if (v.muted) v.muted = false;
          if (v.volume !== 1) v.volume = 1;
        } catch {
          /* ignore */
        }
        if (v.duration) setProgress(v.currentTime / v.duration);
        if (!v.paused) {
          rafRef.current = requestAnimationFrame(tick);
        } else if (playingRef.current) {
          setPlaying(false);
          playingRef.current = false;
        }
        return;
      }

      // Beat + Voice
      if (want && b) {
        // Keep beat audible at review gain
        try {
          if (b.muted) b.muted = false;
          const g = reviewBeatGain(bv);
          if (Math.abs(b.volume - g) > 0.01) b.volume = g;
          if (b.playbackRate !== 1) b.playbackRate = 1;
        } catch {
          /* ignore */
        }

        if (!b.paused) {
          const beatMs = b.currentTime * 1000;
          const expectedVocalSec = (beatMs - placeNow) / 1000;

          // If vocal already engaged this session, NEVER re-enter "before" pause —
          // beat.currentTime can lag behind placement after iOS seeks and would
          // permanently silence the take (RAF play is not a user gesture).
          if (vocalEngagedRef.current) {
            lastGateState = "after";
            if (beatMs + 30 < placeNow) {
              // Beat is behind placement (seek failed / reset to 0) — force song clock
              if (!nosync) {
                try {
                  const repairSec = Math.max(
                    0,
                    placeSecNow + Math.max(0, v.currentTime)
                  );
                  // Always re-seek when materially behind placement (iOS reset-to-0)
                  if (Math.abs(b.currentTime - repairSec) > 0.15) {
                    b.currentTime = repairSec;
                  }
                } catch {
                  /* ignore */
                }
              }
              if (v.paused) void v.play().catch(() => undefined);
            } else if (!nosync) {
              if (v.paused) void v.play().catch(() => undefined);
              const drift = Math.abs(v.currentTime - Math.max(0, expectedVocalSec));
              const ds = driftSamplesRef.current;
              ds.sum += drift * 1000;
              ds.n += 1;
              if (drift * 1000 > ds.max) ds.max = drift * 1000;
              if (drift > DRIFT_TOLERANCE_SEC) {
                try {
                  v.currentTime = Math.max(0, expectedVocalSec);
                  vocalCorrectionCountRef.current += 1;
                  vocalSeekCountRef.current += 1;
                  lastVocalSeekTargetRef.current = Math.max(0, expectedVocalSec);
                } catch {
                  /* ignore */
                }
              }
            } else if (v.paused) {
              void v.play().catch(() => undefined);
            }
            try {
              if (v.muted) v.muted = false;
              if (v.volume !== 1) v.volume = 1;
              if (v.playbackRate !== 1) v.playbackRate = 1;
            } catch {
              /* ignore */
            }
          } else if (beatMs + 30 < placeNow) {
            // Not yet engaged AND beat truly before placement (intentional pre-roll)
            if (lastGateState !== "before") {
              lastGateState = "before";
              try {
                if (!v.paused) {
                  v.pause();
                  vocalPauseCountRef.current += 1;
                  lastVocalPauseReasonRef.current = "before_placement";
                }
                if (v.currentTime !== 0) v.currentTime = 0;
              } catch {
                /* ignore */
              }
            }
          } else {
            // First cross into placement — engage once
            lastGateState = "after";
            try {
              const vt = Math.max(0, expectedVocalSec);
              v.currentTime = vt;
              v.muted = false;
              v.volume = 1;
              v.playbackRate = 1;
              void v.play().catch(() => undefined);
              vocalEngagedRef.current = true;
              vocalStartedAtBeatMsRef.current = beatMs;
              vocalSeekCountRef.current += 1;
              lastVocalSeekTargetRef.current = vt;
            } catch {
              /* ignore */
            }
          }

          if (beatEndMs != null && beatMs >= beatEndMs) {
            try {
              b.pause();
              if (!v.paused) v.pause();
            } catch {
              /* ignore */
            }
          }
        }
      }

      // Progress from beat master clock (not a frozen vocal element)
      try {
        if (want && b && !b.paused) {
          const elapsedSec = Math.max(0, b.currentTime - placeSecNow);
          const dur =
            v.duration && Number.isFinite(v.duration) && v.duration > 0
              ? v.duration
              : null;
          if (dur) {
            setProgress(Math.min(1, elapsedSec / dur));
          } else {
            // Fallback: show motion from beat even without vocal duration
            setProgress(Math.min(1, (elapsedSec % 30) / 30));
          }
        } else if (v.duration && Number.isFinite(v.duration) && v.duration > 0) {
          setProgress(Math.min(1, v.currentTime / v.duration));
        }
      } catch {
        /* ignore */
      }

      // Diagnostics
      try {
        if (
          typeof window !== "undefined" &&
          localStorage.getItem("studio_debug_audio") === "1" &&
          b
        ) {
          const beatMs = b.currentTime * 1000;
          const expectedMs = beatMs - placeNow;
          const startDelta =
            vocalStartedAtBeatMsRef.current != null
              ? vocalStartedAtBeatMsRef.current - placeNow
              : null;
          const ds = driftSamplesRef.current;
          sessionStorage.setItem(
            "studio_last_review_diagnostics",
            JSON.stringify({
              event: "raf_tick",
              mode: "beat_plus_voice",
              placementStartMs: placeNow,
              beatCurrentTimeMs: beatMs,
              vocalCurrentTimeMs: v.currentTime * 1000,
              expectedVocalTimeMs: expectedMs,
              vocalEngaged: vocalEngagedRef.current,
              vocalStartedAtBeatMs: vocalStartedAtBeatMsRef.current,
              vocalStartDeltaMs: startDelta,
              vocalPaused: v.paused,
              vocalMuted: v.muted,
              vocalVolume: v.volume,
              beatPaused: b.paused,
              beatMuted: b.muted,
              beatVolume: b.volume,
              activeReviewBeatSources: !b.paused && b.volume > 0.001 ? 1 : 0,
              reviewVocalPlay: v.paused ? "paused" : "playing",
              reviewBeatPlay: b.paused ? "paused" : "playing",
              vocalReadyState: v.readyState,
              beatReadyState: b.readyState,
              vocalPauseCount: vocalPauseCountRef.current,
              vocalSeekCount: vocalSeekCountRef.current,
              vocalCorrectionCount: vocalCorrectionCountRef.current,
              lastVocalPauseReason: lastVocalPauseReasonRef.current,
              maxDriftMs: ds.max,
              averageDriftMs: ds.n ? ds.sum / ds.n : 0,
              at: Date.now(),
            })
          );
        }
      } catch {
        /* ignore */
      }

      if (!v.paused || (b && !b.paused)) {
        rafRef.current = requestAnimationFrame(tick);
      } else if (playingRef.current) {
        setPlaying(false);
        playingRef.current = false;
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    writeReviewDiagnostics({
      event: "playing",
      vocalPlaySucceeded: true,
      beatPlaySucceeded,
      beatPlayError,
      placementStartMs: placeMs,
      songMs: startSongMs,
      beatCurrentTimeAfterPlay: beat?.currentTime ?? null,
      vocalCurrentTimeAfterPlay: vocal.currentTime,
      vocalEngaged: vocalEngagedRef.current,
      reviewBeatVolume: reviewBeatGain(beatVolumeRef.current),
    });
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
