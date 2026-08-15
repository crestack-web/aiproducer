"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const C = {
  bg: "#0B0A0F",
  bgDeep: "#050508",
  surface: "rgba(255,255,255,0.045)",
  border: "rgba(255,255,255,0.09)",
  brass: "#E7A961",
  brassSoft: "rgba(231,169,97,0.15)",
  signal: "#7BEBD4",
  signalSoft: "rgba(123,235,212,0.14)",
  text: "#F4F1EC",
  textMuted: "#9B96A3",
  textFaint: "#5C5866",
  waveMuted: "rgba(255,255,255,0.14)",
};

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

function fmtTime(sec: number) {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function PlayIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M8 5.14v13.72a1 1 0 0 0 1.5.86l11-6.86a1 1 0 0 0 0-1.72l-11-6.86A1 1 0 0 0 8 5.14z" />
    </svg>
  );
}

function PauseIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </svg>
  );
}

function MusicIcon({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth="1.5" aria-hidden>
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </svg>
  );
}

export function Waveform({
  bars,
  progress = 0,
  height = 56,
  color = C.signal,
  muted = C.waveMuted,
  gap = 3,
  live = false,
}: {
  bars: number[];
  progress?: number;
  height?: number;
  color?: string;
  muted?: string;
  gap?: number;
  live?: boolean;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap, height, width: "100%" }}>
      {bars.map((h, i) => {
        const played = i / bars.length < progress;
        return (
          <div
            key={i}
            style={{
              flex: 1,
              minWidth: 2,
              borderRadius: 4,
              height: `${Math.max(8, h * height)}px`,
              background: played ? color : muted,
              boxShadow: played ? `0 0 8px ${color}55` : "none",
              transition: live
                ? "height 120ms ease"
                : "background 180ms ease, box-shadow 180ms ease, height 120ms ease",
            }}
          />
        );
      })}
    </div>
  );
}

export function CoverArt({
  gradient,
  size = 56,
  radius = 12,
  imageUrl,
}: {
  gradient: [string, string];
  size?: number;
  radius?: number;
  imageUrl?: string | null;
}) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        flexShrink: 0,
        background: imageUrl
          ? `center / cover no-repeat url(${imageUrl})`
          : `linear-gradient(145deg, ${gradient[0]}, ${gradient[1]})`,
        border: `1px solid ${C.border}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "radial-gradient(circle at 30% 20%, rgba(255,255,255,0.14), transparent 60%)",
          pointerEvents: "none",
        }}
      />
      {!imageUrl && <MusicIcon size={size * 0.32} />}
    </div>
  );
}

function useAudioEngine(src: string | null | undefined) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    if (src) {
      el.src = src;
      el.load();
    } else {
      el.removeAttribute("src");
      el.load();
    }
    setPlaying(false);
    setProgress(0);
    setTime(0);
    setDuration(0);
  }, [src]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;

    const onTime = () => {
      const d = el.duration;
      const t = el.currentTime;
      if (Number.isFinite(d) && d > 0) {
        setDuration(d);
        setTime(t);
        setProgress(Math.min(1, t / d));
      }
    };
    const onMeta = () => {
      if (Number.isFinite(el.duration)) setDuration(el.duration);
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => {
      setPlaying(false);
      setProgress(0);
      setTime(0);
      el.currentTime = 0;
    };

    el.addEventListener("timeupdate", onTime);
    el.addEventListener("loadedmetadata", onMeta);
    el.addEventListener("durationchange", onMeta);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("ended", onEnded);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("loadedmetadata", onMeta);
      el.removeEventListener("durationchange", onMeta);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("ended", onEnded);
    };
  }, []);

  const toggle = useCallback(async () => {
    const el = audioRef.current;
    if (!el || !src) return;
    try {
      if (el.paused) await el.play();
      else el.pause();
    } catch {
      /* ignore */
    }
  }, [src]);

  const seekRatio = useCallback(
    (ratio: number) => {
      const el = audioRef.current;
      if (!el || !duration) return;
      const r = Math.max(0, Math.min(1, ratio));
      el.currentTime = r * duration;
      setProgress(r);
      setTime(r * duration);
    },
    [duration]
  );

  return { audioRef, playing, progress, time, duration, toggle, seekRatio };
}

export function StudioPlayer({
  src,
  title,
  subtitle,
  coverUrl,
  seed,
  accent = "signal",
  compact = false,
}: {
  src: string | null | undefined;
  title: string;
  subtitle?: string | null;
  coverUrl?: string | null;
  seed?: string;
  accent?: "signal" | "brass";
  compact?: boolean;
}) {
  const { audioRef, playing, progress, time, duration, toggle, seekRatio } = useAudioEngine(src);
  const [liveBars, setLiveBars] = useState<number[] | null>(null);

  const waveSeed = seed || title || "studio";
  const baseBars = useMemo(() => makeWave(waveSeed, compact ? 36 : 46), [waveSeed, compact]);
  const gradient = useMemo(() => coverGradientFor(waveSeed), [waveSeed]);
  const waveColor = accent === "brass" ? C.brass : C.signal;

  useEffect(() => {
    if (!playing) {
      setLiveBars(null);
      return;
    }
    const id = setInterval(() => {
      setLiveBars(
        baseBars.map((h, i) => {
          const wobble = 0.08 * Math.sin(Date.now() / 180 + i * 0.55);
          return Math.max(0.12, Math.min(1, h + wobble));
        })
      );
    }, 120);
    return () => clearInterval(id);
  }, [playing, baseBars]);

  const bars = liveBars || baseBars;
  const coverSize = compact ? 72 : 168;
  const playSize = compact ? 52 : 60;

  return (
    <div style={{ width: "100%" }}>
      <audio ref={audioRef} preload="metadata" playsInline controls={false} style={{ display: "none" }} />

      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: compact ? 8 : 12 }}>
        <CoverArt gradient={gradient} size={coverSize} radius={compact ? 16 : 22} imageUrl={coverUrl} />
        <div
          style={{
            fontFamily: "Georgia, 'Fraunces', serif",
            fontSize: compact ? 18 : 24,
            color: C.text,
            marginTop: compact ? 12 : 20,
            textAlign: "center",
            padding: "0 8px",
          }}
        >
          {title}
        </div>
        {subtitle && (
          <div
            style={{
              fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
              fontSize: 12,
              color: C.brass,
              marginTop: 6,
              letterSpacing: 0.5,
              textAlign: "center",
            }}
          >
            {subtitle}
          </div>
        )}
      </div>

      <div style={{ marginTop: compact ? 18 : 30 }}>
        <div
          role="slider"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
          aria-label="Seek"
          onClick={(e) => {
            if (!src) return;
            const rect = e.currentTarget.getBoundingClientRect();
            seekRatio((e.clientX - rect.left) / rect.width);
          }}
          style={{ cursor: src ? "pointer" : "default" }}
        >
          <Waveform bars={bars} progress={progress} height={compact ? 40 : 56} color={waveColor} live={playing} />
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: 8,
            fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
            fontSize: 11,
            color: C.textFaint,
          }}
        >
          <span>{fmtTime(time)}</span>
          <span>{fmtTime(duration)}</span>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 22, marginTop: 18 }}>
        <div style={{ width: 17 }} />
        <button
          type="button"
          onClick={toggle}
          disabled={!src}
          aria-label={playing ? "Pause" : "Play"}
          style={{
            width: playSize,
            height: playSize,
            borderRadius: 999,
            border: "none",
            background: `linear-gradient(180deg, #F0BC80, ${C.brass})`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#1A1208",
            boxShadow: "0 10px 26px -8px rgba(231,169,97,0.6)",
            cursor: src ? "pointer" : "not-allowed",
            opacity: src ? 1 : 0.45,
            padding: 0,
          }}
        >
          {playing ? <PauseIcon size={compact ? 18 : 22} /> : <PlayIcon size={compact ? 18 : 22} />}
        </button>
        <div style={{ width: 17 }} />
      </div>
    </div>
  );
}

