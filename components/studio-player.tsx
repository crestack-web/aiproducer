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

const COVER_GRADS = [
  ["#3A2E52", "#0B0A0F"],
  ["#2E4A4A", "#0B0A0F"],
  ["#4A2E3A", "#0B0A0F"],
  ["#39422E", "#0B0A0F"],
  ["#2E3A4A", "#0B0A0F"],
  ["#4A3A2E", "#0B0A0F"],
  ["#3A2E4A", "#0B0A0F"],
];

function coverGrad(seed: string): [string, string] {
  let n = 0;
  const s = seed || "song";
  for (let i = 0; i < s.length; i++) n = (n + s.charCodeAt(i) * (i + 1)) % COVER_GRADS.length;
  return COVER_GRADS[n] as [string, string];
}

/** Placeholder album art — gradient + music note (used on dashboard, library, players) */
export function CoverArt({ seed, size = 64 }: { seed: string; size?: number }) {
  const C = usePlayerColors();
  const [a, b] = coverGrad(seed);
  const icon = Math.max(14, Math.round(size * 0.38));
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: Math.max(8, Math.round(size * 0.22)),
        flexShrink: 0,
        background: `linear-gradient(145deg, ${a}, ${b})`,
        boxShadow: C.cardShadow,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
        overflow: "hidden",
      }}
      aria-hidden
    >
      {/* Soft vignette so the note reads on light/dark ends of the gradient */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "radial-gradient(circle at 50% 45%, rgba(0,0,0,0.15), rgba(0,0,0,0.45))",
          pointerEvents: "none",
        }}
      />
      <svg
        width={icon}
        height={icon}
        viewBox="0 0 24 24"
        fill="none"
        style={{ position: "relative", zIndex: 1, opacity: 0.92 }}
      >
        {/* Music note */}
        <path
          d="M9 18.5a2.5 2.5 0 1 1-2.45-2.5H9V6.2l10-2.2v10.8"
          stroke="rgba(255,248,240,0.95)"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="16.5" cy="16.5" r="2.5" fill="rgba(231,169,97,0.95)" />
        <circle cx="6.5" cy="18.5" r="2.5" fill="rgba(255,248,240,0.9)" />
      </svg>
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
          <div style={{ fontWeight: 600, color: C.text }}>{title || "Audio"}</div>
          {subtitle && <div style={{ fontSize: 12.5, color: C.textMuted, marginTop: 2 }}>{subtitle}</div>}
        </div>
        <button
          type="button"
          onClick={() => void toggle()}
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
  title,
  subtitle,
  timeline,
}: {
  stream: MediaStream | null;
  seconds: number;
  label?: string;
  seed?: string;
  maxSeconds?: number | null;
  /** Section name e.g. Pre-Chorus */
  title?: string | null;
  /** Layer e.g. Lead vocal */
  subtitle?: string | null;
  /** e.g. 0:42 – 1:05 */
  timeline?: string | null;
}) {
  const C = useTheme().colors;
  const bars = 56;
  const [levels, setLevels] = useState<number[]>(() =>
    Array.from({ length: bars }, (_, i) => 0.15 + 0.1 * Math.sin(i * 0.35))
  );
  const raf = useRef<number | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    if (!stream) return;
    let cancelled = false;
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AC();
    ctxRef.current = ctx;
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.72;
    src.connect(analyser);
    analyserRef.current = analyser;
    const data = new Uint8Array(analyser.frequencyBinCount);

    const tick = () => {
      if (cancelled) return;
      analyser.getByteFrequencyData(data);
      const next: number[] = [];
      const step = Math.max(1, Math.floor(data.length / bars));
      for (let i = 0; i < bars; i++) {
        let sum = 0;
        for (let j = 0; j < step; j++) sum += data[i * step + j] || 0;
        const v = sum / step / 255;
        // Emphasize mid curve like reference waveform
        const envelope = 0.55 + 0.45 * Math.sin((i / (bars - 1)) * Math.PI);
        next.push(Math.min(1, 0.08 + v * 1.35 * envelope));
      }
      setLevels(next);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      if (raf.current) cancelAnimationFrame(raf.current);
      try {
        src.disconnect();
        analyser.disconnect();
        void ctx.close();
      } catch {
        /* ignore */
      }
    };
  }, [stream]);

  // Idle pulse when no stream levels yet
  useEffect(() => {
    if (stream) return;
    let frame = 0;
    const id = window.setInterval(() => {
      frame += 1;
      setLevels((prev) =>
        prev.map((_, i) => {
          const wave = 0.2 + 0.15 * Math.sin(frame * 0.12 + i * 0.28);
          return wave;
        })
      );
    }, 80);
    return () => window.clearInterval(id);
  }, [stream]);

  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(Math.floor(seconds % 60)).padStart(2, "0");
  const maxLabel =
    maxSeconds != null && maxSeconds > 0
      ? ` / ${String(Math.floor(maxSeconds / 60)).padStart(2, "0")}:${String(Math.floor(maxSeconds % 60)).padStart(2, "0")}`
      : "";

  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: 280,
        padding: "28px 16px 8px",
        borderRadius: 24,
        overflow: "hidden",
        background:
          "radial-gradient(ellipse 80% 55% at 50% 42%, rgba(180,40,20,0.22) 0%, rgba(0,0,0,0) 70%), #050506",
      }}
    >
      {/* Soft vignette */}
      <div
        aria-hidden
        style={{
          pointerEvents: "none",
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(circle at 50% 40%, transparent 30%, rgba(0,0,0,0.55) 100%)",
        }}
      />

      {(title || subtitle || timeline) && (
        <div style={{ position: "relative", zIndex: 1, textAlign: "center", marginBottom: 28, maxWidth: 340 }}>
          {title && (
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: C.brass || "#E7A961",
                marginBottom: 6,
              }}
            >
              {title}
            </div>
          )}
          {subtitle && (
            <div
              style={{
                fontFamily: "Georgia, 'Times New Roman', serif",
                fontSize: 22,
                fontWeight: 500,
                color: C.text || "#F4F1EC",
                marginBottom: 6,
              }}
            >
              {subtitle}
            </div>
          )}
          {timeline && (
            <div style={{ fontSize: 13, color: C.textMuted || "#9B96A3", letterSpacing: 0.02 }}>
              {timeline}
            </div>
          )}
        </div>
      )}

      {/* Live bars — gold → orange gradient like reference */}
      <div
        style={{
          position: "relative",
          zIndex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 3,
          height: 120,
          width: "100%",
          maxWidth: 360,
          filter: "drop-shadow(0 0 18px rgba(231,169,97,0.35))",
        }}
        aria-hidden
      >
        {levels.map((lv, i) => {
          const h = Math.max(8, Math.round(lv * 100));
          return (
            <div
              key={`${seed}-${i}`}
              style={{
                width: 4,
                height: h,
                borderRadius: 2,
                background: `linear-gradient(180deg, #F5D78E 0%, #E7A961 45%, #E07A3A 100%)`,
                opacity: 0.85 + lv * 0.15,
                transition: "height 60ms linear",
              }}
            />
          );
        })}
      </div>

      <div
        style={{
          position: "relative",
          zIndex: 1,
          marginTop: 36,
          fontSize: 15,
          fontWeight: 500,
          color: "rgba(244,241,236,0.72)",
          letterSpacing: 0.02,
        }}
      >
        {label} · {Math.floor(seconds)}s{maxLabel ? maxLabel : ""}
      </div>
      {/* Keep mm:ss for a11y */}
      <span className="sr-only">
        {mm}:{ss}
      </span>
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
 * Review player: take at full volume, beat as a quiet guide only.
 * Simplified dual-play — prioritizes hearing the recorded voice.
 */
