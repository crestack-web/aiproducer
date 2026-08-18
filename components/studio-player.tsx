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
  beatVolume = 0.4,
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

  function vocalFileTimeFromSongMs(songMs: number): number {
    return (songMs - placementStartMs) / 1000;
  }

  function applySongTimelineMs(songMs: number) {
    const beat = beatRef.current;
    const vocal = vocalRef.current;
    if (beat && beatSrc && !voiceOnly) {
      try {
        const bt = Math.max(0, songMs / 1000);
        if (Math.abs(beat.currentTime - bt) > 0.08) beat.currentTime = bt;
      } catch {
        /* ignore */
      }
    }
    if (vocal) {
      const vt = vocalFileTimeFromSongMs(songMs);
      try {
        if (vt < 0) {
          if (!vocal.paused) vocal.pause();
          if (vocal.currentTime !== 0) vocal.currentTime = 0;
        } else {
          if (Math.abs(vocal.currentTime - vt) > 0.08) vocal.currentTime = vt;
        }
      } catch {
        /* ignore */
      }
    }
  }

  useEffect(() => {
    stopRaf();
    setPlaying(false);
    setProgress(0);
    setLoadError(null);
    pausedSongMsRef.current = null;
    const vocal = vocalRef.current;
    if (vocal) {
      try {
        vocal.pause();
        vocal.currentTime = 0;
        vocal.playbackRate = 1;
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

  useEffect(() => {
    const vocal = vocalRef.current;
    if (vocal) {
      vocal.volume = Math.min(1, Math.max(0, vocalVolume));
      vocal.muted = false;
      vocal.playbackRate = 1;
    }
    if (voiceOnly) {
      hardStopBeat();
      return;
    }
    const beat = beatRef.current;
    if (!beat) return;
    try {
      beat.muted = false;
      beat.playbackRate = 1;
      beat.volume = Math.min(1, Math.max(0, beatVolume));
    } catch {
      /* ignore */
    }
  }, [vocalVolume, beatVolume, voiceOnly, hardStopBeat]);

  async function ensureReady(el: HTMLAudioElement, ms = 8000): Promise<boolean> {
    if (el.readyState >= 2) return true;
    return new Promise((resolve) => {
      let settled = false;
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        el.removeEventListener("canplay", onOk);
        el.removeEventListener("loadeddata", onOk);
        el.removeEventListener("error", onErr);
        clearTimeout(timer);
        resolve(ok);
      };
      const onOk = () => finish(true);
      const onErr = () => finish(false);
      const timer = setTimeout(() => finish(el.readyState >= 2), ms);
      el.addEventListener("canplay", onOk);
      el.addEventListener("loadeddata", onOk);
      el.addEventListener("error", onErr);
      try {
        el.load();
      } catch {
        finish(el.readyState >= 2);
      }
    });
  }

  async function toggle() {
    const vocal = vocalRef.current;
    if (!vocal) return;
    if (playing) {
      const beat = beatRef.current;
      const songMs =
        beat && beatSrc && !voiceOnly && !beat.paused
          ? beat.currentTime * 1000
          : placementStartMs + vocal.currentTime * 1000;
      pausedSongMsRef.current = songMs;
      vocal.pause();
      hardStopBeat();
      stopRaf();
      setPlaying(false);
      return;
    }

    setLoadError(null);
    const vocalOk = await ensureReady(vocal);
    if (!vocalOk) {
      setLoadError("Could not load your take for playback");
      return;
    }

    vocal.playbackRate = 1;
    vocal.volume = Math.min(1, Math.max(0, vocalVolume));

    const beat = beatRef.current;
    const wantBeat = Boolean(beat && beatSrc && !voiceOnly);
    const songMs = pausedSongMsRef.current != null ? pausedSongMsRef.current : placementStartMs;
    applySongTimelineMs(songMs);

    if (wantBeat && beat) {
      const beatOk = await ensureReady(beat);
      if (beatOk) {
        try {
          beat.muted = false;
          beat.playbackRate = 1;
          beat.currentTime = songMs / 1000;
        } catch {
          /* ignore */
        }
        beat.volume = Math.min(1, Math.max(0, beatVolume));
        await beat.play().catch(() => undefined);
      }
    } else {
      hardStopBeat();
    }

    try {
      const vt = vocalFileTimeFromSongMs(songMs);
      vocal.currentTime = Math.max(0, vt);
      await vocal.play();
    } catch {
      hardStopBeat();
      setLoadError("Playback was blocked — tap again");
      setPlaying(false);
      return;
    }

    setPlaying(true);
    pausedSongMsRef.current = null;

    const tick = () => {
      const v = vocalRef.current;
      const b = beatRef.current;
      if (!v) return;

      if (wantBeat && b && !b.paused) {
        const song = b.currentTime * 1000;
        const vt = vocalFileTimeFromSongMs(song);
        if (vt < 0) {
          if (!v.paused) v.pause();
          if (v.currentTime !== 0) v.currentTime = 0;
        } else {
          if (v.paused) void v.play().catch(() => undefined);
          if (Math.abs(v.currentTime - vt) > 0.08) {
            try {
              v.currentTime = vt;
            } catch {
              /* ignore */
            }
          }
        }
        if (beatEndMs != null && song >= beatEndMs) {
          b.pause();
        }
      }

      if (v.duration) setProgress(v.currentTime / v.duration);
      if (voiceOnly || beatVolume <= 0.001) {
        if (b && !b.paused) hardStopBeat();
      }
      // Review diagnostics (studio_debug_audio=1)
      try {
        if (
          typeof window !== "undefined" &&
          localStorage.getItem("studio_debug_audio") === "1"
        ) {
          const songFromBeat = b && !b.paused ? b.currentTime * 1000 : null;
          const songFromVocal = placementStartMs + v.currentTime * 1000;
          const drift =
            songFromBeat != null ? Math.abs(songFromBeat - songFromVocal) : null;
          sessionStorage.setItem(
            "studio_last_review_diagnostics",
            JSON.stringify({
              reviewMode: voiceOnly ? "voice_only" : "beat_plus_voice",
              vocalPlaying: !v.paused,
              vocalMuted: v.muted,
              vocalVolume: v.volume,
              vocalPlaybackRate: v.playbackRate,
              beatPlaying: Boolean(b && !b.paused),
              beatMuted: b ? b.muted : null,
              beatVolume: b ? b.volume : null,
              beatPlaybackRate: b ? b.playbackRate : null,
              activeReviewBeatSources: wantBeat && b && !b.paused ? 1 : 0,
              reviewBeatStartMs: placementStartMs,
              vocalCurrentTime: v.currentTime,
              beatCurrentTime: b ? b.currentTime : null,
              maxDriftMs: drift,
              at: Date.now(),
            })
          );
        }
      } catch {
        /* ignore */
      }
      if (!v.paused || (b && !b.paused)) {
        rafRef.current = requestAnimationFrame(tick);
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
      setProgress(1);
      pausedSongMsRef.current = null;
    };
    vocal.addEventListener("ended", onEnd);
    return () => vocal.removeEventListener("ended", onEnd);
  }, [hardStopBeat]);

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