export function CompactAudioPlayer({
  src,
  label = "Your take",
  seed = "take",
  beatSrc,
  beatStartMs = 0,
  beatEndMs,
  beatVolume = 0.55,
  vocalVolume = 1,
}: {
  src: string | null | undefined;
  label?: string;
  seed?: string;
  beatSrc?: string | null;
  beatStartMs?: number;
  beatEndMs?: number | null;
  beatVolume?: number;
  vocalVolume?: number;
}) {
  const vocalRef = useRef<HTMLAudioElement | null>(null);
  const beatRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [liveBars, setLiveBars] = useState<number[] | null>(null);
  const baseBars = useMemo(() => makeWave(seed || label || "take", 40), [seed, label]);

  const beatStartSec = Math.max(0, (beatStartMs ?? 0) / 1000);
  const beatEndSec =
    beatEndMs != null && beatEndMs > (beatStartMs ?? 0) ? beatEndMs / 1000 : null;

  useEffect(() => {
    const el = vocalRef.current;
    if (!el) return;
    if (src) {
      el.src = src;
      el.volume = vocalVolume;
      el.load();
    } else {
      el.removeAttribute("src");
      el.load();
    }
    setPlaying(false);
    setProgress(0);
    setTime(0);
    setDuration(0);
  }, [src, vocalVolume]);

  useEffect(() => {
    const el = beatRef.current;
    if (!el) return;
    if (beatSrc) {
      el.src = beatSrc;
      el.volume = beatVolume;
      el.load();
    } else {
      el.removeAttribute("src");
      el.load();
    }
  }, [beatSrc, beatVolume]);

  const syncBeatToVocal = useCallback(() => {
    const vocal = vocalRef.current;
    const beat = beatRef.current;
    if (!vocal || !beat || !beatSrc) return;
    const target = beatStartSec + vocal.currentTime;
    if (beatEndSec != null && target >= beatEndSec) {
      beat.pause();
      return;
    }
    if (Math.abs(beat.currentTime - target) > 0.12) {
      try { beat.currentTime = target; } catch { /* ignore */ }
    }
    if (!vocal.paused && beat.paused && (beatEndSec == null || target < beatEndSec)) {
      beat.play().catch(() => undefined);
    }
  }, [beatSrc, beatStartSec, beatEndSec]);

  useEffect(() => {
    const vocal = vocalRef.current;
    if (!vocal) return;

    const onTime = () => {
      const d = vocal.duration;
      const t = vocal.currentTime;
      if (Number.isFinite(d) && d > 0) {
        setDuration(d);
        setTime(t);
        setProgress(Math.min(1, t / d));
      }
      syncBeatToVocal();
    };
    const onMeta = () => {
      if (Number.isFinite(vocal.duration)) setDuration(vocal.duration);
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => {
      setPlaying(false);
      beatRef.current?.pause();
    };
    const onEnded = () => {
      setPlaying(false);
      setProgress(0);
      setTime(0);
      vocal.currentTime = 0;
      const beat = beatRef.current;
      if (beat) {
        beat.pause();
        try { beat.currentTime = beatStartSec; } catch { /* ignore */ }
      }
    };

    vocal.addEventListener("timeupdate", onTime);
    vocal.addEventListener("loadedmetadata", onMeta);
    vocal.addEventListener("durationchange", onMeta);
    vocal.addEventListener("play", onPlay);
    vocal.addEventListener("pause", onPause);
    vocal.addEventListener("ended", onEnded);
    return () => {
      vocal.removeEventListener("timeupdate", onTime);
      vocal.removeEventListener("loadedmetadata", onMeta);
      vocal.removeEventListener("durationchange", onMeta);
      vocal.removeEventListener("play", onPlay);
      vocal.removeEventListener("pause", onPause);
      vocal.removeEventListener("ended", onEnded);
    };
  }, [syncBeatToVocal, beatStartSec]);

  useEffect(() => {
    if (!playing) {
      setLiveBars(null);
      return;
    }
    const id = setInterval(() => {
      setLiveBars(
        baseBars.map((h, i) => {
          const wobble = 0.1 * Math.sin(Date.now() / 160 + i * 0.6);
          return Math.max(0.12, Math.min(1, h + wobble));
        })
      );
    }, 100);
    return () => clearInterval(id);
  }, [playing, baseBars]);

  const toggle = useCallback(async () => {
    const vocal = vocalRef.current;
    if (!vocal || !src) return;
    try {
      if (vocal.paused) {
        const beat = beatRef.current;
        vocal.volume = vocalVolume;
        if (beat && beatSrc) {
          beat.volume = beatVolume;
          try { beat.currentTime = beatStartSec + (vocal.currentTime || 0); } catch { /* ignore */ }
          await Promise.all([beat.play().catch(() => undefined), vocal.play()]);
        } else {
          await vocal.play();
        }
      } else {
        vocal.pause();
        beatRef.current?.pause();
      }
    } catch {
      /* ignore */
    }
  }, [src, beatSrc, beatStartSec, beatVolume, vocalVolume]);

  const seekRatio = useCallback(
    (ratio: number) => {
      const vocal = vocalRef.current;
      if (!vocal || !duration) return;
      const r = Math.max(0, Math.min(1, ratio));
      const t = r * duration;
      vocal.currentTime = t;
      setProgress(r);
      setTime(t);
      const beat = beatRef.current;
      if (beat && beatSrc) {
        try { beat.currentTime = beatStartSec + t; } catch { /* ignore */ }
      }
    },
    [duration, beatSrc, beatStartSec]
  );

  if (!src) return null;

  const bars = liveBars || baseBars;
  const withBeat = Boolean(beatSrc);

  return (
    <div
      style={{
        marginTop: 14,
        padding: "14px 14px 12px",
        borderRadius: 16,
        background: C.surface,
        border: `1px solid ${C.border}`,
      }}
    >
      <audio ref={vocalRef} preload="auto" playsInline controls={false} style={{ display: "none" }} />
      <audio ref={beatRef} preload="auto" playsInline controls={false} style={{ display: "none" }} />

      <div style={{ fontSize: 12, color: C.textFaint, marginBottom: 10, letterSpacing: 0.3 }}>
        {label}
        {withBeat && <span style={{ color: C.brass }}> · with beat</span>}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? "Pause take" : "Play take with beat"}
          style={{
            width: 44,
            height: 44,
            borderRadius: 999,
            border: "none",
            flexShrink: 0,
            background: `linear-gradient(180deg, #F0BC80, ${C.brass})`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#1A1208",
            boxShadow: "0 8px 20px -8px rgba(231,169,97,0.55)",
            cursor: "pointer",
            padding: 0,
          }}
        >
          {playing ? <PauseIcon size={16} /> : <PlayIcon size={16} />}
        </button>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            role="slider"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress * 100)}
            aria-label="Seek take"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              seekRatio((e.clientX - rect.left) / rect.width);
            }}
            style={{ cursor: "pointer" }}
          >
            <Waveform bars={bars} progress={progress} height={36} color={C.signal} live={playing} />
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginTop: 6,
              fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
              fontSize: 10.5,
              color: C.textFaint,
            }}
          >
            <span>{fmtTime(time)}</span>
            <span>{fmtTime(duration)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
