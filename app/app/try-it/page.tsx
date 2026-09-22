"use client";

/**
 * Try It — isolated voice-clone preview UI.
 * Immersive demo experience; does not share state with Booth Record.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { useTheme } from "@/lib/theme";

type Phase =
  | "idle"
  | "recording"
  | "uploading"
  | "cloning"
  | "ready"
  | "generating"
  | "preview"
  | "error";

const BAR_COUNT = 56;

export default function TryItPage() {
  const router = useRouter();
  const { colors: C, mode } = useTheme();
  const isDark = mode !== "light";

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [quotaRemaining, setQuotaRemaining] = useState<number | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [msg, setMsg] = useState<string | null>(null);
  const [genre, setGenre] = useState("afrobeats");
  const [lyrics, setLyrics] = useState(
    "Yeah this is my sound, riding on the beat, feel the night, feel the heat"
  );
  const [showSetup, setShowSetup] = useState(false);
  const [mixUrl, setMixUrl] = useState<string | null>(null);
  const [beatUrl, setBeatUrl] = useState<string | null>(null);
  const [vocalUrl, setVocalUrl] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  const [recSec, setRecSec] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [animTick, setAnimTick] = useState(0);

  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const startedAtRef = useRef(0);
  const mixAudioRef = useRef<HTMLAudioElement | null>(null);
  const beatAudioRef = useRef<HTMLAudioElement | null>(null);
  const vocalAudioRef = useRef<HTMLAudioElement | null>(null);
  const rafRef = useRef(0);
  const recTimerRef = useRef(0);

  // Ambient bar animation
  useEffect(() => {
    let id = 0;
    const loop = () => {
      setAnimTick((t) => t + 1);
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/try-it/session", { method: "POST" });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (!cancelled) {
            setPhase("error");
            setMsg(typeof j.error === "string" ? j.error : "Try It unavailable");
          }
          return;
        }
        if (!cancelled) {
          setSessionId(j.id as string);
          if (j.quota && typeof j.quota.remaining === "number") {
            setQuotaRemaining(j.quota.remaining);
          }
          // Option A: sample optional — show genre/lyrics + generate immediately
          setShowSetup(true);
          setPhase("ready");
        }
      } catch {
        if (!cancelled) {
          setPhase("error");
          setMsg("Could not start Try It session");
        }
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      cancelAnimationFrame(rafRef.current);
      window.clearInterval(recTimerRef.current);
      beatAudioRef.current?.pause();
      vocalAudioRef.current?.pause();
    };
  }, []);

  const stopMeter = () => {
    cancelAnimationFrame(rafRef.current);
    setLevel(0);
  };

  const startRecord = useCallback(async () => {
    setMsg(null);
    setShowSetup(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      const rec = new MediaRecorder(stream, { mimeType: mime });
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size) chunksRef.current.push(e.data);
      };
      mediaRef.current = rec;
      startedAtRef.current = Date.now();
      setRecSec(0);
      rec.start(120);
      setPhase("recording");

      window.clearInterval(recTimerRef.current);
      recTimerRef.current = window.setInterval(() => {
        setRecSec(Math.floor((Date.now() - startedAtRef.current) / 1000));
      }, 250);

      const ctx = new AudioContext();
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      src.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteFrequencyData(data);
        let s = 0;
        for (let i = 0; i < data.length; i++) s += data[i];
        setLevel(Math.min(1, s / (data.length * 140)));
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      setMsg("Microphone permission required");
      setPhase("error");
    }
  }, []);

  const stopAndUpload = useCallback(async () => {
    const rec = mediaRef.current;
    if (!rec || !sessionId) return;
    stopMeter();
    window.clearInterval(recTimerRef.current);
    const durationMs = Date.now() - startedAtRef.current;
    await new Promise<void>((resolve) => {
      rec.onstop = () => resolve();
      rec.stop();
    });
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;

    if (durationMs < 10_000) {
      setMsg("Keep going — need at least 10 seconds");
      setPhase("idle");
      return;
    }
    if (durationMs > 120_000) {
      setMsg("Keep the sample under 2 minutes");
      setPhase("idle");
      return;
    }

    const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
    setPhase("uploading");
    setMsg("Uploading your sample…");
    try {
      const fd = new FormData();
      fd.append("file", blob, "try-it-sample.webm");
      fd.append("duration_ms", String(durationMs));
      setPhase("cloning");
      setMsg("Cloning a temporary voice…");
      const res = await fetch(`/api/try-it/session/${sessionId}/sample`, {
        method: "POST",
        body: fd,
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPhase("error");
        setMsg(typeof j.error === "string" ? j.error : "Clone failed");
        return;
      }
      setPhase("ready");
      setShowSetup(true);
      setMsg(null);
    } catch {
      setPhase("error");
      setMsg("Upload failed");
    }
  }, [sessionId]);

  const onFile = async (file: File) => {
    if (!sessionId) return;
    setMsg(null);
    setPhase("uploading");
    try {
      const ctx = new AudioContext();
      const ab = await file.arrayBuffer();
      const buf = await ctx.decodeAudioData(ab.slice(0));
      const durationMs = Math.round(buf.duration * 1000);
      void ctx.close();
      if (durationMs < 10_000) {
        setPhase("idle");
        setMsg("Sample must be at least 10 seconds");
        return;
      }
      if (durationMs > 120_000) {
        setPhase("idle");
        setMsg("Sample must be under 2 minutes");
        return;
      }
      const fd = new FormData();
      fd.append("file", file);
      fd.append("duration_ms", String(durationMs));
      setPhase("cloning");
      setMsg("Cloning a temporary voice…");
      const res = await fetch(`/api/try-it/session/${sessionId}/sample`, {
        method: "POST",
        body: fd,
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPhase("error");
        setMsg(typeof j.error === "string" ? j.error : "Clone failed");
        return;
      }
      setPhase("ready");
      setShowSetup(true);
      setMsg(null);
    } catch {
      setPhase("error");
      setMsg("Could not read that audio file");
    }
  };

  const stopPreview = useCallback(() => {
    mixAudioRef.current?.pause();
    if (mixAudioRef.current) mixAudioRef.current.currentTime = 0;
    beatAudioRef.current?.pause();
    vocalAudioRef.current?.pause();
    if (beatAudioRef.current) beatAudioRef.current.currentTime = 0;
    if (vocalAudioRef.current) vocalAudioRef.current.currentTime = 0;
    setPlaying(false);
    setProgress(0);
  }, []);

  const togglePlay = useCallback(() => {
    const mix = mixAudioRef.current;
    if (mix) {
      if (playing) {
        mix.pause();
        setPlaying(false);
        return;
      }
      void mix.play().then(() => setPlaying(true)).catch(() => setMsg("Could not play preview — tap again"));
      return;
    }
    const beat = beatAudioRef.current;
    const vocal = vocalAudioRef.current;
    if (!beat || !vocal) return;
    if (playing) {
      beat.pause();
      vocal.pause();
      setPlaying(false);
      return;
    }
    void (async () => {
      try {
        if (beat.ended || vocal.ended) {
          beat.currentTime = 0;
          vocal.currentTime = 0;
        }
        vocal.currentTime = beat.currentTime;
        await Promise.all([beat.play(), vocal.play()]);
        setPlaying(true);
      } catch {
        setMsg("Could not play preview — tap again");
      }
    })();
  }, [playing]);

  // Wire audio when preview is ready (prefer single mix from Music composition plan)
  useEffect(() => {
    if (phase !== "preview") return;

    if (mixUrl) {
      const mix = new Audio(mixUrl);
      mix.preload = "auto";
      mix.volume = 1;
      mixAudioRef.current = mix;
      const onTime = () => {
        setProgress(mix.currentTime);
        if (Number.isFinite(mix.duration)) setDuration(mix.duration);
      };
      const onEnded = () => {
        setPlaying(false);
        setProgress(0);
      };
      mix.addEventListener("timeupdate", onTime);
      mix.addEventListener("ended", onEnded);
      mix.addEventListener("loadedmetadata", onTime);
      void mix.play().then(() => setPlaying(true)).catch(() => undefined);
      return () => {
        mix.pause();
        mix.removeEventListener("timeupdate", onTime);
        mix.removeEventListener("ended", onEnded);
        mixAudioRef.current = null;
        setPlaying(false);
      };
    }

    if (!beatUrl || !vocalUrl) return;
    const beat = new Audio(beatUrl);
    const vocal = new Audio(vocalUrl);
    beat.preload = "auto";
    vocal.preload = "auto";
    beat.volume = 0.72;
    vocal.volume = 1;
    beatAudioRef.current = beat;
    vocalAudioRef.current = vocal;
    const onTime = () => {
      const tm = beat.currentTime;
      const d = beat.duration || vocal.duration || 0;
      setProgress(tm);
      setDuration(Number.isFinite(d) ? d : 0);
      if (Math.abs(vocal.currentTime - tm) > 0.12) vocal.currentTime = tm;
    };
    const onEnded = () => {
      setPlaying(false);
      setProgress(0);
      vocal.pause();
      vocal.currentTime = 0;
    };
    beat.addEventListener("timeupdate", onTime);
    beat.addEventListener("ended", onEnded);
    void Promise.all([beat.play(), vocal.play()]).then(() => setPlaying(true)).catch(() => undefined);
    return () => {
      beat.pause();
      vocal.pause();
      beatAudioRef.current = null;
      vocalAudioRef.current = null;
      setPlaying(false);
    };
  }, [phase, mixUrl, beatUrl, vocalUrl]);

  const generate = async () => {
    if (!sessionId) return;
    if (quotaRemaining !== null && quotaRemaining <= 0) {
      setPhase("error");
      setMsg("You've used your free Try It previews. Record the real version in Booth.");
      return;
    }
    stopPreview();
    setPhase("generating");
    setMsg("Building a short draft preview…");
    setShowSetup(false);
    try {
      const res = await fetch(`/api/try-it/session/${sessionId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ genre, lyrics, tempo: 100, section: "chorus" }),
      });
      const j = await res.json().catch(() => ({}));
      if (j.quota && typeof j.quota.remaining === "number") {
        setQuotaRemaining(j.quota.remaining);
      }
      if (!res.ok) {
        setPhase("error");
        setMsg(typeof j.error === "string" ? j.error : "Generate failed");
        return;
      }
      setMixUrl(j.preview?.mix_url || null);
      setBeatUrl(j.preview?.beat_url || null);
      setVocalUrl(j.preview?.vocal_url || null);
      setPhase("preview");
      setMsg(null);
    } catch {
      setPhase("error");
      setMsg("Generate failed");
    }
  };

  const goRealRecord = () => {
    stopPreview();
    router.push(`/app/studio?tryIt=1&genre=${encodeURIComponent(genre)}`);
  };

  const fmt = (s: number) => {
    if (!Number.isFinite(s) || s < 0) return "0:00";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  // Waveform heights driven by phase
  const bars = Array.from({ length: BAR_COUNT }, (_, i) => {
    const t = animTick * 0.08;
    if (phase === "recording") {
      const pulse = 0.2 + level * (0.55 + 0.45 * Math.sin(i * 0.35 + t * 3));
      return Math.min(1, Math.max(0.08, pulse));
    }
    if (phase === "generating" || phase === "cloning" || phase === "uploading") {
      const wave = 0.25 + 0.55 * Math.abs(Math.sin(i * 0.22 + t * 2.2));
      return wave;
    }
    if (phase === "preview" && playing) {
      const wave =
        0.3 +
        0.5 * Math.abs(Math.sin(i * 0.28 + progress * 6 + t)) *
          (0.6 + 0.4 * Math.sin(i * 0.1));
      return wave;
    }
    if (phase === "preview") {
      return 0.18 + 0.12 * Math.abs(Math.sin(i * 0.2));
    }
    if (phase === "ready") {
      return 0.2 + 0.15 * Math.abs(Math.sin(i * 0.25 + t * 0.5));
    }
    // idle breathing
    return 0.12 + 0.1 * Math.abs(Math.sin(i * 0.18 + t * 0.4));
  });

  const bg = isDark
    ? "radial-gradient(ellipse 120% 80% at 50% 0%, #1a1520 0%, #0B0A0F 55%, #07060a 100%)"
    : "radial-gradient(ellipse 120% 80% at 50% 0%, #F7F0E6 0%, #EFE6DA 50%, #E8DFD2 100%)";
  const text = isDark ? "#F4F1EC" : "#1A1510";
  const muted = isDark ? "#9B96A3" : "#6B635A";
  const card = isDark ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.55)";
  const border = isDark ? "rgba(255,255,255,0.1)" : "rgba(48,36,22,0.12)";

  const statusLabel =
    phase === "recording"
      ? `Recording · ${recSec}s`
      : phase === "uploading"
        ? "Uploading…"
        : phase === "cloning"
          ? "Cloning voice…"
          : phase === "generating"
            ? "Generating preview…"
            : phase === "ready"
              ? "Voice ready"
              : phase === "preview"
                ? playing
                  ? "Playing draft"
                  : "Preview ready"
                : phase === "error"
                  ? "Something went wrong"
                  : "Tap to record";

  return (
    <AppShell>
      <div
        style={{
          minHeight: "100dvh",
          background: bg,
          color: text,
          fontFamily: "system-ui, -apple-system, sans-serif",
          display: "flex",
          flexDirection: "column",
          padding: "12px 18px max(20px, env(safe-area-inset-bottom))",
          maxWidth: 480,
          margin: "0 auto",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Soft glow behind waveform */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            left: "50%",
            top: "42%",
            transform: "translate(-50%, -50%)",
            width: "90%",
            height: 180,
            borderRadius: "50%",
            background: isDark
              ? "radial-gradient(circle, rgba(239,68,68,0.18), transparent 70%)"
              : "radial-gradient(circle, rgba(239,68,68,0.12), transparent 70%)",
            pointerEvents: "none",
            opacity: phase === "recording" || phase === "generating" ? 1 : 0.5,
            transition: "opacity 0.4s ease",
          }}
        />

        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4, zIndex: 1 }}>
          <Link
            href="/app"
            style={{ color: muted, textDecoration: "none", fontSize: 14, fontWeight: 600 }}
          >
            ← Back
          </Link>
          <span style={{ flex: 1, textAlign: "center", fontWeight: 800, fontSize: 16, letterSpacing: "-0.02em" }}>
            Try It
          </span>
          <span style={{ width: 48, textAlign: "right", fontSize: 11, color: muted, fontWeight: 600 }}>
            {quotaRemaining != null ? `${quotaRemaining} left` : ""}
          </span>
        </div>

        <div style={{ textAlign: "center", marginTop: 8, zIndex: 1 }}>
          <h1
            style={{
              margin: 0,
              fontSize: 22,
              fontWeight: 800,
              letterSpacing: "-0.03em",
              lineHeight: 1.25,
            }}
          >
            {phase === "preview"
              ? "Your draft preview"
              : phase === "ready"
                ? "Ready to generate"
                : "Sing or rap your favorite song"}
          </h1>
          <p
            style={{
              margin: "8px 0 0",
              fontSize: 13,
              color: muted,
              lineHeight: 1.45,
              padding: "0 8px",
            }}
          >
            {phase === "preview"
              ? "Real section mix · ~18s · model vocals · not downloadable"
              : "10s–2 min sample · temp voice · free demo"}
          </p>
        </div>

        {/* Waveform */}
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            minHeight: 200,
            gap: 2.5,
            padding: "24px 4px",
            zIndex: 1,
          }}
        >
          {bars.map((h, i) => (
            <div
              key={i}
              style={{
                width: 3.5,
                height: `${Math.round(12 + h * 110)}px`,
                borderRadius: 3,
                background:
                  phase === "recording"
                    ? `linear-gradient(180deg, #FBBF24 0%, #F97316 45%, #EF4444 100%)`
                    : phase === "generating" || phase === "cloning"
                      ? `linear-gradient(180deg, #F0BC80 0%, #E7A961 50%, #F97316 100%)`
                      : phase === "preview"
                        ? `linear-gradient(180deg, #FBBF24 0%, #EF4444 100%)`
                        : `linear-gradient(180deg, #FBBF24 0%, #FB923C 50%, #EF4444 100%)`,
                opacity: 0.75 + h * 0.25,
                transform: `scaleY(${0.85 + h * 0.2})`,
                transition: phase === "recording" ? "none" : "height 0.08s linear",
                boxShadow:
                  phase === "recording" || phase === "generating"
                    ? "0 0 12px rgba(239,68,68,0.25)"
                    : "none",
              }}
            />
          ))}
        </div>

        {/* Status / error */}
        <div style={{ textAlign: "center", minHeight: 28, zIndex: 1 }}>
          <p
            style={{
              margin: 0,
              fontSize: 14,
              fontWeight: 600,
              color: phase === "error" ? (C.danger || "#F07167") : muted,
            }}
          >
            {msg || statusLabel}
          </p>
        </div>

        {/* Preview transport */}
        {phase === "preview" && (mixUrl || (beatUrl && vocalUrl)) && (
          <div
            style={{
              marginTop: 16,
              padding: "14px 16px",
              borderRadius: 18,
              background: card,
              border: `1px solid ${border}`,
              backdropFilter: "blur(12px)",
              zIndex: 1,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <button
                type="button"
                onClick={togglePlay}
                aria-label={playing ? "Pause" : "Play preview"}
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 999,
                  border: "none",
                  background: "linear-gradient(180deg, #F0BC80, #E7A961)",
                  color: "#1A1208",
                  fontSize: 22,
                  fontWeight: 800,
                  cursor: "pointer",
                  boxShadow: "0 8px 24px rgba(231,169,97,0.35)",
                  flexShrink: 0,
                  display: "grid",
                  placeItems: "center",
                }}
              >
                {playing ? "❚❚" : "▶"}
              </button>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    height: 6,
                    borderRadius: 99,
                    background: isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.08)",
                    overflow: "hidden",
                    cursor: "pointer",
                  }}
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                    const t = ratio * duration;
                    if (mixAudioRef.current) {
                      mixAudioRef.current.currentTime = t;
                    } else {
                      const beat = beatAudioRef.current;
                      const vocal = vocalAudioRef.current;
                      if (beat) beat.currentTime = t;
                      if (vocal) vocal.currentTime = t;
                    }
                    setProgress(t);
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width: `${duration ? (progress / duration) * 100 : 0}%`,
                      background: "linear-gradient(90deg, #E7A961, #EF4444)",
                      borderRadius: 99,
                      transition: "width 0.1s linear",
                    }}
                  />
                </div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    marginTop: 6,
                    fontSize: 11,
                    color: muted,
                    fontWeight: 600,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  <span>{fmt(progress)}</span>
                  <span>{fmt(duration)}</span>
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={goRealRecord}
              style={{
                marginTop: 14,
                width: "100%",
                padding: "14px 16px",
                borderRadius: 999,
                border: "none",
                background: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)",
                color: text,
                fontWeight: 800,
                fontSize: 14,
                cursor: "pointer",
              }}
            >
              Record the real version →
            </button>
          </div>
        )}

        {/* Setup after clone */}
        {(phase === "ready" || (showSetup && phase !== "preview" && phase !== "generating")) &&
          phase !== "error" && (
            <div
              style={{
                marginTop: 14,
                padding: "14px 14px 12px",
                borderRadius: 16,
                background: card,
                border: `1px solid ${border}`,
                zIndex: 1,
              }}
            >
              <label style={{ fontSize: 11, fontWeight: 700, color: muted, letterSpacing: "0.04em" }}>
                GENRE
              </label>
              <input
                value={genre}
                onChange={(e) => setGenre(e.target.value)}
                style={{
                  width: "100%",
                  marginTop: 6,
                  marginBottom: 12,
                  padding: "12px 14px",
                  borderRadius: 12,
                  border: `1px solid ${border}`,
                  background: isDark ? "rgba(0,0,0,0.25)" : "rgba(255,255,255,0.8)",
                  color: text,
                  fontSize: 15,
                  fontFamily: "inherit",
                }}
              />
              <label style={{ fontSize: 11, fontWeight: 700, color: muted, letterSpacing: "0.04em" }}>
                SHORT LYRICS
              </label>
              <textarea
                value={lyrics}
                onChange={(e) => setLyrics(e.target.value.slice(0, 220))}
                rows={2}
                style={{
                  width: "100%",
                  marginTop: 6,
                  padding: "12px 14px",
                  borderRadius: 12,
                  border: `1px solid ${border}`,
                  background: isDark ? "rgba(0,0,0,0.25)" : "rgba(255,255,255,0.8)",
                  color: text,
                  fontSize: 14,
                  fontFamily: "inherit",
                  resize: "none",
                }}
              />
              {quotaRemaining !== null && quotaRemaining <= 0 ? (
                <button
                  type="button"
                  onClick={goRealRecord}
                  style={{
                    marginTop: 12,
                    width: "100%",
                    padding: "14px",
                    borderRadius: 999,
                    border: "none",
                    background: "linear-gradient(180deg, #F0BC80, #E7A961)",
                    color: "#1A1208",
                    fontWeight: 800,
                    fontSize: 15,
                    cursor: "pointer",
                  }}
                >
                  Record the real version
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void generate()}
                  style={{
                    marginTop: 12,
                    width: "100%",
                    padding: "14px",
                    borderRadius: 999,
                    border: "none",
                    background: "linear-gradient(180deg, #F0BC80, #E7A961)",
                    color: "#1A1208",
                    fontWeight: 800,
                    fontSize: 15,
                    cursor: "pointer",
                    boxShadow: "0 8px 24px rgba(231,169,97,0.3)",
                  }}
                >
                  Generate chorus preview
                </button>
              )}
            </div>
          )}

        {/* Record controls — hide in preview */}
        {phase !== "preview" && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 36,
              marginTop: 20,
              zIndex: 1,
            }}
          >
            <label
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 6,
                cursor:
                  phase === "recording" || phase === "uploading" || phase === "cloning"
                    ? "default"
                    : "pointer",
                opacity:
                  phase === "recording" || phase === "uploading" || phase === "cloning" ? 0.35 : 1,
              }}
            >
              <span
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 999,
                  background: card,
                  border: `1px solid ${border}`,
                  display: "grid",
                  placeItems: "center",
                  fontSize: 18,
                }}
              >
                ↑
              </span>
              <span style={{ fontSize: 11, color: muted, fontWeight: 600 }}>Upload</span>
              <input
                type="file"
                accept="audio/*,.wav,.mp3,.m4a,.webm"
                hidden
                disabled={
                  phase === "recording" ||
                  phase === "uploading" ||
                  phase === "cloning" ||
                  phase === "generating"
                }
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onFile(f);
                }}
              />
            </label>

            <button
              type="button"
              onClick={() => {
                if (phase === "recording") void stopAndUpload();
                else if (
                  phase === "idle" ||
                  phase === "error" ||
                  phase === "ready"
                )
                  void startRecord();
              }}
              disabled={
                !sessionId ||
                phase === "uploading" ||
                phase === "cloning" ||
                phase === "generating"
              }
              style={{
                width: 80,
                height: 80,
                borderRadius: 999,
                border: phase === "recording" ? "3px solid rgba(255,255,255,0.9)" : "none",
                background:
                  phase === "recording"
                    ? "#DC2626"
                    : "radial-gradient(circle at 35% 30%, #F87171, #EF4444 55%, #B91C1C)",
                boxShadow:
                  phase === "recording"
                    ? "0 0 0 8px rgba(239,68,68,0.25), 0 12px 32px rgba(239,68,68,0.45)"
                    : "0 12px 36px rgba(239,68,68,0.4)",
                cursor: "pointer",
                transition: "transform 0.15s ease, box-shadow 0.2s ease",
                transform: phase === "recording" ? "scale(0.92)" : "scale(1)",
                animation:
                  phase === "recording" ? "tryItPulse 1.4s ease-in-out infinite" : undefined,
              }}
              aria-label={phase === "recording" ? "Stop recording" : "Start recording"}
            />

            <button
              type="button"
              onClick={() => router.push("/app?tab=library")}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 6,
                background: "none",
                border: "none",
                color: "inherit",
                cursor: "pointer",
              }}
            >
              <span
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 999,
                  background: card,
                  border: `1px solid ${border}`,
                  display: "grid",
                  placeItems: "center",
                  fontSize: 16,
                }}
              >
                ▤
              </span>
              <span style={{ fontSize: 11, color: muted, fontWeight: 600 }}>Library</span>
            </button>
          </div>
        )}

        {phase === "error" && (
          <button
            type="button"
            onClick={() => {
              setPhase("idle");
              setMsg(null);
            }}
            style={{
              marginTop: 16,
              width: "100%",
              padding: "12px",
              borderRadius: 999,
              border: `1px solid ${border}`,
              background: card,
              color: text,
              fontWeight: 700,
              cursor: "pointer",
              zIndex: 1,
            }}
          >
            Try again
          </button>
        )}

        <style>{`
          @keyframes tryItPulse {
            0%, 100% { box-shadow: 0 0 0 6px rgba(239,68,68,0.2), 0 12px 32px rgba(239,68,68,0.4); }
            50% { box-shadow: 0 0 0 14px rgba(239,68,68,0.12), 0 12px 32px rgba(239,68,68,0.5); }
          }
        `}</style>
      </div>
    </AppShell>
  );
}
