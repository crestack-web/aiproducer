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

export function PlayIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M8 5.5v13l11-6.5L8 5.5Z" />
    </svg>
  );
}

export function PauseIcon({ size = 18 }: { size?: number }) {
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
