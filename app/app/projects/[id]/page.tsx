"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

type Task = {
  id: string;
  type: string;
  title?: string | null;
  instruction: string;
  reason?: string | null;
  status: string;
  required: boolean;
  start_ms: number | null;
  end_ms: number | null;
  metadata?: { section_label?: string; vocal_part?: string; production_type?: string };
};

type Take = {
  id: string;
  take_number: number;
  audio_url?: string | null;
  duration_ms?: number | null;
  is_selected?: boolean;
};

const PLAYER = {
  signal: "#7BEBD4",
  brass: "#E7A961",
  waveMuted: "rgba(255,255,255,0.14)",
  textFaint: "#5C5866",
};

function seededRandom(seed: string) {
  let s = 0;
  for (let i = 0; i < seed.length; i++) s = (s * 31 + seed.charCodeAt(i)) >>> 0;
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return (s & 0xfffffff) / 0xfffffff;
  };
}

function makeWave(seed: string, n = 48) {
  const rnd = seededRandom(seed);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const base = 0.35 + 0.3 * Math.sin(i / 3.1 + seed.length) + rnd() * 0.35;
    out.push(Math.max(0.12, Math.min(1, base)));
  }
  return out;
}

function fmtClock(sec: number) {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function Waveform({
  bars,
  progress = 0,
  height = 48,
  color = PLAYER.signal,
  muted = PLAYER.waveMuted,
  gap = 3,
  onSeek,
}: {
  bars: number[];
  progress?: number;
  height?: number;
  color?: string;
  muted?: string;
  gap?: number;
  onSeek?: (ratio: number) => void;
}) {
  return (
    <div
      role={onSeek ? "slider" : undefined}
      onClick={(e) => {
        if (!onSeek) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
        onSeek(ratio);
      }}
      style={{
        display: "flex",
        alignItems: "center",
        gap,
        height,
        width: "100%",
        cursor: onSeek ? "pointer" : "default",
      }}
    >
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
              transition: "background 180ms ease, box-shadow 180ms ease",
            }}
          />
        );
      })}
    </div>
  );
}

function StudioPlayer({
  src,
  label,
  seed = "studio",
  accent = PLAYER.signal,
  compact = false,
}: {
  src: string;
  label?: string;
  seed?: string;
  accent?: string;
  compact?: boolean;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const bars = useMemo(() => makeWave(seed + (src || ""), compact ? 36 : 48), [seed, src, compact]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onTime = () => setTime(el.currentTime || 0);
    const onMeta = () => setDuration(el.duration || 0);
    const onEnded = () => setPlaying(false);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("loadedmetadata", onMeta);
    el.addEventListener("durationchange", onMeta);
    el.addEventListener("ended", onEnded);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("loadedmetadata", onMeta);
      el.removeEventListener("durationchange", onMeta);
      el.removeEventListener("ended", onEnded);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
    };
  }, [src]);

  async function toggle() {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) {
      try {
        await el.play();
      } catch {
        /* ignore */
      }
    } else {
      el.pause();
    }
  }

  function seek(ratio: number) {
    const el = audioRef.current;
    if (!el || !duration) return;
    el.currentTime = ratio * duration;
    setTime(el.currentTime);
  }

  const progress = duration > 0 ? time / duration : 0;
  const h = compact ? 36 : 48;

  return (
    <div style={{ width: "100%" }}>
      <audio ref={audioRef} src={src} preload="metadata" style={{ display: "none" }} />
      {label && (
        <div
          style={{
            fontSize: 11,
            letterSpacing: 1.2,
            textTransform: "uppercase",
            color: PLAYER.textFaint,
            marginBottom: 10,
            fontWeight: 600,
          }}
        >
          {label}
        </div>
      )}
      <Waveform bars={bars} progress={progress} height={h} color={accent} onSeek={seek} />
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 10 }}>
        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? "Pause" : "Play"}
          style={{
            width: compact ? 40 : 44,
            height: compact ? 40 : 44,
            borderRadius: 999,
            border: "none",
            background: `linear-gradient(180deg, #F0BC80, ${PLAYER.brass})`,
            color: "#1A1208",
            display: "grid",
            placeItems: "center",
            cursor: "pointer",
            flexShrink: 0,
            boxShadow: "0 6px 18px -6px rgba(231,169,97,0.5)",
          }}
        >
          {playing ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="4" width="4" height="16" rx="1" />
              <rect x="14" y="4" width="4" height="16" rx="1" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7L8 5z" />
            </svg>
          )}
        </button>
        <div
          style={{
            flex: 1,
            display: "flex",
            justifyContent: "space-between",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: 11,
            color: PLAYER.textFaint,
          }}
        >
          <span>{fmtClock(time)}</span>
          <span>{fmtClock(duration)}</span>
        </div>
      </div>
    </div>
  );
}

