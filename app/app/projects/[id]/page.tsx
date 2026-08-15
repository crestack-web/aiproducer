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
  metadata?: { section_label?: string; vocal_part?: string };
};

type ProjectMeta = {
  id: string;
  status: string;
  title?: string | null;
  genre?: string | null;
  mood?: string | null;
  tempo?: number | null;
};

type Screen = "beat" | "analyzing" | "plan" | "session" | "done";

const C = {
  bg: "#0B0A0F",
  bgDeep: "#050508",
  surface: "rgba(255,255,255,0.045)",
  border: "rgba(255,255,255,0.09)",
  brass: "#E7A961",
  brassSoft: "rgba(231,169,97,0.15)",
  signal: "#7BEBD4",
  text: "#F4F1EC",
  textMuted: "#9B96A3",
  textFaint: "#5C5866",
  danger: "#E8756A",
};

function humanTitle(type: string) {
  const t = (type || "").toLowerCase();
  if (t.includes("harmony")) return "Harmony";
  if (t.includes("adlib")) return "Ad-libs";
  if (t.includes("double")) return "Double";
  return "Lead vocal";
}

function sectionLabel(t: Task) {
  return (t.metadata?.section_label || t.title || humanTitle(t.type) || "SECTION").toUpperCase();
}

export default function ProjectDetailPage() {
  const id = useParams().id as string;
  const [project, setProject] = useState<ProjectMeta | null>(null);
  const [beatUrl, setBeatUrl] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [screen, setScreen] = useState<Screen>("beat");
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [producing, setProducing] = useState(false);
  const [masterUrl, setMasterUrl] = useState<string | null>(null);
  const [downloadName, setDownloadName] = useState("studio-song-master.wav");
  const [phase, setPhase] = useState<"ready" | "recording" | "review">("ready");
  const [localBlobUrl, setLocalBlobUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const beatAudioRef = useRef<HTMLAudioElement | null>(null);
  const startedAtRef = useRef(0);

  const pending = useMemo(
    () => tasks.filter((t) => t.status === "pending" || t.status === "in_progress"),
    [tasks]
  );
  const current = pending[0] || null;
  const completedCount = tasks.filter((t) => t.status === "completed").length;

  const load = useCallback(async () => {
    try {
      const [statusRes, beatRes, tasksRes] = await Promise.all([
        fetch(`/api/projects/${id}/status`),
        fetch(`/api/projects/${id}/beat`),
        fetch(`/api/projects/${id}/recording-tasks`),
      ]);

      let proj: ProjectMeta | null = null;
      if (statusRes.ok) {
        const j = await statusRes.json();
        proj = j.project;
        setProject(proj);
      }
      if (beatRes.ok) setBeatUrl((await beatRes.json()).audio_url || null);

      let list: Task[] = [];
      if (tasksRes.ok) {
        list = (await tasksRes.json()).tasks || [];
        setTasks(list);
      }

      const st = proj?.status || "";
      const early =
        !st ||
        st === "draft" ||
        st === "generating_beat" ||
        st === "beat_ready" ||
        st === "analyzing" ||
        st === "blueprint_ready" ||
        st === "recording";

      // Early stages never show a master download
      if (early) {
        setMasterUrl(null);
      } else {
        const dl = await fetch(`/api/projects/${id}/download?kind=master`);
        if (dl.ok) {
          const j = await dl.json();
          const src = String(j.source || "");
          if (
            j.download_url &&
            !src.includes("beat") &&
            (src.startsWith("audio_versions") || src === "songs" || src.includes("master"))
          ) {
            setMasterUrl(j.download_url);
            if (j.filename) setDownloadName(j.filename);
          } else {
            setMasterUrl(null);
          }
        } else {
          setMasterUrl(null);
        }
      }

      // Strict flow: beat → analyze → plan → record → produce → complete
      const allDone = list.length > 0 && list.every((t) => t.status === "completed");
      const inSession =
        list.length > 0 &&
        list.some((t) => t.status === "completed" || t.status === "in_progress") &&
        !allDone;

      if (st === "complete" || st === "processing" || st === "mixing" || st === "mastering") {
        setScreen("done");
      } else if (allDone) {
        setScreen("done");
      } else if (inSession) {
        setScreen("session");
        setPhase("ready");
      } else if (st === "analyzing") {
        setScreen("analyzing");
      } else if (list.length > 0 || st === "blueprint_ready") {
        setScreen("plan");
      } else {
        setScreen("beat");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const st = project?.status || "";
    if (st === "complete" || st === "failed") return;
    if (beatUrl && st !== "generating_beat") return;
    const t = setInterval(() => load(), 2000);
    return () => clearInterval(t);
  }, [project?.status, beatUrl, load]);

  async function startProducerSession() {
    setError(null);
    setAnalyzing(true);
    setScreen("analyzing");
    try {
      const res = await fetch(`/api/projects/${id}/analyze`, { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "Could not build plan");
      const tr = await fetch(`/api/projects/${id}/recording-tasks`);
      if (tr.ok) setTasks((await tr.json()).tasks || []);
      const sr = await fetch(`/api/projects/${id}/status`);
      if (sr.ok) setProject((await sr.json()).project);
      setScreen("plan");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analyze failed");
      setScreen("beat");
    } finally {
      setAnalyzing(false);
    }
  }

  async function startRecording() {
    if (!current) return;
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      let mime = "audio/webm";
      for (const t of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]) {
        if (MediaRecorder.isTypeSupported(t)) {
          mime = t;
          break;
        }
      }
      const rec = new MediaRecorder(stream, { mimeType: mime });
      mediaRecorderRef.current = rec;
      rec.ondataavailable = (e) => {
        if (e.data?.size) chunksRef.current.push(e.data);
      };
      rec.onstop = async () => {
        if (timerRef.current) clearInterval(timerRef.current);
        streamRef.current?.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: mime.split(";")[0] });
        setLocalBlobUrl(URL.createObjectURL(blob));
        setPhase("review");
        setUploading(true);
        try {
          const form = new FormData();
          form.append("file", blob, "take.webm");
          form.append("duration_ms", String(Date.now() - startedAtRef.current));
          const res = await fetch(`/api/recording-tasks/${current.id}/recordings`, {
            method: "POST",
            body: form,
          });
          const j = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(j.error || "Upload failed");
          if (j.recording?.id) {
            await fetch(`/api/recording-tasks/${current.id}/recordings/${j.recording.id}/select`, {
              method: "POST",
            });
          }
        } catch (e) {
          setError(e instanceof Error ? e.message : "Save failed");
        } finally {
          setUploading(false);
        }
      };
      startedAtRef.current = Date.now();
      setRecordSeconds(0);
      timerRef.current = setInterval(
        () => setRecordSeconds(Math.floor((Date.now() - startedAtRef.current) / 1000)),
        250
      );
      if (beatAudioRef.current && beatUrl) {
        beatAudioRef.current.currentTime = (current.start_ms ?? 0) / 1000;
        beatAudioRef.current.volume = 0.55;
        beatAudioRef.current.play().catch(() => undefined);
      }
      rec.start(250);
      setPhase("recording");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Microphone error");
    }
  }

  function keepAndContinue() {
    if (!current) return;
    setTasks((prev) => prev.map((t) => (t.id === current.id ? { ...t, status: "completed" } : t)));
    setLocalBlobUrl(null);
    if (pending.filter((t) => t.id !== current.id).length === 0) setScreen("done");
    else setPhase("ready");
  }

  async function startProduce() {
    setProducing(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${id}/produce`, { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "Produce failed");
      for (let i = 0; i < 15; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        const st = await fetch(`/api/projects/${id}/produce`);
        if (st.ok) {
          const s = await st.json();
          if (s.project_status === "complete" || s.job?.status === "complete") {
            setProject((p) => (p ? { ...p, status: "complete" } : p));
            const dl = await fetch(`/api/projects/${id}/download?kind=master`);
            if (dl.ok) {
              const d = await dl.json();
              if (d.download_url) {
                setMasterUrl(d.download_url);
                if (d.filename) setDownloadName(d.filename);
              }
            }
            break;
          }
          if (s.job?.status === "failed") throw new Error(s.job.error || "Failed");
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Produce failed");
    } finally {
      setProducing(false);
    }
  }

  async function downloadSong() {
    const res = await fetch(`/api/projects/${id}/download?kind=master`);
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.download_url) {
      setError(j.error || "Not ready yet");
      return;
    }
    const a = document.createElement("a");
    a.href = j.download_url;
    a.download = j.filename || downloadName;
    a.target = "_blank";
    a.click();
  }

  const btn: React.CSSProperties = {
    width: "100%",
    padding: "15px 20px",
    borderRadius: 16,
    border: "none",
    background: `linear-gradient(180deg,#F0BC80,${C.brass})`,
    color: "#1A1208",
    fontWeight: 600,
    fontSize: 15.5,
    cursor: "pointer",
    fontFamily: "inherit",
  };
  const btn2: React.CSSProperties = {
    ...btn,
    background: "rgba(255,255,255,0.04)",
    border: `1px solid ${C.border}`,
    color: C.text,
    fontWeight: 500,
  };
  const page: React.CSSProperties = {
    minHeight: "100vh",
    background: `linear-gradient(180deg,${C.bg},${C.bgDeep})`,
    color: C.text,
    fontFamily: "Inter,system-ui,sans-serif",
  };
  const wrap: React.CSSProperties = {
    maxWidth: 520,
    margin: "0 auto",
    padding: "20px 20px 48px",
  };
  const title: React.CSSProperties = {
    fontFamily: "Georgia,serif",
    fontSize: "clamp(1.5rem,4vw,1.85rem)",
    fontWeight: 500,
    margin: "12px 0 0",
  };

  if (loading) {
    return (
      <div style={page}>
        <div style={{ ...wrap, textAlign: "center", paddingTop: 120 }}>
          <p style={{ color: C.textMuted }}>Preparing your session…</p>
        </div>
      </div>
    );
  }

  return (
    <div style={page}>
      {beatUrl && <audio ref={beatAudioRef} src={beatUrl} preload="auto" style={{ display: "none" }} />}

      {screen === "beat" && (
        <div style={wrap}>
          <Link href="/app" style={{ color: C.textMuted, textDecoration: "none", fontSize: 14 }}>
            ← Projects
          </Link>
          <h1 style={title}>{project?.title || "Your beat"}</h1>
          <p style={{ color: C.brass, fontSize: 12, marginTop: 6, fontFamily: "monospace" }}>
            {[project?.genre, project?.tempo ? `${project.tempo} BPM` : null, project?.mood]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {beatUrl ? (
            <div style={{ marginTop: 24 }}>
              <audio controls src={beatUrl} style={{ width: "100%" }} />
            </div>
          ) : (
            <p style={{ color: C.textMuted, marginTop: 24 }}>
              {project?.status === "generating_beat" ? "Composing your beat…" : "Preparing beat…"}
            </p>
          )}
          <p style={{ color: C.textMuted, fontSize: 14, marginTop: 20, textAlign: "center" }}>
            {beatUrl
              ? "Beat ready. Next the AI builds a recording plan — you approve it before recording."
              : "Waiting for beat…"}
          </p>
          {error && (
            <div style={{ marginTop: 12, padding: 12, borderRadius: 12, background: "rgba(255,107,107,0.1)", color: "#ffb4b4", fontSize: 13 }}>
              {error}
            </div>
          )}
          <button type="button" style={{ ...btn, marginTop: 18 }} disabled={analyzing || !beatUrl} onClick={startProducerSession}>
            {analyzing ? "Starting…" : beatUrl ? "Start AI Producer Session" : "Waiting for beat…"}
          </button>
        </div>
      )}

      {screen === "analyzing" && (
        <div style={{ ...wrap, textAlign: "center", paddingTop: 100 }}>
          <h1 style={title}>Building your song plan</h1>
          <p style={{ color: C.textMuted, marginTop: 12 }}>AI is reading the beat and deciding what to record…</p>
          {error && <p style={{ color: C.danger, marginTop: 16 }}>{error}</p>}
        </div>
      )}

      {screen === "plan" && (
        <div style={wrap}>
          <button type="button" onClick={() => setScreen("beat")} style={{ background: "none", border: "none", color: C.textMuted, cursor: "pointer", padding: 0 }}>
            ← Beat
          </button>
          <h1 style={title}>Here's how we'll make your song</h1>
          <p style={{ color: C.textMuted, fontSize: 14, margin: "8px 0 18px" }}>
            Review the plan, then start recording section by section.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {tasks.map((t, i) => (
              <div key={t.id} style={{ padding: 14, borderRadius: 14, background: C.surface, border: `1px solid ${C.border}` }}>
                <div style={{ fontSize: 11, color: C.brass, fontWeight: 600 }}>
                  {String(i + 1).padStart(2, "0")} · {sectionLabel(t)}
                </div>
                <div style={{ fontFamily: "Georgia,serif", fontSize: 16, marginTop: 4 }}>
                  {t.title || humanTitle(t.type)}
                </div>
                <div style={{ fontSize: 13.5, color: C.textMuted, marginTop: 4, lineHeight: 1.45 }}>
                  {t.instruction}
                </div>
              </div>
            ))}
          </div>
          {error && <p style={{ color: C.danger, marginTop: 12 }}>{error}</p>}
          <button
            type="button"
            style={{ ...btn, marginTop: 22 }}
            disabled={!tasks.length}
            onClick={() => {
              setScreen("session");
              setPhase("ready");
            }}
          >
            Start recording session
          </button>
          <button type="button" style={{ ...btn2, marginTop: 8 }} disabled={analyzing} onClick={startProducerSession}>
            Regenerate plan
          </button>
        </div>
      )}

      {screen === "session" && current && (
        <div style={wrap}>
          <button type="button" onClick={() => setScreen("plan")} style={{ background: "none", border: "none", color: C.textMuted, cursor: "pointer" }}>
            ← Plan
          </button>
          <div style={{ textAlign: "center", marginTop: 12 }}>
            <div style={{ fontSize: 11, color: C.brass, fontFamily: "monospace" }}>
              {Math.min(completedCount + 1, tasks.length)} of {tasks.length}
            </div>
            <h1 style={{ ...title, fontSize: "1.5rem" }}>{sectionLabel(current)}</h1>
            <p style={{ color: C.brass, fontSize: 14 }}>{current.reason || humanTitle(current.type)}</p>
          </div>
          <div style={{ marginTop: 16, padding: 16, borderRadius: 14, background: C.surface, border: `1px solid ${C.border}`, textAlign: "center" }}>
            {current.instruction}
          </div>
          {phase === "recording" && (
            <p style={{ textAlign: "center", fontFamily: "monospace", fontSize: 28, color: C.signal, marginTop: 16 }}>
              {Math.floor(recordSeconds / 60)}:{String(recordSeconds % 60).padStart(2, "0")}
            </p>
          )}
          {error && <p style={{ color: C.danger, marginTop: 12 }}>{error}</p>}
          {phase === "ready" && (
            <button type="button" style={{ ...btn, marginTop: 20 }} onClick={startRecording}>
              Record
            </button>
          )}
          {phase === "recording" && (
            <button
              type="button"
              style={{ ...btn, marginTop: 20, background: C.danger, color: "#fff" }}
              onClick={() => {
                mediaRecorderRef.current?.stop();
                beatAudioRef.current?.pause();
              }}
            >
              Stop
            </button>
          )}
          {phase === "review" && (
            <div style={{ marginTop: 16 }}>
              <p style={{ textAlign: "center", color: C.textMuted }}>
                {uploading ? "Saving…" : "How does it feel?"}
              </p>
              {localBlobUrl && <audio controls src={localBlobUrl} style={{ width: "100%", marginTop: 12 }} />}
              <button type="button" style={{ ...btn, marginTop: 16 }} disabled={uploading} onClick={keepAndContinue}>
                Keep take
              </button>
              <button
                type="button"
                style={{ ...btn2, marginTop: 8 }}
                disabled={uploading}
                onClick={() => {
                  setLocalBlobUrl(null);
                  setPhase("ready");
                }}
              >
                Record again
              </button>
            </div>
          )}
        </div>
      )}

      {screen === "done" && (
        <div style={wrap}>
          <Link href="/app" style={{ color: C.textMuted, textDecoration: "none", fontSize: 14 }}>
            ← Projects
          </Link>
          <h1 style={{ ...title, textAlign: "center", marginTop: 24 }}>
            {masterUrl || project?.status === "complete" ? "Your song is ready" : "Your performances are in"}
          </h1>
          <p style={{ textAlign: "center", color: C.textMuted, fontSize: 14, marginTop: 8 }}>
            {masterUrl
              ? "Play it back, then download your master."
              : `${completedCount} of ${tasks.length} parts captured. Next: mix & master with RoEx.`}
          </p>
          {masterUrl && (
            <div style={{ marginTop: 24 }}>
              <audio controls src={masterUrl} style={{ width: "100%" }} />
            </div>
          )}
          {error && <p style={{ color: C.danger, marginTop: 12 }}>{error}</p>}
          <div style={{ marginTop: 22, display: "flex", flexDirection: "column", gap: 10 }}>
            {!masterUrl && (
              <button type="button" style={btn} disabled={producing} onClick={startProduce}>
                {producing ? "Producing…" : "Produce my song"}
              </button>
            )}
            <button type="button" style={masterUrl ? btn : btn2} disabled={producing} onClick={downloadSong}>
              Download song
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
