"use client";

/**
 * Try It — isolated voice-clone preview.
 * Does not share state with Booth Record pipeline.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { useTheme } from "@/lib/theme";

type Phase = "idle" | "recording" | "uploading" | "cloning" | "ready" | "generating" | "preview" | "error";

export default function TryItPage() {
  const router = useRouter();
  const { colors: C } = useTheme();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [quotaRemaining, setQuotaRemaining] = useState<number | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [msg, setMsg] = useState<string | null>(null);
  const [genre, setGenre] = useState("afrobeats");
  const [lyrics, setLyrics] = useState(
    "Yeah this is my sound, riding on the beat, feel the night, feel the heat"
  );
  const [beatUrl, setBeatUrl] = useState<string | null>(null);
  const [vocalUrl, setVocalUrl] = useState<string | null>(null);
  const [level, setLevel] = useState(0);

  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const startedAtRef = useRef(0);
  const beatAudioRef = useRef<HTMLAudioElement | null>(null);
  const vocalAudioRef = useRef<HTMLAudioElement | null>(null);
  const rafRef = useRef(0);

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
    };
  }, []);

  const stopMeter = () => {
    cancelAnimationFrame(rafRef.current);
    setLevel(0);
  };

  const startRecord = useCallback(async () => {
    setMsg(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
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
      rec.start(200);
      setPhase("recording");

      // simple level meter
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
        setLevel(Math.min(1, s / (data.length * 180)));
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
    const durationMs = Date.now() - startedAtRef.current;
    await new Promise<void>((resolve) => {
      rec.onstop = () => resolve();
      rec.stop();
    });
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;

    if (durationMs < 10_000) {
      setMsg("Keep singing for at least 10 seconds");
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
    setMsg("Uploading sample…");
    try {
      const fd = new FormData();
      fd.append("file", blob, "try-it-sample.webm");
      fd.append("duration_ms", String(durationMs));
      setPhase("cloning");
      setMsg("Cloning your voice (trial only)…");
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
      setMsg("Voice ready — pick a vibe and generate a preview");
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
      setMsg("Cloning your voice (trial only)…");
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
      setMsg("Voice ready — generate a preview");
    } catch {
      setPhase("error");
      setMsg("Could not read that audio file");
    }
  };

  const generate = async () => {
    if (!sessionId) return;
    if (quotaRemaining !== null && quotaRemaining <= 0) {
      setPhase("error");
      setMsg("You've used your free Try It previews. Record the real version in Booth to continue.");
      return;
    }
    setPhase("generating");
    setMsg("Building a short draft preview (~18s)…");
    try {
      const res = await fetch(`/api/try-it/session/${sessionId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ genre, lyrics, tempo: 100 }),
      });
      const j = await res.json().catch(() => ({}));
      if (j.quota && typeof j.quota.remaining === "number") {
        setQuotaRemaining(j.quota.remaining);
      }
      if (!res.ok) {
        setPhase("error");
        setMsg(
          typeof j.error === "string"
            ? j.error
            : "Generate failed"
        );
        return;
      }
      setBeatUrl(j.preview?.beat_url || null);
      setVocalUrl(j.preview?.vocal_url || null);
      setPhase("preview");
      setMsg("Draft preview only (~18s) — not downloadable. Record the real version when ready.");
    } catch {
      setPhase("error");
      setMsg("Generate failed");
    }
  };

  useEffect(() => {
    if (phase !== "preview" || !beatUrl || !vocalUrl) return;
    const beat = new Audio(beatUrl);
    const vocal = new Audio(vocalUrl);
    beat.volume = 0.75;
    vocal.volume = 1;
    beatAudioRef.current = beat;
    vocalAudioRef.current = vocal;
    void beat.play().catch(() => undefined);
    void vocal.play().catch(() => undefined);
    return () => {
      beat.pause();
      vocal.pause();
    };
  }, [phase, beatUrl, vocalUrl]);

  const goRealRecord = () => {
    // Discard stays server-side on next expire; deep-link Booth with genre only
    router.push(`/app/studio?tryIt=1&genre=${encodeURIComponent(genre)}`);
  };

  const bars = Array.from({ length: 48 }, (_, i) => {
    const wave =
      phase === "recording"
        ? 0.25 + level * (0.5 + 0.5 * Math.sin(i * 0.4 + level * 8))
        : phase === "preview"
          ? 0.35 + 0.4 * Math.abs(Math.sin(i * 0.35))
          : 0.15 + 0.1 * Math.abs(Math.sin(i * 0.2));
    return wave;
  });

  return (
    <AppShell>
      <div
        style={{
          minHeight: "100dvh",
          background: C.bg || "#0B0A0F",
          color: C.text || "#F4F1EC",
          fontFamily: "system-ui, sans-serif",
          display: "flex",
          flexDirection: "column",
          padding: "16px 16px max(24px, env(safe-area-inset-bottom))",
          maxWidth: 480,
          margin: "0 auto",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
          <Link href="/app" style={{ color: C.textMuted || "#9B96A3", textDecoration: "none", fontSize: 14 }}>
            ← Back
          </Link>
          <span style={{ flex: 1, textAlign: "center", fontWeight: 700, fontSize: 15, opacity: 0.9 }}>
            Try It
          </span>
          <span style={{ width: 48 }} />
        </div>

        <p style={{ textAlign: "center", fontSize: 18, fontWeight: 600, margin: "12px 0 8px", opacity: 0.95 }}>
          Sing or rap your favorite song
        </p>
        <p style={{ textAlign: "center", fontSize: 12, color: C.textMuted || "#9B96A3", margin: "0 0 24px" }}>
          10s–2 min sample · temp clone · ~18s draft preview · 2 free generates max
        </p>

        {/* Waveform visual */}
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            minHeight: 160,
            gap: 3,
            padding: "0 8px",
          }}
        >
          {bars.map((h, i) => (
            <div
              key={i}
              style={{
                width: 4,
                height: `${Math.round(h * 100)}%`,
                maxHeight: 120,
                minHeight: 8,
                borderRadius: 2,
                background: `linear-gradient(180deg, #FBBF24, #F97316, #EF4444)`,
                opacity: 0.85,
              }}
            />
          ))}
        </div>

        {msg ? (
          <p
            style={{
              textAlign: "center",
              fontSize: 13,
              color: phase === "error" ? "#F07167" : C.textMuted || "#9B96A3",
              margin: "8px 0 16px",
              lineHeight: 1.4,
            }}
          >
            {msg}
          </p>
        ) : null}

        {(phase === "ready" || phase === "generating" || phase === "preview") && (
          <div style={{ marginBottom: 16, display: "y 10px" }}>
            <label style={{ fontSize: 12, color: C.textMuted }}>Genre</label>
            <input
              value={genre}
              onChange={(e) => setGenre(e.target.value)}
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 12,
                border: `1px solid ${C.border || "rgba(255,255,255,0.12)"}`,
                background: "rgba(255,255,255,0.04)",
                color: "inherit",
                fontSize: 14,
              }}
            />
            <label style={{ fontSize: 12, color: C.textMuted }}>Short lyrics (hook)</label>
            <textarea
              value={lyrics}
              onChange={(e) => setLyrics(e.target.value)}
              rows={2}
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 12,
                border: `1px solid ${C.border || "rgba(255,255,255,0.12)"}`,
                background: "rgba(255,255,255,0.04)",
                color: "inherit",
                fontSize: 14,
                resize: "vertical",
              }}
            />
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 28 }}>
          <label
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 6,
              cursor: phase === "recording" ? "default" : "pointer",
              opacity: phase === "recording" ? 0.4 : 1,
            }}
          >
            <span
              style={{
                width: 44,
                height: 44,
                borderRadius: 999,
                background: "rgba(255,255,255,0.08)",
                display: "grid",
                placeItems: "center",
                fontSize: 18,
              }}
            >
              ↑
            </span>
            <span style={{ fontSize: 11, color: C.textMuted }}>Upload</span>
            <input
              type="file"
              accept="audio/*,.wav,.mp3,.m4a,.webm"
              hidden
              disabled={phase === "recording" || phase === "uploading" || phase === "cloning"}
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
              else if (phase === "idle" || phase === "error" || phase === "ready") void startRecord();
            }}
            disabled={
              !sessionId ||
              phase === "uploading" ||
              phase === "cloning" ||
              phase === "generating"
            }
            style={{
              width: 72,
              height: 72,
              borderRadius: 999,
              border: "none",
              background: phase === "recording" ? "#DC2626" : "#EF4444",
              boxShadow: "0 8px 28px rgba(239,68,68,0.45)",
              cursor: "pointer",
            }}
            aria-label={phase === "recording" ? "Stop" : "Record"}
          />

          <button
            type="button"
            onClick={() => router.push("/app")}
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
                width: 44,
                height: 44,
                borderRadius: 999,
                background: "rgba(255,255,255,0.08)",
                display: "grid",
                placeItems: "center",
                fontSize: 16,
              }}
            >
              ▤
            </span>
            <span style={{ fontSize: 11, color: C.textMuted }}>Library</span>
          </button>
        </div>

        <p style={{ textAlign: "center", fontSize: 13, marginTop: 14, color: C.textMuted }}>
          {phase === "recording"
            ? "Recording… tap the red button to stop"
            : phase === "idle"
              ? "Tap to Record"
              : phase === "ready"
                ? "Voice cloned (trial)"
                : phase === "preview"
                  ? "Playing preview"
                  : phase}
        </p>

        {phase === "ready" && quotaRemaining !== null && quotaRemaining <= 0 ? (
          <div style={{ marginTop: 16, space: "y 10px" }}>
            <p style={{ textAlign: "center", fontSize: 13, color: C.textMuted, lineHeight: 1.4 }}>
              You&apos;ve used your free Try It previews. Continue in the real Record flow.
            </p>
            <button
              type="button"
              onClick={goRealRecord}
              style={{
                width: "100%",
                padding: "14px 16px",
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
          </div>
        ) : null}

        {phase === "ready" && (quotaRemaining === null || quotaRemaining > 0) && (
          <button
            type="button"
            onClick={() => void generate()}
            style={{
              marginTop: 16,
              width: "100%",
              padding: "14px 16px",
              borderRadius: 999,
              border: "none",
              background: "linear-gradient(180deg, #F0BC80, #E7A961)",
              color: "#1A1208",
              fontWeight: 800,
              fontSize: 15,
              cursor: "pointer",
            }}
          >
            Generate draft preview (~18s)
          </button>
        )}

        {phase === "preview" && (
          <div style={{ marginTop: 16, display: "y 10px" }}>
            <button
              type="button"
              onClick={goRealRecord}
              style={{
                width: "100%",
                padding: "14px 16px",
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
            <p style={{ textAlign: "center", fontSize: 11, color: C.textMuted, margin: 0 }}>
              No download or share on Try It previews. Trial voice is not saved to your artist profile.
            </p>
          </div>
        )}
      </div>
    </AppShell>
  );
}
