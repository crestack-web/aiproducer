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

/** Strict product steps — never skip past recording into download. */
type Screen = "beat" | "analyzing" | "plan" | "session" | "assemble" | "done";

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

function isTaskOpen(t: Task) {
  return t.status === "pending" || t.status === "in_progress";
}

function isTaskDone(t: Task) {
  return t.status === "completed" || t.status === "skipped";
}

function requiredOpen(tasks: Task[]) {
  return tasks.filter((t) => t.required && isTaskOpen(t));
}

function anyOpen(tasks: Task[]) {
  return tasks.filter((t) => isTaskOpen(t));
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

  const openTasks = useMemo(() => anyOpen(tasks), [tasks]);
  const requiredPending = useMemo(() => requiredOpen(tasks), [tasks]);
  const current = requiredPending[0] || openTasks[0] || null;
  const completedCount = tasks.filter((t) => isTaskDone(t)).length;
  const requiredTotal = tasks.filter((t) => t.required).length;
  const requiredDone = tasks.filter((t) => t.required && isTaskDone(t)).length;
  const allRequiredDone = requiredTotal > 0 && requiredDone >= requiredTotal;

  const resolveScreen = useCallback(
    (proj: ProjectMeta | null, list: Task[], hasMaster: boolean) => {
      const st = proj?.status || "";
      if (hasMaster || st === "complete") return "done" as Screen;
      if (st === "processing" || st === "mixing" || st === "mastering") return "assemble" as Screen;
      const open = anyOpen(list);
      const hasTasks = list.length > 0;
      const reqDone = hasTasks && requiredOpen(list).length === 0 && list.some((t) => t.required);
      if (reqDone || (hasTasks && open.length === 0)) return "assemble" as Screen;
      const inSession =
        hasTasks &&
        list.some((t) => isTaskDone(t) || t.status === "in_progress") &&
        open.length > 0;
      if (inSession || (hasTasks && open.length > 0 && list.some((t) => isTaskDone(t)))) {
        return "session" as Screen;
      }
      if (st === "analyzing") return "analyzing";
      if (hasTasks || st === "blueprint_ready") return "plan";
      return "beat";
    },
    []
  );

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
      let hasMaster = false;
      if (!early && (st === "complete" || st === "mixing" || st === "mastering" || st === "processing")) {
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
            hasMaster = true;
          } else setMasterUrl(null);
        } else setMasterUrl(null);
      } else setMasterUrl(null);
      const next = resolveScreen(proj, list, hasMaster);
      setScreen(next);
      if (next === "session") setPhase("ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [id, resolveScreen]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const st = project?.status || "";
    if (st === "complete" || st === "failed") return;
    const needsPoll =
      !beatUrl ||
      st === "generating_beat" ||
      st === "draft" ||
      st === "processing" ||
      st === "mixing" ||
      st === "mastering";
    if (!needsPoll) return;
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

  async function playSection() {
    if (!beatUrl || !beatAudioRef.current || !current) return;
    const el = beatAudioRef.current;
    const start = (current.start_ms ?? 0) / 1000;
    const end = (current.end_ms ?? 0) / 1000;
    el.currentTime = start;
    el.volume = 0.7;
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
    if (!current) return;
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
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
        beatAudioRef.current?.pause();
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
      // Play the beat under the vocal — core session behavior from studio-app.html
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
    setTasks((prev) => {
      const next = prev.map((t) => (t.id === current.id ? { ...t, status: "completed" } : t));
      const stillRequired = requiredOpen(next);
      const stillAny = anyOpen(next);
      setLocalBlobUrl(null);
      if (stillRequired.length > 0 || stillAny.length > 0) {
        setScreen("session");
        setPhase("ready");
      } else {
        setScreen("assemble");
      }
      return next;
    });
  }

  async function startProduce() {
    setProducing(true);
    setError(null);
    setScreen("assemble");
    try {
      const res = await fetch(`/api/projects/${id}/produce`, { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "Produce failed");
      const tryMaster = async () => {
        setProject((p) => (p ? { ...p, status: "complete" } : p));
        const dl = await fetch(`/api/projects/${id}/download?kind=master`);
        if (dl.ok) {
          const d = await dl.json();
          if (d.download_url && !String(d.source || "").includes("beat")) {
            setMasterUrl(d.download_url);
            if (d.filename) setDownloadName(d.filename);
          }
        }
        setScreen("done");
      };
      if (j.status === "complete") {
        await tryMaster();
        return;
      }
      for (let i = 0; i < 25; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        const st = await fetch(`/api/projects/${id}/produce`);
        if (!st.ok) continue;
        const s = await st.json();
        if (s.project_status === "complete" || s.job?.status === "complete") {
          await tryMaster();
          return;
        }
        if (s.job?.status === "failed") throw new Error(s.job.error || "Failed");
      }
      throw new Error("Produce is taking longer than expected. Try again.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Produce failed");
    } finally {
      setProducing(false);
    }
  }

  async function downloadSong() {
    if (!masterUrl) {
      setError("Master is not ready yet. Produce the song first.");
      return;
    }
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
                  {!t.required && (
                    <span style={{ marginLeft: 8, color: C.textFaint, fontWeight: 500 }}>optional</span>
                  )}
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
              {requiredTotal > 0 && (
                <span style={{ color: C.textFaint }}> · {requiredDone}/{requiredTotal} required</span>
              )}
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
            <>
              <button type="button" style={{ ...btn2, marginTop: 16 }} disabled={!beatUrl} onClick={playSection}>
                ▶ Hear section
              </button>
              <p style={{ textAlign: "center", fontSize: 12.5, color: C.textFaint, margin: "12px 0 8px" }}>
                🎧 Use headphones · the beat plays while you record
              </p>
              <button type="button" style={btn} onClick={startRecording}>
                Record
              </button>
            </>
          )}
          {phase === "recording" && (
            <div style={{ marginTop: 16, textAlign: "center" }}>
              <p style={{ color: C.textMuted, fontSize: 13, marginBottom: 12 }}>Sing with the beat · stop when done</p>
              <button
                type="button"
                style={{ ...btn, background: C.danger, color: "#fff" }}
                onClick={() => {
                  mediaRecorderRef.current?.stop();
                  beatAudioRef.current?.pause();
                }}
              >
                Stop
              </button>
            </div>
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

      {screen === "session" && !current && (
        <div style={wrap}>
          <h1 style={{ ...title, textAlign: "center", marginTop: 40 }}>Takes captured</h1>
          <p style={{ textAlign: "center", color: C.textMuted, marginTop: 8 }}>
            {completedCount} of {tasks.length} parts ready. Next: mix & master.
          </p>
          <button type="button" style={{ ...btn, marginTop: 24 }} onClick={() => setScreen("assemble")}>
            Continue to produce
          </button>
        </div>
      )}

      {screen === "assemble" && (
        <div style={wrap}>
          <Link href="/app" style={{ color: C.textMuted, textDecoration: "none", fontSize: 14 }}>
            ← Projects
          </Link>
          <h1 style={{ ...title, textAlign: "center", marginTop: 24 }}>Your performances are in</h1>
          <p style={{ textAlign: "center", color: C.textMuted, fontSize: 14, marginTop: 8 }}>
            {completedCount} of {tasks.length} parts captured
            {requiredTotal > 0 ? ` · ${requiredDone}/${requiredTotal} required` : ""}.
            <br />
            Next: assemble, mix & master.
          </p>
          {error && <p style={{ color: C.danger, marginTop: 12 }}>{error}</p>}
          <div style={{ marginTop: 22, display: "flex", flexDirection: "column", gap: 10 }}>
            <button type="button" style={btn} disabled={producing || !allRequiredDone} onClick={startProduce}>
              {producing ? "Producing…" : "Produce my song"}
            </button>
            {!allRequiredDone && (
              <p style={{ textAlign: "center", color: C.textFaint, fontSize: 13 }}>
                Finish required takes before producing.
              </p>
            )}
            <button
              type="button"
              style={btn2}
              onClick={() => {
                setScreen("session");
                setPhase("ready");
              }}
            >
              Back to recording
            </button>
          </div>
        </div>
      )}

      {screen === "done" && (
        <div style={wrap}>
          <Link href="/app" style={{ color: C.textMuted, textDecoration: "none", fontSize: 14 }}>
            ← Projects
          </Link>
          <h1 style={{ ...title, textAlign: "center", marginTop: 24 }}>Your song is ready</h1>
          <p style={{ textAlign: "center", color: C.textMuted, fontSize: 14, marginTop: 8 }}>
            Play it back, then download your master.
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
            <button type="button" style={masterUrl ? btn : btn2} disabled={producing || !masterUrl} onClick={downloadSong}>
              Download song
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
