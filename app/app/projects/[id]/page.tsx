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

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
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
    setTasks((prev) => prev.map((t) => (t.id === current.id ? { ...t, status: "completed" } : t)));
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
            <div style={styles.cardLabel}>Your beat</div>
            <audio controls src={beatUrl} style={{ width: "100%" }} />
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
                <audio controls src={masterUrl} style={{ width: "100%" }} />
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
              <audio
                controls
                src={localBlobUrl || lastTake?.audio_url || undefined}
                style={{ width: "100%", marginTop: 12 }}
              />
            )}
            <div style={styles.actions}>
              <button
                type="button"
                style={styles.secondary}
                disabled={uploading}
                onClick={() => {
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