export function CompactAudioPlayer({
  src,
  label,
  seed = "take",
  beatSrc,
  beatStartMs = 0,
  beatEndMs,
  beatVolume = 0.02,
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
  playbackSinkId?: string | null;
  debugSectionLabel?: string | null;
  debugTaskId?: string | null;
  debugSectionStartMs?: number | null;
  debugRecordingOffsetMs?: number | null;
  overdubSrcs?: { url: string; volume?: number; label?: string }[] | null;
}) {
  const C = usePlayerColors();
  const vocalRef = useRef<HTMLAudioElement | null>(null);
  const beatRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const bars = useMemo(() => makeWave(seed, 40), [seed]);
  const voiceOnly = beatVolume <= 0.001;
  const placeSec = Math.max(0, (beatStartMs || 0) / 1000);
  const beatGuide = voiceOnly ? 0 : Math.min(0.02, Math.max(0.012, beatVolume || 0.015));

  useEffect(() => {
    const v = vocalRef.current;
    if (!v || !src) return;
    try {
      v.pause();
      if (v.getAttribute("src") !== src) v.src = src;
      v.load();
      setPlaying(false);
      setProgress(0);
      setLoadError(null);
    } catch {
      /* ignore */
    }
  }, [src]);

  async function toggle() {
    const vocal = vocalRef.current;
    if (!vocal) {
      setLoadError("Vocal element missing");
      return;
    }
    if (playing) {
      try {
        vocal.pause();
      } catch {
        /* ignore */
      }
      try {
        beatRef.current?.pause();
      } catch {
        /* ignore */
      }
      setPlaying(false);
      return;
    }
    setLoadError(null);
    try {
      vocal.muted = false;
      vocal.volume = Math.max(0.9, vocalVolume || 1);
      vocal.currentTime = 0;
    } catch {
      /* ignore */
    }
    const beat = beatRef.current;
    if (beat && beatSrc && !voiceOnly) {
      try {
        beat.muted = false;
        beat.volume = beatGuide;
        beat.currentTime = placeSec;
      } catch {
        /* ignore */
      }
    }
    try {
      const plays: Promise<unknown>[] = [vocal.play()];
      if (beat && beatSrc && !voiceOnly) plays.push(beat.play().catch(() => undefined));
      await Promise.all(plays);
      setPlaying(true);
    } catch (e) {
      try {
        vocal.muted = false;
        vocal.volume = 1;
        await vocal.play();
        setPlaying(true);
      } catch (e2) {
        const msg = e2 instanceof Error ? e2.message : String(e2);
        setLoadError(
          `Could not play your take (${msg}). Try Voice only, or record with headphones.`
        );
        setPlaying(false);
        return;
      }
    }
    const onTime = () => {
      try {
        if (vocal.muted) vocal.muted = false;
        if ((vocal.volume || 0) < 0.9) vocal.volume = 1;
        if (vocal.duration && vocal.duration > 0) {
          setProgress(Math.min(1, vocal.currentTime / vocal.duration));
        }
        if (beat && beatEndMs != null && beat.currentTime * 1000 >= beatEndMs) {
          beat.pause();
        }
      } catch {
        /* ignore */
      }
    };
    const onEnd = () => {
      setPlaying(false);
      try {
        beat?.pause();
      } catch {
        /* ignore */
      }
    };
    vocal.ontimeupdate = onTime;
    vocal.onended = onEnd;
  }

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
            <span style={{ marginLeft: 8, opacity: 0.7 }}>{voiceOnly ? "voice only" : "beat + voice"}</span>
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