export default function ProjectDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const [beatUrl, setBeatUrl] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [phase, setPhase] = useState<"task" | "recording" | "review" | "done">("task");
  const [producerNote, setProducerNote] = useState(
    "I'll guide you one part at a time. You just listen and perform."
  );
  const [producing, setProducing] = useState(false);
  const [masterUrl, setMasterUrl] = useState<string | null>(null);
  const [downloadName, setDownloadName] = useState("studio-song-master.wav");
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [localBlobUrl, setLocalBlobUrl] = useState<string | null>(null);
  const [lastTake, setLastTake] = useState<Take | null>(null);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [completedCount, setCompletedCount] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const previewAudiosRef = useRef<HTMLAudioElement[]>([]);
  const previewTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const beatAudioRef = useRef<HTMLAudioElement | null>(null);
  const startedAtRef = useRef(0);

  const load = useCallback(async () => {
    try {
      const [statusRes, beatRes, tasksRes] = await Promise.all([
        fetch(`/api/projects/${id}/status`),
        fetch(`/api/projects/${id}/beat`),
        fetch(`/api/projects/${id}/recording-tasks`),
      ]);
      if (statusRes.ok) setStatus((await statusRes.json()).project?.status || "");
      if (beatRes.ok) setBeatUrl((await beatRes.json()).audio_url || null);
      if (tasksRes.ok) {
        const list = (await tasksRes.json()).tasks || [];
        setTasks(list);
        setCompletedCount(list.filter((t: Task) => t.status === "completed").length);
        if (list.length && list.every((t: Task) => t.status === "completed")) {
          setPhase("done");
          setProducerNote("That's enough. Let's put everything together.");
        }
      }
      const dlRes = await fetch(`/api/projects/${id}/download?kind=master`);
      if (dlRes.ok) {
        const j = await dlRes.json();
        if (j.download_url) {
          setMasterUrl(j.download_url);
          if (j.filename) setDownloadName(j.filename);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load project");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const pending = useMemo(
    () => tasks.filter((t) => t.status === "pending" || t.status === "in_progress"),
    [tasks]
  );
  const current = pending[0] || null;

  function pickMimeType() {
    for (const t of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]) {
      if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) return t;
    }
    return "audio/webm";
  }

  function stopSessionPreview() {
    previewTimersRef.current.forEach(clearTimeout);
    previewTimersRef.current = [];
    previewAudiosRef.current.forEach((a) => {
      try {
        a.pause();
        a.src = "";
      } catch {
        /* ignore */
      }
    });
    previewAudiosRef.current = [];
    if (beatAudioRef.current) {
      beatAudioRef.current.pause();
      beatAudioRef.current.volume = 1;
    }
    setPreviewPlaying(false);
  }

  useEffect(() => {
    return () => {
      previewTimersRef.current.forEach(clearTimeout);
      previewAudiosRef.current.forEach((a) => {
        try {
          a.pause();
          a.src = "";
        } catch {
          /* ignore */
        }
      });
    };
  }, []);

  async function playSessionSoFar() {
    if (previewPlaying) {
      stopSessionPreview();
      return;
    }
    setError(null);
    setPreviewLoading(true);
    try {
      const res = await fetch(`/api/projects/${id}/session-preview`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not load session preview");

      const beatSrc: string | null = data.beat_url || beatUrl;
      if (!beatSrc) throw new Error("No beat available yet");

      stopSessionPreview();

      const beat = new Audio(beatSrc);
      beat.volume = 0.5;
      beat.preload = "auto";
      previewAudiosRef.current.push(beat);

      const layers: Array<{ audio_url: string; start_ms: number }> = [...(data.layers || [])];
      if (localBlobUrl && current) {
        layers.push({ audio_url: localBlobUrl, start_ms: current.start_ms ?? 0 });
      }

      for (const layer of layers) {
        if (!layer.audio_url) continue;
        const v = new Audio(layer.audio_url);
        v.volume = 0.95;
        v.preload = "auto";
        previewAudiosRef.current.push(v);
      }

      await Promise.all(
        previewAudiosRef.current.map(
          (a) =>
            new Promise<void>((resolve) => {
              if (a.readyState >= 2) return resolve();
              a.addEventListener("canplaythrough", () => resolve(), { once: true });
              a.addEventListener("error", () => resolve(), { once: true });
              a.load();
            })
        )
      );

      beat.currentTime = 0;
      await beat.play();
      setPreviewPlaying(true);
      setProducerNote(
        layers.length
          ? `Playing what you have so far — beat + ${layers.length} vocal part${layers.length === 1 ? "" : "s"}.`
          : "Playing the beat. Record a take to hear your voice with it."
      );

      layers.forEach((layer, idx) => {
        const vocal = previewAudiosRef.current[idx + 1];
        if (!vocal) return;
        const delay = Math.max(0, layer.start_ms || 0);
        const t = setTimeout(() => {
          vocal.currentTime = 0;
          vocal.play().catch(() => undefined);
        }, delay);
        previewTimersRef.current.push(t);
      });

      beat.onended = () => stopSessionPreview();
    } catch (e) {
      stopSessionPreview();
      setError(e instanceof Error ? e.message : "Could not play session preview");
    } finally {
      setPreviewLoading(false);
    }
  }

  async function playSection() {
    if (!beatUrl || !beatAudioRef.current) return;
    const el = beatAudioRef.current;
    const start = (current?.start_ms ?? 0) / 1000;
    const end = (current?.end_ms ?? 0) / 1000;
    el.currentTime = start;
    await el.play().catch(() => undefined);
    if (end > start) {
      const onTime = () => {
        if (el.currentTime >= end) {
          el.pause();
          el.removeEventListener("timeupdate", onTime);
        }
      };
      el.addEventListener("timeupdate", onTime);
    }
  }

  async function startRecording() {
    setError(null);
    stopSessionPreview();
    if (!current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;
      chunksRef.current = [];
      const mime = pickMimeType();
      const recorder = new MediaRecorder(stream, { mimeType: mime });
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (e) => {
        if (e.data?.size) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        if (timerRef.current) clearInterval(timerRef.current);
        streamRef.current?.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: mime.split(";")[0] });
        const url = URL.createObjectURL(blob);
        setLocalBlobUrl(url);
        setPhase("review");
        setProducerNote("Nice. Let's hear that take.");
        await uploadTake(blob, Date.now() - startedAtRef.current);
      };
      startedAtRef.current = Date.now();
      setRecordSeconds(0);
      timerRef.current = setInterval(() => {
        setRecordSeconds(Math.floor((Date.now() - startedAtRef.current) / 1000));
      }, 250);
      if (beatAudioRef.current && beatUrl) {
        const el = beatAudioRef.current;
        el.currentTime = (current.start_ms ?? 0) / 1000;
        el.volume = 0.55;
        el.play().catch(() => undefined);
      }
      recorder.start(250);
      setPhase("recording");
      setProducerNote("Recording — sing with the beat. Stop when you're done.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not access microphone.");
    }
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop();
    beatAudioRef.current?.pause();
  }

  async function uploadTake(blob: Blob, durationMs: number) {
    if (!current) return;
    setUploading(true);
    try {
      const form = new FormData();
      const ext = blob.type.includes("mp4") ? "mp4" : "webm";
      form.append("file", blob, `take.${ext}`);
      form.append("duration_ms", String(Math.max(0, Math.round(durationMs))));
      const res = await fetch(`/api/recording-tasks/${current.id}/recordings`, {
        method: "POST",
        body: form,
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "Upload failed");
      setLastTake(j.recording);
      if (j.recording?.id) {
        await fetch(`/api/recording-tasks/${current.id}/recordings/${j.recording.id}/select`, {
          method: "POST",
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save take");
    } finally {
      setUploading(false);
    }
  }

  function keepAndContinue() {
    if (!current) return;
    stopSessionPreview();
    setTasks((prev) => {
      const next = prev.map((t) => (t.id === current.id ? { ...t, status: "completed" } : t));
      setCompletedCount(next.filter((t) => t.status === "completed").length);
      return next;
    });
    setLocalBlobUrl(null);
    setLastTake(null);
    const remaining = pending.filter((t) => t.id !== current.id);
    if (remaining.length === 0) {
      setPhase("done");
      setProducerNote("That's enough. Let's put everything together.");
      return;
    }
    setPhase("task");
    setProducerNote("Got it. Here's what the song needs next.");
  }

  async function startProduce() {
    setProducing(true);
    setError(null);
    setProducerNote("Putting your song together…");
    try {
      const res = await fetch(`/api/projects/${id}/produce`, { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "Produce failed");
      for (let i = 0; i < 10; i++) {
        await new Promise((r) => setTimeout(r, 700));
        const st = await fetch(`/api/projects/${id}/produce`);
        if (st.ok) {
          const s = await st.json();
          if (s.project_status === "complete" || s.job?.status === "complete") {
            setStatus("complete");
            const dl = await fetch(`/api/projects/${id}/download?kind=master`);
            if (dl.ok) {
              const d = await dl.json();
              if (d.download_url) {
                setMasterUrl(d.download_url);
                if (d.filename) setDownloadName(d.filename);
              }
            }
            setProducerNote("Your song is ready.");
            break;
          }
          if (s.job?.status === "failed") throw new Error(s.job.error || "Production failed");
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not produce song");
    } finally {
      setProducing(false);
    }
  }

  async function downloadSong() {
    const res = await fetch(`/api/projects/${id}/download?kind=master`);
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.download_url) {
      setError(j.error || "Download not available yet");
      return;
    }
    const a = document.createElement("a");
    a.href = j.download_url;
    a.download = j.filename || "studio-song-master.wav";
    a.target = "_blank";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function humanTitle(type: string) {
    const t = type.toLowerCase();
    if (t.includes("double")) return "Sing it again (thicker)";
    if (t.includes("harmony")) return "Harmony line";
    if (t.includes("adlib")) return "Ad-libs / answers";
    return "Lead vocal";
  }

  function formatTime(sec: number) {
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
  }

  if (loading) {
    return (
      <div style={styles.page}>
        <p style={styles.sub}>Loading your producer session…</p>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <Link href="/app" style={styles.back}>
          ← Projects
        </Link>
        <span style={styles.badge}>{status || "session"}</span>
      </header>
      {beatUrl && <audio ref={beatAudioRef} src={beatUrl} preload="auto" style={{ display: "none" }} />}
      <main style={styles.main}>
        <p style={styles.producer}>{producerNote}</p>
        {error && <div style={styles.error}>{error}</div>}
        {beatUrl && phase !== "recording" && (
          <section style={styles.card}>
            <StudioPlayer src={beatUrl} label="Your beat" seed={`beat-${id}`} accent={PLAYER.brass} />
            <div style={{ marginTop: 14, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
              <button
                type="button"
                style={previewPlaying ? styles.danger : styles.secondary}
                disabled={previewLoading || !beatUrl}
                onClick={playSessionSoFar}
              >
                {previewLoading
                  ? "Loading…"
                  : previewPlaying
                    ? "Stop preview"
                    : completedCount > 0 || localBlobUrl
                      ? "Hear what you have so far"
                      : "Hear beat only"}
              </button>
              <span style={{ fontSize: 12, color: "#71717a" }}>
                {completedCount > 0
                  ? `${completedCount} kept take${completedCount === 1 ? "" : "s"} + beat`
                  : "After your first keep, this plays your voice with the beat"}
              </span>
            </div>
          </section>
        )}
        {phase === "done" || (!current && phase !== "recording" && phase !== "review") ? (
          <section style={styles.focus}>
            <h1 style={styles.h1}>
              {masterUrl || status === "complete" ? "Your song is ready" : "Your performances are in"}
            </h1>
            <p style={styles.sub}>
              {masterUrl || status === "complete"
                ? "Play it back, then download your master."
                : "Next we'll arrange, clean, mix, and master."}
            </p>
            <div style={styles.progress}>
              {tasks.filter((t) => t.status === "completed").length} of {tasks.length} parts captured
            </div>
            {masterUrl && (
              <div style={{ marginTop: 16 }}>
                <StudioPlayer src={masterUrl} label="Final song" seed={`master-${id}`} accent={PLAYER.signal} />
              </div>
            )}
            <div style={{ ...styles.actions, marginTop: 16 }}>
              {!masterUrl && (
                <button type="button" style={styles.primary} disabled={producing} onClick={startProduce}>
                  {producing ? "Producing…" : "Produce my song"}
                </button>
              )}
              <button
                type="button"
                style={masterUrl ? styles.primary : styles.secondary}
                disabled={producing}
                onClick={downloadSong}
              >
                Download song
              </button>
              {(completedCount > 0 || localBlobUrl) && (
                <button type="button" style={styles.secondary} disabled={previewLoading} onClick={playSessionSoFar}>
                  {previewPlaying ? "Stop preview" : "Hear raw session"}
                </button>
              )}
            </div>
            {masterUrl && <p style={styles.hint}>File: {downloadName}</p>}
          </section>
        ) : phase === "recording" ? (
          <section style={styles.focus}>
            <div style={styles.cardLabel}>{current?.metadata?.section_label || "Section"} · recording</div>
            <h1 style={styles.h1}>{formatTime(recordSeconds)}</h1>
            <p style={styles.sub}>Sing along with the beat. Stop when the part is done.</p>
            <div style={styles.actions}>
              <button type="button" style={styles.danger} onClick={stopRecording}>
                Stop
              </button>
            </div>
          </section>
        ) : phase === "review" ? (
          <section style={styles.focus}>
            <div style={styles.cardLabel}>{current?.metadata?.section_label || "Section"} · take review</div>
            <h1 style={styles.h1}>{uploading ? "Saving your take…" : "How does it feel?"}</h1>
            <p style={styles.sub}>Keep it if it feels right — or try again.</p>
            {(localBlobUrl || lastTake?.audio_url) && (
              <div style={{ marginTop: 14 }}>
                <StudioPlayer
                  src={(localBlobUrl || lastTake?.audio_url)!}
                  label="Your take"
                  seed={`take-${current?.id || "x"}`}
                  accent={PLAYER.signal}
                  compact
                />
              </div>
            )}
            <div style={styles.actions}>
              <button
                type="button"
                style={styles.secondary}
                disabled={uploading || previewLoading}
                onClick={playSessionSoFar}
              >
                {previewPlaying ? "Stop mix" : "Play with beat"}
              </button>
              <button
                type="button"
                style={styles.secondary}
                disabled={uploading}
                onClick={() => {
                  stopSessionPreview();
                  setLocalBlobUrl(null);
                  setLastTake(null);
                  setPhase("task");
                }}
              >
                Try again
              </button>
              <button type="button" style={styles.primary} disabled={uploading} onClick={keepAndContinue}>
                Keep & continue
              </button>
            </div>
          </section>
        ) : (
          <section style={styles.focus}>
            <div style={styles.cardLabel}>
              {current?.metadata?.section_label || "Section"}
              {current?.required ? " · essential" : " · optional"}
            </div>
            <h1 style={styles.h1}>{current?.title || humanTitle(current?.type || "lead")}</h1>
            <p style={styles.instruction}>{current?.instruction}</p>
            {current?.reason && <p style={styles.reason}>{current.reason}</p>}
            <div style={styles.actions}>
              <button type="button" style={styles.secondary} disabled={!beatUrl} onClick={playSection}>
                Hear section
              </button>
              <button type="button" style={styles.primary} onClick={startRecording}>
                Record
              </button>
            </div>
            <p style={styles.hint}>{pending.length} left in plan</p>
          </section>
        )}
        <section style={{ marginTop: 36 }}>
          <h2 style={styles.h2}>Session plan</h2>
          <div style={styles.list}>
            {tasks.map((t, i) => (
              <div key={t.id} style={{ ...styles.taskRow, opacity: t.status === "completed" ? 0.45 : 1 }}>
                <span style={styles.num}>{String(i + 1).padStart(2, "0")}</span>
                <div>
                  <strong>
                    {t.title || humanTitle(t.type)}
                    {t.status === "completed" ? " ✓" : ""}
                  </strong>
                  <div style={styles.meta}>
                    {t.metadata?.section_label || "—"} · {t.required ? "essential" : "if needed"}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: "100vh", background: "#0a0a0c", color: "#f5f5f7", fontFamily: "system-ui, sans-serif" },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "16px 24px",
    borderBottom: "1px solid #1c1c22",
  },
  back: { color: "#a1a1aa", textDecoration: "none", fontSize: 14 },
  badge: {
    fontSize: 12,
    padding: "4px 10px",
    borderRadius: 999,
    background: "#1c1c22",
    color: "#a1a1aa",
    textTransform: "uppercase",
  },
  main: { maxWidth: 720, margin: "0 auto", padding: "28px 20px 80px" },
  producer: { fontSize: 15, color: "#c4b5fd", marginBottom: 20, lineHeight: 1.5 },
  card: { background: "#121216", border: "1px solid #1c1c22", borderRadius: 14, padding: 16, marginBottom: 20 },
  cardLabel: { fontSize: 12, color: "#71717a", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 8 },
  focus: {
    background: "linear-gradient(180deg, #14141a 0%, #0e0e12 100%)",
    border: "1px solid #22222a",
    borderRadius: 18,
    padding: "28px 22px",
  },
  h1: { fontSize: 28, margin: "0 0 10px" },
  h2: { fontSize: 16, margin: "0 0 6px", color: "#e4e4e7" },
  sub: { color: "#a1a1aa", margin: "0 0 12px", lineHeight: 1.5, fontSize: 15 },
  instruction: { fontSize: 17, lineHeight: 1.55, color: "#f4f4f5", margin: "12px 0" },
  reason: { fontSize: 14, color: "#a78bfa", marginBottom: 16 },
  actions: { display: "flex", gap: 12, flexWrap: "wrap", marginTop: 8 },
  primary: {
    background: "#8b5cf6",
    color: "#fff",
    border: "none",
    borderRadius: 12,
    padding: "12px 20px",
    fontWeight: 600,
    cursor: "pointer",
    fontSize: 15,
  },
  secondary: {
    background: "#1c1c22",
    color: "#e4e4e7",
    border: "1px solid #2a2a32",
    borderRadius: 12,
    padding: "12px 20px",
    fontWeight: 600,
    cursor: "pointer",
    fontSize: 15,
  },
  danger: {
    background: "#dc2626",
    color: "#fff",
    border: "none",
    borderRadius: 12,
    padding: "12px 28px",
    fontWeight: 700,
    cursor: "pointer",
    fontSize: 16,
  },
  hint: { marginTop: 14, fontSize: 13, color: "#71717a" },
  progress: { fontSize: 14, color: "#a1a1aa", marginTop: 8 },
  list: { display: "flex", flexDirection: "column", gap: 8, marginTop: 12 },
  taskRow: {
    display: "flex",
    gap: 12,
    padding: "12px 14px",
    background: "#121216",
    borderRadius: 12,
    border: "1px solid #1c1c22",
  },
  num: { fontFamily: "ui-monospace, monospace", color: "#71717a", fontSize: 13 },
  meta: { fontSize: 12, color: "#71717a", marginTop: 2 },
  error: {
    background: "#3f1d1d",
    color: "#fecaca",
    padding: "12px 14px",
    borderRadius: 12,
    marginBottom: 16,
    fontSize: 14,
  },
};
