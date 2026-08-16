"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  StudioPlayer,
  CompactAudioPlayer,
  RecordingVisualizer,
  PlayerLoadingState,
} from "@/components/studio-player";
import { AppShell } from "@/components/app-shell";
import {
  SessionSteps,
  sectionLabel,
  isTaskOpen,
  isTaskDone,
  requiredOpen,
  optionalOpen,
} from "@/components/session-steps";
import { ProjectSamplesPanel } from "@/components/project-samples-panel";
import { useTheme } from "@/lib/theme";

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

type Screen = "beat" | "analyzing" | "plan" | "session" | "assemble" | "done";
type Phase = "ready" | "countdown" | "recording" | "review";

function humanTitle(type: string) {
  const t = (type || "").toLowerCase();
  if (t.includes("harmony")) return "Harmony";
  if (t.includes("adlib")) return "Ad-libs";
  if (t.includes("double")) return "Double";
  return "Lead vocal";
}

function screenForStatus(status: string, hasTasks: boolean): Screen | null {
  const s = (status || "").toLowerCase();
  if (s === "complete" || s === "produced" || s === "done") return "done";
  if (s === "processing" || s === "mixing" || s === "mastering") return "assemble";
  if (s === "recording" || s === "in_progress") return hasTasks ? "session" : "plan";
  if (s === "blueprint_ready" || s === "ready" || s === "planned") return hasTasks ? "plan" : "beat";
  if (s === "analyzing") return "analyzing";
  if (s === "beat_ready" || s === "draft" || s === "generating_beat" || s === "failed") return "beat";
  return null;
}

