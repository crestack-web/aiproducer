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
  beatVolume = 0.18,
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
  voiceOnlyRef.current = voiceOnly;
  beatVolumeRef.current = beatVolume;
  vocalVolumeRef.current = vocalVolume;
  playingRef.current = playing;
  placementRef.current = placementStartMs;
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
          beat.volume = Math.min(1, Math.max(0, beatVolumeRef.current));
        }
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
        beat.volume = Math.min(1, Math.max(0, beatVolume));
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
        beat.volume = Math.min(1, Math.max(0, beatVolumeRef.current));
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
    if (!vocalReady) {
      vocalReadyMeta = await ensureReady(vocal, 8000);
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

    // Best-effort beat readiness — failure must NOT fail the vocal
    let beatReady = Boolean(beat && beat.readyState >= 1);
    if (wantBeat && beat && !beatReady) {
      const beatMeta = await ensureReady(beat, 5000);
      beatReady = beatMeta.ok;
      writeReviewDiagnostics({
        event: beatReady ? "beat_ready" : "BEAT_LOAD_ERROR",
        beatReadyState: beatMeta.readyState,
        beatErrorCode: beatMeta.errorCode,
        beatLoadSucceeded: beatReady,
      });
    }

    try {
      vocal.muted = false;
      vocal.volume = Math.min(1, Math.max(0, vocalVolumeRef.current));
      vocal.playbackRate = 1;
      if (wantBeat && beat && beatReady) {
        beat.muted = false;
        beat.volume = Math.min(1, Math.max(0, beatVolumeRef.current));
        beat.playbackRate = 1;
      }
    } catch {
      /* ignore */
    }

    let vocalPlaySucceeded = false;
    let beatPlaySucceeded = false;
    let vocalPlayError: string | null = null;
    let beatPlayError: string | null = null;

    const playJobs: Promise<void>[] = [];

    // Vocal is primary — always attempt
    playJobs.push(
      vocal
        .play()
        .then(() => {
          vocalPlaySucceeded = true;
        })
        .catch((e) => {
          vocalPlayError = e instanceof Error ? e.message : String(e);
        })
    );

    if (wantBeat && beat && beatReady) {
      playJobs.push(
        beat
          .play()
          .then(() => {
            beatPlaySucceeded = true;
          })
          .catch((e) => {
            beatPlayError = e instanceof Error ? e.message : String(e);
          })
      );
    }

    await Promise.all(playJobs);

    writeReviewDiagnostics({
      event: "play_attempt",
      vocalPlayAttempted: true,
      vocalPlaySucceeded,
      vocalPlayError,
      beatPlayAttempted: Boolean(wantBeat && beat && beatReady),
      beatPlaySucceeded,
      beatPlayError,
      vocalReadyState: vocal.readyState,
      vocalPaused: vocal.paused,
      vocalMuted: vocal.muted,
      vocalVolume: vocal.volume,
      isBlobUrl,
      vocalSrc,
    });

    if (!vocalPlaySucceeded) {
      hardStopBeat();
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

    // Vocal playing — optional beat retry
    if (wantBeat && beat && !beatPlaySucceeded) {
      try {
        beat.muted = false;
        beat.volume = Math.min(1, Math.max(0, beatVolumeRef.current));
        await beat.play();
        beatPlaySucceeded = true;
      } catch (e) {
        beatPlayError = e instanceof Error ? e.message : String(e);
        writeReviewDiagnostics({
          event: "BEAT_PLAY_ERROR",
          beatPlayError,
          vocalPlaySucceeded: true,
        });
      }
    }

    try {
      vocal.muted = false;
      vocal.volume = Math.min(1, Math.max(0, vocalVolumeRef.current));
      if (wantBeat && beat && !beat.paused) {
        beat.muted = false;
        beat.volume = Math.min(1, Math.max(0, beatVolumeRef.current));
      }
    } catch {
      /* ignore */
    }

    setPlaying(true);
    playingRef.current = true;
    pausedSongMsRef.current = null;
    alignedRef.current = true;
    vocalPauseCountRef.current = 0;
    vocalSeekCountRef.current = 0;
    vocalCorrectionCountRef.current = 0;
    lastVocalPauseReasonRef.current = null;
    lastVocalSeekTargetRef.current = null;
    driftSamplesRef.current = { sum: 0, n: 0, max: 0 };

    // Re-assert beat seek AFTER play() — iOS often ignores currentTime set while paused
    if (wantBeat && beat && beatPlaySucceeded) {
      try {
        const targetBeatSec = Math.max(0, songMs / 1000);
        if (Math.abs(beat.currentTime - targetBeatSec) > 0.35) {
          beat.currentTime = targetBeatSec;
        }
      } catch {
        /* ignore */
      }
    }

    const DRIFT_TOLERANCE_SEC = 0.35; // only correct large drift — never every frame
    const tick = () => {
      const v = vocalRef.current;
      const b = beatRef.current;
      if (!v) return;

      const placeNow = placementRef.current;
      const placeSec = placeNow / 1000;
      const vo = voiceOnlyRef.current;
      const bv = beatVolumeRef.current;
      const want = Boolean(beatSrc && !vo);
      const nosync = noSyncCorrections();

      if (vo || bv <= 0.001) {
        if (b && !b.paused) hardStopBeat();
      } else if (want && b && !b.paused) {
        const songSec = b.currentTime;
        const songMsNow = songSec * 1000;
        const expectedVocalSec = songSec - placeSec; // vocal file time

        // If beat clock is still BEFORE placement (seek failed / lag), DO NOT pause vocal.
        // Re-seek the beat toward placement + vocal progress so the take stays audible.
        if (expectedVocalSec < -0.05) {
          if (!nosync) {
            try {
              const repairSec = Math.max(0, placeSec + Math.max(0, v.currentTime));
              if (Math.abs(b.currentTime - repairSec) > 0.2) {
                b.currentTime = repairSec;
              }
            } catch {
              /* ignore */
            }
          }
          // Keep vocal running — never pause solely because beat is behind placement
          if (v.paused) {
            void v.play().catch(() => undefined);
          }
        } else if (!nosync) {
          // Normal sync: beat is at/after placement
          const drift = Math.abs(v.currentTime - expectedVocalSec);
          const ds = driftSamplesRef.current;
          ds.sum += drift * 1000;
          ds.n += 1;
          if (drift * 1000 > ds.max) ds.max = drift * 1000;

          if (v.paused) {
            void v.play().catch(() => undefined);
          }
          // Only correct large drift — continuous seeks fight the decoder and silence audio
          if (drift > DRIFT_TOLERANCE_SEC) {
            try {
              v.currentTime = Math.max(0, expectedVocalSec);
              vocalSeekCountRef.current += 1;
              vocalCorrectionCountRef.current += 1;
              lastVocalSeekTargetRef.current = expectedVocalSec;
            } catch {
              /* ignore */
            }
          }
        } else {
          // Diagnostic nosync: free-run both elements after initial align
          if (v.paused) void v.play().catch(() => undefined);
        }

        if (beatEndMs != null && songMsNow >= beatEndMs) {
          try {
            b.pause();
          } catch {
            /* ignore */
          }
        }

        try {
          if (b.muted) b.muted = false;
          const target = Math.min(1, Math.max(0, bv));
          if (target > 0 && Math.abs(b.volume - target) > 0.02) b.volume = target;
        } catch {
          /* ignore */
        }
      }

      // Vocal always unmuted and full volume during Review
      try {
        if (v.muted) v.muted = false;
        const tv = Math.min(1, Math.max(0, vocalVolumeRef.current));
        if (Math.abs(v.volume - tv) > 0.02) v.volume = tv;
        if (v.playbackRate !== 1) v.playbackRate = 1;
      } catch {
        /* ignore */
      }

      if (v.duration) setProgress(v.currentTime / v.duration);

      // Periodic diagnostics while Beat + Voice plays
      try {
        if (
          typeof window !== "undefined" &&
          localStorage.getItem("studio_debug_audio") === "1" &&
          want &&
          b
        ) {
          const ds = driftSamplesRef.current;
          sessionStorage.setItem(
            "studio_last_review_diagnostics",
            JSON.stringify({
              event: "raf_tick",
              mode: vo ? "voice_only" : "beat_plus_voice",
              nosync,
              vocalPaused: v.paused,
              vocalMuted: v.muted,
              vocalVolume: v.volume,
              vocalCurrentTime: v.currentTime,
              vocalDuration: Number.isFinite(v.duration) ? v.duration : null,
              vocalReadyState: v.readyState,
              beatPaused: b.paused,
              beatMuted: b.muted,
              beatVolume: b.volume,
              beatCurrentTime: b.currentTime,
              beatDuration: Number.isFinite(b.duration) ? b.duration : null,
              placementStartMs: placeNow,
              expectedVocalSec: b.currentTime - placeSec,
              vocalPauseCount: vocalPauseCountRef.current,
              vocalSeekCount: vocalSeekCountRef.current,
              vocalCorrectionCount: vocalCorrectionCountRef.current,
              lastVocalPauseReason: lastVocalPauseReasonRef.current,
              lastVocalSeekTarget: lastVocalSeekTargetRef.current,
              maxVocalDriftMs: ds.max,
              averageVocalDriftMs: ds.n ? ds.sum / ds.n : 0,
              at: Date.now(),
            })
          );
        }
      } catch {
        /* ignore */
      }

      if (!v.paused || (b && !b.paused && !vo)) {
        rafRef.current = requestAnimationFrame(tick);
      } else if (playingRef.current) {
        // Only stop transport if BOTH are paused (user pause sets playingRef false first)
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
      placementStartMs: place,
      songMs,
      beatCurrentTimeAfterPlay: beat?.currentTime ?? null,
      vocalCurrentTimeAfterPlay: vocal.currentTime,
      nosync: noSyncCorrections(),
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