export default function ProjectDetailPage() {
  const id = useParams().id as string;
  const { colors: C } = useTheme();
  const [project, setProject] = useState<ProjectMeta | null>(null);
  const [beatUrl, setBeatUrl] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [screen, setScreen] = useState<Screen>("beat");
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [producing, setProducing] = useState(false);
  const [masterUrl, setMasterUrl] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("ready");
  const [countdown, setCountdown] = useState(3);
  const [localBlobUrl, setLocalBlobUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [savedRecordingId, setSavedRecordingId] = useState<string | null>(null);
  const [skipping, setSkipping] = useState(false);
  const [guideLoading, setGuideLoading] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [micStream, setMicStream] = useState<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const beatAudioRef = useRef<HTMLAudioElement | null>(null);
  const guideAudioRef = useRef<HTMLAudioElement | null>(null);
  const startedAtRef = useRef(0);
  const mimeRef = useRef("audio/webm");
  const resumedRef = useRef(false);

  const current =
    tasks.find((t) => t.id === activeTaskId) || tasks.find((t) => isTaskOpen(t)) || null;
  const isRetake = current ? isTaskDone(current) : false;
  const requiredLeft = requiredOpen(tasks);
  const optionalLeft = optionalOpen(tasks);

  async function markRecordingStatus() {
    try {
      const res = await fetch(`/api/projects/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "recording" }),
      });
      if (res.ok) {
        const j = await res.json();
        if (j.project) setProject(j.project);
      }
    } catch {
      /* ignore */
    }
  }

  function selectTask(taskId: string) {
    if (phase === "recording" || phase === "countdown") return;
    setError(null);
    setLocalBlobUrl(null);
    setSavedRecordingId(null);
    setActiveTaskId(taskId);
    setPhase("ready");
    setScreen("session");
    void markRecordingStatus();
  }

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [pr, br, tr] = await Promise.all([
        fetch(`/api/projects/${id}`),
        fetch(`/api/projects/${id}/beat`),
        fetch(`/api/projects/${id}/recording-tasks`),
      ]);
      let loadedProject: ProjectMeta | null = null;
      let loadedTasks: Task[] = [];
      if (pr.ok) {
        const j = await pr.json();
        loadedProject = j.project || j;
        setProject(loadedProject);
      }
      if (br.ok) setBeatUrl((await br.json()).audio_url || null);
      if (tr.ok) {
        loadedTasks = (await tr.json()).tasks || [];
        setTasks(loadedTasks);
      }
      const sr = await fetch(`/api/projects/${id}/status`);
      if (sr.ok) {
        const st = await sr.json();
        if (st.project) {
          loadedProject = st.project;
          setProject(st.project);
        }
        if (st.master_url) setMasterUrl(st.master_url);
      }
      if (loadedProject && !resumedRef.current) {
        const next = screenForStatus(loadedProject.status, loadedTasks.length > 0);
        if (next) {
          setScreen(next);
          if (next === "session" && loadedTasks.length > 0) {
            const open =
              loadedTasks.find((t) => isTaskOpen(t) && t.required) ||
              loadedTasks.find((t) => isTaskOpen(t)) ||
              null;
            if (open) setActiveTaskId(open.id);
          }
          resumedRef.current = true;
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!project || loading) return;
    if (project.status === "blueprint_ready" && tasks.length > 0 && screen === "analyzing") {
      setScreen("plan");
    }
    if (project.status === "complete" && screen !== "done") setScreen("done");
  }, [project?.status, tasks.length, loading, screen]);

  useEffect(() => {
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  async function startProducerSession() {
    if (
      tasks.length > 0 &&
      ["blueprint_ready", "recording", "processing", "mixing", "mastering", "complete"].includes(
        project?.status || ""
      )
    ) {
      setScreen("plan");
      return;
    }
    setAnalyzing(true);
    setError(null);
    setScreen("analyzing");
    try {
      const res = await fetch(`/api/projects/${id}/analyze`, { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "Could not build plan");
      const tr = await fetch(`/api/projects/${id}/recording-tasks`);
      if (tr.ok) setTasks((await tr.json()).tasks || []);
      const sr = await fetch(`/api/projects/${id}/status`);
      if (sr.ok) setProject((await sr.json()).project);
      else if (j.project_status) {
        setProject((p) => (p ? { ...p, status: j.project_status } : p));
      }
      setScreen("plan");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analyze failed");
      setScreen("beat");
    } finally {
      setAnalyzing(false);
    }
  }

  async function enterSession() {
    const open = requiredOpen(tasks)[0] || optionalOpen(tasks)[0] || tasks[0];
    if (open) setActiveTaskId(open.id);
    setPhase("ready");
    setScreen("session");
    await markRecordingStatus();
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

  async function playMelodyGuide() {
    if (!current) return;
    setError(null);
    setGuideLoading(true);
    try {
      beatAudioRef.current?.pause();
      if (guideAudioRef.current) {
        guideAudioRef.current.pause();
        guideAudioRef.current = null;
      }
      if (typeof window !== "undefined" && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }

      const res = await fetch(`/api/recording-tasks/${current.id}/melody-guide`, {
        method: "POST",
      });
      const j = await res.json().catch(() => ({}));
      const script =
        (typeof j.script === "string" && j.script) ||
        [current.instruction, current.reason].filter(Boolean).join(". ");

      if (beatUrl && beatAudioRef.current) {
        const el = beatAudioRef.current;
        const start = (current.start_ms ?? j.start_ms ?? 0) / 1000;
        const end = Number(current.end_ms ?? j.end_ms ?? 0) / 1000;
        try {
          el.currentTime = Math.max(0, Number(start) || 0);
        } catch {
          /* ignore */
        }
        el.volume = 0.38;
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

      if (j.audio_url) {
        const g = new Audio(j.audio_url);
        guideAudioRef.current = g;
        g.volume = 1;
        await g.play();
      } else if (script && typeof window !== "undefined" && window.speechSynthesis) {
        await new Promise<void>((resolve) => {
          const u = new SpeechSynthesisUtterance(script);
          u.rate = 0.95;
          u.pitch = 1;
          u.onend = () => resolve();
          u.onerror = () => resolve();
          window.speechSynthesis.speak(u);
        });
      } else {
        throw new Error(j.error || "Could not play melody guide");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Melody guide failed");
    } finally {
      setGuideLoading(false);
    }
  }

  function beginMediaCapture(stream: MediaStream, task: Task) {
    chunksRef.current = [];
    let mime = "audio/webm";
    for (const t of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]) {
      if (MediaRecorder.isTypeSupported(t)) {
        mime = t;
        break;
      }
    }
    mimeRef.current = mime;
    const rec = new MediaRecorder(stream, { mimeType: mime });
    mediaRecorderRef.current = rec;
    rec.ondataavailable = (e) => {
      if (e.data?.size) chunksRef.current.push(e.data);
    };
    rec.onstop = async () => {
      if (timerRef.current) clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setMicStream(null);
      beatAudioRef.current?.pause();
      const blob = new Blob(chunksRef.current, { type: mimeRef.current.split(";")[0] });
      setLocalBlobUrl(URL.createObjectURL(blob));
      setPhase("review");
      setUploading(true);
      try {
        const form = new FormData();
        form.append("file", blob, "take.webm");
        form.append("duration_ms", String(Date.now() - startedAtRef.current));
        const res = await fetch(`/api/recording-tasks/${task.id}/recordings`, {
          method: "POST",
          body: form,
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(j.error || "Upload failed");
        if (!j.recording?.id) throw new Error("Upload succeeded but no recording id returned");
        setSavedRecordingId(j.recording.id);
        await fetch(`/api/recording-tasks/${task.id}/recordings/${j.recording.id}/select`, {
          method: "POST",
        }).catch(() => undefined);
        void markRecordingStatus();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Save failed");
        setSavedRecordingId(null);
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
      beatAudioRef.current.currentTime = (task.start_ms ?? 0) / 1000;
      beatAudioRef.current.volume = 0.55;
      beatAudioRef.current.play().catch(() => undefined);
    }
    rec.start(250);
    setPhase("recording");
  }

  async function startRecording() {
    if (!current) return;
    setError(null);
    setSavedRecordingId(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;
      setMicStream(stream);
      setCountdown(3);
      setPhase("countdown");
      void markRecordingStatus();

      if (beatAudioRef.current && beatUrl) {
        beatAudioRef.current.currentTime = Math.max(0, ((current.start_ms ?? 0) - 3000) / 1000);
        beatAudioRef.current.volume = 0.35;
        beatAudioRef.current.play().catch(() => undefined);
      }

      let n = 3;
      if (countdownRef.current) clearInterval(countdownRef.current);
      countdownRef.current = setInterval(() => {
        n -= 1;
        if (n <= 0) {
          if (countdownRef.current) clearInterval(countdownRef.current);
          countdownRef.current = null;
          setCountdown(0);
          beginMediaCapture(stream, current);
        } else {
          setCountdown(n);
        }
      }, 1000);
    } catch (e) {
      setMicStream(null);
      setPhase("ready");
      setError(e instanceof Error ? e.message : "Microphone error");
    }
  }

  function cancelCountdown() {
    if (countdownRef.current) clearInterval(countdownRef.current);
    countdownRef.current = null;
    beatAudioRef.current?.pause();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setMicStream(null);
    setPhase("ready");
    setCountdown(3);
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop();
  }

  function clearFocusAndAdvance(next: Task[]) {
    setActiveTaskId(null);
    setLocalBlobUrl(null);
    setPhase("ready");
    setScreen("session");
    if (requiredOpen(next).length === 0 && optionalOpen(next).length === 0) setScreen("assemble");
  }

  function keepAndContinue() {
    if (!current) return;
    if (!savedRecordingId) {
      setError("Take is not saved yet. Wait for Saved, or record again.");
      return;
    }
    const wasRetake = isRetake;
    setSavedRecordingId(null);
    setTasks((prev) => {
      const next = prev.map((t) => (t.id === current.id ? { ...t, status: "completed" } : t));
      if (wasRetake) {
        setActiveTaskId(null);
        setLocalBlobUrl(null);
        setPhase("ready");
        setScreen("session");
        if (requiredOpen(next).length === 0 && optionalOpen(next).length === 0) setScreen("assemble");
      } else {
        clearFocusAndAdvance(next);
      }
      return next;
    });
  }

  async function skipCurrent() {
    if (!current || current.required) return;
    setSkipping(true);
    try {
      await fetch(`/api/recording-tasks/${current.id}/skip`, { method: "POST" });
      setTasks((prev) => {
        const next = prev.map((t) => (t.id === current.id ? { ...t, status: "skipped" } : t));
        clearFocusAndAdvance(next);
        return next;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Skip failed");
    } finally {
      setSkipping(false);
    }
  }

  async function startProduce() {
    setProducing(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${id}/produce`, { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "Produce failed");
      if (j.master_url) setMasterUrl(j.master_url);
      setScreen("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Produce failed");
    } finally {
      setProducing(false);
    }
  }

  async function downloadSong() {
    if (!masterUrl) return;
    const a = document.createElement("a");
    a.href = masterUrl;
    a.download = "studio-song-master.wav";
    a.click();
  }

  const btn: React.CSSProperties = {
    width: "100%",
    padding: "14px 18px",
    borderRadius: 14,
    border: "none",
    background: `linear-gradient(180deg, #F0BC80, ${C.brass})`,
    color: "#1A1208",
    fontWeight: 600,
    fontSize: 15,
    cursor: "pointer",
  };
  const btn2: React.CSSProperties = {
    ...btn,
    background: C.surface,
    color: C.text,
    border: `1px solid ${C.border}`,
  };
  const wrap: React.CSSProperties = {
    width: "100%",
    maxWidth: 920,
    margin: "0 auto",
    padding: "28px 20px 40px",
    boxSizing: "border-box",
    minHeight: "100%",
    background: "transparent",
    color: C.text,
    fontFamily: "system-ui, sans-serif",
  };
  const title: React.CSSProperties = {
    fontFamily: "Georgia, serif",
    fontSize: 24,
    fontWeight: 500,
  };

  if (loading) {
    return (
      <AppShell active="studio">
        <div style={wrap}>
          <PlayerLoadingState
            title="Loading session"
            subtitle="Pulling your beat, plan, and takes…"
            seed={`load-${id}`}
          />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell active="studio" userName="Artist">
      <div style={{ minHeight: "100%", width: "100%" }}>
        {beatUrl && (
          <audio ref={beatAudioRef} src={beatUrl} preload="auto" style={{ display: "none" }} />
        )}

        {screen === "beat" && (
          <div style={wrap}>
            <Link href="/app/studio" style={{ color: C.textMuted, textDecoration: "none", fontSize: 14 }}>
              ← Studio
            </Link>
            <h1 style={{ ...title, marginTop: 20 }}>{project?.title || "Your beat"}</h1>
            <p style={{ color: C.textMuted, fontSize: 14, marginTop: 8 }}>
              Listen, then let your AI producer map the sections you need to record.
            </p>
            {error && <p style={{ color: C.danger, marginTop: 12 }}>{error}</p>}
            {beatUrl && (
              <StudioPlayer
                src={beatUrl}
                title={project?.title || "Beat"}
                subtitle={[project?.genre, project?.mood, project?.tempo ? `${project.tempo} BPM` : null]
                  .filter(Boolean)
                  .join(" · ")}
                seed={project?.title || "beat"}
              />
            )}
            <button
              type="button"
              style={{ ...btn, marginTop: 18 }}
              disabled={analyzing || !beatUrl}
              onClick={startProducerSession}
            >
              {analyzing ? "Analyzing…" : tasks.length > 0 ? "Continue plan" : "Start with AI Producer"}
            </button>
          </div>
        )}

        {screen === "analyzing" && (
          <div style={wrap}>
            <PlayerLoadingState
              title="Producer is listening"
              subtitle="Mapping intro, verse, chorus, and what you should record next."
              seed={`analyze-${id}`}
            />
          </div>
        )}

        {screen === "plan" && (
          <div style={wrap}>
            <button
              type="button"
              style={{
                background: "none",
                border: "none",
                color: C.textMuted,
                marginBottom: 16,
                cursor: "pointer",
              }}
              onClick={() => setScreen("beat")}
            >
              ← Back to beat
            </button>
            <h1 style={title}>Song plan</h1>
            <p style={{ color: C.textMuted, fontSize: 14, marginTop: 8 }}>
              Record each required part. Optional parts can be skipped. Tap a step to jump or retake.
            </p>
            <SessionSteps tasks={tasks} locked={false} onSelect={selectTask} />
            <ProjectSamplesPanel projectId={id} />
            <button type="button" style={{ ...btn, marginTop: 20 }} onClick={enterSession}>
              {requiredLeft.length === 0 && optionalLeft.length === 0
                ? "Review takes"
                : requiredLeft.length === 0
                  ? "Continue optional parts"
                  : `Start next: ${sectionLabel(requiredLeft[0] || optionalLeft[0] || tasks[0])}`}
            </button>
          </div>
        )}

        {screen === "session" && current && (
          <div style={wrap}>
            <button
              type="button"
              style={{
                background: "none",
                border: "none",
                color: C.textMuted,
                marginBottom: 12,
                cursor: "pointer",
              }}
              onClick={() => setScreen("plan")}
              disabled={phase === "recording" || phase === "countdown"}
            >
              ← Plan
            </button>
            <SessionSteps
              tasks={tasks}
              highlightId={current.id}
              locked={phase === "recording" || phase === "review" || phase === "countdown"}
              compact
              onSelect={selectTask}
            />
            <div
              style={{
                marginTop: 16,
                padding: "14px 14px",
                borderRadius: 14,
                border: `1px solid ${C.brass}`,
                background: C.brassSoft,
              }}
            >
              <div style={{ fontSize: 11, color: C.brass, letterSpacing: 0.8, fontWeight: 600 }}>
                STEP {tasks.findIndex((t) => t.id === current.id) + 1} OF {tasks.length}
                {" · "}
                {current.required ? "REQUIRED" : "OPTIONAL"}
                {isRetake ? " · RETAKE" : ""}
              </div>
              <div style={{ fontSize: 12, color: C.brass, letterSpacing: 0.6, marginTop: 8 }}>
                {sectionLabel(current)}
              </div>
              <h1 style={{ ...title, marginTop: 4, fontSize: "1.35rem" }}>
                {humanTitle(current.type)}
              </h1>
              <p style={{ color: C.textMuted, fontSize: 14, marginTop: 6, marginBottom: 0 }}>
                {current.instruction}
              </p>
            </div>
            {error && <p style={{ color: C.danger, marginTop: 12 }}>{error}</p>}

            {phase === "ready" && (
              <div style={{ marginTop: 20 }}>
                <button type="button" style={{ ...btn2, marginBottom: 10 }} disabled={!beatUrl} onClick={playSection}>
                  Preview section beat
                </button>
                <button type="button" style={{ ...btn2, marginBottom: 10 }} disabled={guideLoading} onClick={playMelodyGuide}>
                  {guideLoading ? "Loading guide…" : "Melody guide"}
                </button>
                <button type="button" style={btn} onClick={startRecording}>
                  {isRetake ? "Retake" : "Record"}
                </button>
                {!current.required && (
                  <button type="button" style={{ ...btn2, marginTop: 10, color: C.textMuted }} disabled={skipping} onClick={skipCurrent}>
                    Skip this part
                  </button>
                )}
              </div>
            )}

            {phase === "countdown" && (
              <div
                style={{
                  marginTop: 18,
                  padding: "36px 20px",
                  borderRadius: 20,
                  border: "1px solid rgba(231,169,97,0.4)",
                  background:
                    "radial-gradient(ellipse at 50% 30%, rgba(231,169,97,0.16), transparent 60%), rgba(255,255,255,0.03)",
                  textAlign: "center",
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: 1.4, textTransform: "uppercase", color: C.brass }}>
                  Get ready
                </div>
                <div
                  key={countdown}
                  style={{
                    fontFamily: "Georgia, Fraunces, serif",
                    fontSize: 88,
                    fontWeight: 500,
                    color: C.text,
                    lineHeight: 1,
                    margin: "12px 0 8px",
                  }}
                >
                  {countdown}
                </div>
                <p style={{ margin: 0, fontSize: 14, color: C.textMuted }}>Recording starts after 1…</p>
                <button type="button" style={{ ...btn2, marginTop: 20, maxWidth: 200 }} onClick={cancelCountdown}>
                  Cancel
                </button>
              </div>
            )}

            {phase === "recording" && (
              <div style={{ marginTop: 8 }}>
                <RecordingVisualizer stream={micStream} seconds={recordSeconds} label="Recording" seed={`rec-${current.id}`} />
                <button type="button" style={{ ...btn, marginTop: 16, background: C.danger, color: "#fff" }} onClick={stopRecording}>
                  Stop
                </button>
              </div>
            )}

            {phase === "review" && (
              <div style={{ marginTop: 16 }}>
                <p style={{ textAlign: "center", color: C.textMuted, marginBottom: 4 }}>
                  {uploading
                    ? "Saving take…"
                    : savedRecordingId
                      ? isRetake
                        ? "Saved ✓ — keep new take?"
                        : "Saved ✓ — hear your voice on the beat"
                      : "How does it feel?"}
                </p>
                {localBlobUrl && (
                  <CompactAudioPlayer
                    src={localBlobUrl}
                    label={uploading ? "Your take (saving…)" : "Your take"}
                    seed={`take-${current.id}`}
                    beatSrc={beatUrl}
                    beatStartMs={current.start_ms ?? 0}
                    beatEndMs={current.end_ms}
                    beatVolume={0.55}
                    vocalVolume={1}
                  />
                )}
                {!localBlobUrl && uploading && (
                  <PlayerLoadingState title="Saving take" subtitle="Uploading your performance…" seed={`save-${current.id}`} />
                )}
                <button
                  type="button"
                  style={{ ...btn, marginTop: 16, opacity: uploading || !savedRecordingId ? 0.5 : 1 }}
                  disabled={uploading || !savedRecordingId}
                  onClick={keepAndContinue}
                >
                  {uploading ? "Saving…" : savedRecordingId ? (isRetake ? "Keep new take" : "Keep take") : "Waiting for save…"}
                </button>
                <button
                  type="button"
                  style={{ ...btn2, marginTop: 8 }}
                  disabled={uploading}
                  onClick={() => {
                    setLocalBlobUrl(null);
                    setSavedRecordingId(null);
                    setPhase("ready");
                  }}
                >
                  Record again
                </button>
                {!current.required && isTaskOpen(current) && (
                  <button type="button" style={{ ...btn2, marginTop: 8, color: C.textMuted }} disabled={uploading || skipping} onClick={skipCurrent}>
                    Discard & skip this part
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {screen === "session" && !current && (
          <div style={wrap}>
            <SessionSteps tasks={tasks} locked={false} onSelect={selectTask} />
            <h1 style={{ ...title, marginTop: 16 }}>All parts done</h1>
            <p style={{ color: C.textMuted, fontSize: 14, marginTop: 8 }}>
              Required and optional takes are complete. You can still retake any step above.
            </p>
            <button type="button" style={{ ...btn, marginTop: 20 }} onClick={() => setScreen("assemble")}>
              Continue to produce
            </button>
          </div>
        )}

        {screen === "assemble" && (
          <div style={wrap}>
            {producing ? (
              <PlayerLoadingState title="Producing your song" subtitle="Mixing vocals with the beat, then mastering for release." seed={`produce-${id}`} />
            ) : (
              <>
                <h1 style={{ ...title, textAlign: "center" }}>Ready to produce</h1>
                <p style={{ textAlign: "center", color: C.textMuted, fontSize: 14, marginTop: 8 }}>We will mix your vocals with the beat.</p>
                <ProjectSamplesPanel projectId={id} />
                {error && <p style={{ color: C.danger, marginTop: 12 }}>{error}</p>}
                <button type="button" style={{ ...btn, marginTop: 20 }} disabled={producing} onClick={startProduce}>
                  Produce my song
                </button>
                <button type="button" style={{ ...btn2, marginTop: 10 }} onClick={() => setScreen("session")}>
                  Back to recording
                </button>
              </>
            )}
          </div>
        )}

        {screen === "done" && (
          <div style={wrap}>
            <Link href="/app/studio" style={{ color: C.textMuted, textDecoration: "none", fontSize: 14 }}>
              ← Studio
            </Link>
            {producing ? (
              <PlayerLoadingState title="Finishing master" subtitle="Almost there — locking in loudness and clarity." seed={`master-${id}`} />
            ) : (
              <>
                <h1 style={{ ...title, textAlign: "center", marginTop: 24 }}>Your song is ready</h1>
                <p style={{ textAlign: "center", color: C.textMuted, fontSize: 14, marginTop: 8 }}>Play it back, then download your master.</p>
                {masterUrl && (
                  <StudioPlayer
                    src={masterUrl}
                    title={project?.title || "Your song"}
                    subtitle={[project?.genre, project?.mood].filter(Boolean).join(" · ") || "Master"}
                    seed={`${project?.title || "song"}-master`}
                    accent="signal"
                  />
                )}
                {error && <p style={{ color: C.danger, marginTop: 12 }}>{error}</p>}
                <div style={{ marginTop: 22, display: "flex", flexDirection: "column", gap: 10 }}>
                  {!masterUrl && (
                    <button type="button" style={btn} disabled={producing} onClick={startProduce}>
                      Produce my song
                    </button>
                  )}
                  <button type="button" style={masterUrl ? btn : btn2} disabled={producing || !masterUrl} onClick={downloadSong}>
                    Download song
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}
