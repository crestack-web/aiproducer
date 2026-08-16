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
import { SongPreviewPlayer, type SongPreviewLayer } from "@/components/song-preview-player";
import { MicInputPicker, openMicStream } from "@/components/mic-input-picker";
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
import { attachAnalysisToForm, fetchProducerRecommendation } from "@/lib/client/recording-analysis";

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
  section_id?: string | null;
  metadata?: { section_label?: string; vocal_part?: string; section_id?: string };
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

const PRODUCE_POLL_MS = 4000;
const PRODUCE_MAX_MS = 15 * 60 * 1000;

function humanTitle(type: string) {
  const t = (type || "").toLowerCase();
  if (t.includes("harmony")) return "Harmony";
  if (t.includes("adlib")) return "Ad-libs";
  if (t.includes("double")) return "Double";
  return "Lead vocal";
}

function sectionDurationMs(task: Task): number | null {
  if (task.start_ms == null || task.end_ms == null) return null;
  const d = Number(task.end_ms) - Number(task.start_ms);
  return d > 500 ? d : null;
}

function screenForStatus(status: string, hasTasks: boolean): Screen | null {
  const s = (status || "").toLowerCase();
  if (s === "complete" || s === "produced" || s === "done") return "done";
  if (s === "processing" || s === "mixing" || s === "mastering") return "assemble";
  // Production failure must NOT wipe the session — return to assemble/preview with takes intact
  if (s === "failed") return hasTasks ? "assemble" : "beat";
  if (s === "recording" || s === "in_progress") return hasTasks ? "session" : "plan";
  if (s === "blueprint_ready" || s === "ready" || s === "planned") return hasTasks ? "plan" : "beat";
  if (s === "analyzing") return "analyzing";
  if (s === "beat_ready" || s === "draft" || s === "generating_beat") return "beat";
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
  const [producerTip, setProducerTip] = useState<string | null>(null);
  const [producing, setProducing] = useState(false);
  const [produceStage, setProduceStage] = useState<string | null>(null);
  const [masterUrl, setMasterUrl] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("ready");
  const [countdown, setCountdown] = useState(3);
  const [localBlobUrl, setLocalBlobUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [savedRecordingId, setSavedRecordingId] = useState<string | null>(null);
  const [skipping, setSkipping] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [micStream, setMicStream] = useState<MediaStream | null>(null);
  const [selectedMicId, setSelectedMicId] = useState("");
  const [previewLayers, setPreviewLayers] = useState<SongPreviewLayer[]>([]);
  const [previewBeatUrl, setPreviewBeatUrl] = useState<string | null>(null);
  const [previewBeatDurationMs, setPreviewBeatDurationMs] = useState<number | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sectionStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const beatAudioRef = useRef<HTMLAudioElement | null>(null);
  const startedAtRef = useRef(0);
  const mimeRef = useRef("audio/webm");
  const resumedRef = useRef(false);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const autoStoppedRef = useRef(false);
  const producePollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const produceStartedAtRef = useRef(0);
  const produceActiveRef = useRef(false);
  const selectedMicIdRef = useRef("");

  const current =
    tasks.find((t) => t.id === activeTaskId) || tasks.find((t) => isTaskOpen(t)) || null;
  const isRetake = current ? isTaskDone(current) : false;
  const sectionMs = current ? sectionDurationMs(current) : null;

  useEffect(() => {
    selectedMicIdRef.current = selectedMicId;
  }, [selectedMicId]);

  function clearProducePoll() {
    if (producePollRef.current) {
      clearTimeout(producePollRef.current);
      producePollRef.current = null;
    }
    produceActiveRef.current = false;
  }

  const loadSongPreview = useCallback(async () => {
    setPreviewLoading(true);
    try {
      const res = await fetch(`/api/projects/${id}/session-preview`);
      const j = await res.json().catch(() => ({}));
      if (!res.ok) return;
      setPreviewBeatUrl(j.beat_url || beatUrl || null);
      setPreviewBeatDurationMs(
        typeof j.beat_duration_ms === "number" ? j.beat_duration_ms : null
      );
      setPreviewLayers(Array.isArray(j.layers) ? j.layers : []);
    } catch {
      /* non-fatal */
    } finally {
      setPreviewLoading(false);
    }
  }, [id, beatUrl]);

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
    setProducerTip(null);
    setLocalBlobUrl(null);
    setSavedRecordingId(null);
    setActiveTaskId(taskId);
    setPhase("ready");
    setScreen("session");
    void markRecordingStatus();
  }

  const pollProduceOnce = useCallback(async (): Promise<
    "complete" | "failed" | "pending" | "error"
  > => {
    try {
      const sr = await fetch(`/api/projects/${id}/status`);
      const st = await sr.json().catch(() => ({}));
      if (!sr.ok) return "error";

      if (st.project) setProject(st.project);
      const jobs = (st.jobs || []) as { type?: string; status?: string; stage?: string; error?: string }[];
      const produceJob =
        jobs.find((j) => j.type === "PRODUCE_SONG") ||
        jobs.find((j) => (j.status || "").includes("process"));

      if (produceJob?.stage) setProduceStage(String(produceJob.stage));

      const jobStatus = (produceJob?.status || "").toLowerCase();
      const projectStatus = String(st.project?.status || "").toLowerCase();

      if (jobStatus === "failed" || projectStatus === "failed") {
        setError(produceJob?.error || "Produce failed");
        return "failed";
      }

      if (
        (jobStatus === "complete" || projectStatus === "complete") &&
        st.master_url &&
        st.master?.audio_path &&
        !String(st.master.audio_path).startsWith("http")
      ) {
        setMasterUrl(st.master_url);
        return "complete";
      }

      if (jobStatus === "complete" && st.master_url) {
        setMasterUrl(st.master_url);
        return "complete";
      }

      return "pending";
    } catch {
      return "error";
    }
  }, [id]);

  const scheduleProducePoll = useCallback(() => {
    clearProducePoll();
    produceActiveRef.current = true;
    const tick = async () => {
      if (!produceActiveRef.current) return;
      if (Date.now() - produceStartedAtRef.current > PRODUCE_MAX_MS) {
        setProducing(false);
        setError("Produce timed out. Refresh the page — if the job is still running it will resume.");
        produceActiveRef.current = false;
        return;
      }
      const result = await pollProduceOnce();
      if (result === "complete") {
        setProducing(false);
        setProduceStage("complete");
        setScreen("done");
        produceActiveRef.current = false;
        return;
      }
      if (result === "failed") {
        setProducing(false);
        setScreen("assemble");
        produceActiveRef.current = false;
        return;
      }
      if (!produceActiveRef.current) return;
      producePollRef.current = setTimeout(tick, PRODUCE_POLL_MS);
    };
    producePollRef.current = setTimeout(tick, 800);
  }, [pollProduceOnce]);

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

        const jobs = (st.jobs || []) as { type?: string; status?: string; stage?: string }[];
        const produceJob = jobs.find((j) => j.type === "PRODUCE_SONG");
        const js = (produceJob?.status || "").toLowerCase();
        if (js === "queued" || js === "processing") {
          setProducing(true);
          setScreen("assemble");
          setProduceStage(produceJob?.stage || "processing");
          produceStartedAtRef.current = Date.now();
          scheduleProducePoll();
        }
      }
      if (loadedProject && !resumedRef.current) {
        const next = screenForStatus(loadedProject.status, loadedTasks.length > 0);
        if (next && !produceActiveRef.current) {
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
  }, [id, scheduleProducePoll]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (screen === "assemble" && !producing) {
      void loadSongPreview();
    }
  }, [screen, producing, loadSongPreview]);

  useEffect(() => {
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
      if (sectionStopRef.current) clearTimeout(sectionStopRef.current);
      clearProducePoll();
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
      const j = await res.json().catch(() => ({} as Record<string, unknown>));
      if (!res.ok) {
        const msg =
          (typeof j.error === "string" && j.error) ||
          (typeof j.message === "string" && j.message) ||
          `Analyze failed (${res.status})`;
        throw new Error(msg);
      }
      const tr = await fetch(`/api/projects/${id}/recording-tasks`);
      if (tr.ok) setTasks((await tr.json()).tasks || []);
      const sr = await fetch(`/api/projects/${id}/status`);
      if (sr.ok) setProject((await sr.json()).project);
      else if (j.project_status) {
        setProject((p) => (p ? { ...p, status: String(j.project_status) } : p));
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

  function clearRecordTimers() {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    if (sectionStopRef.current) clearTimeout(sectionStopRef.current);
    sectionStopRef.current = null;
  }

  function beginMediaCapture(stream: MediaStream, task: Task) {
    chunksRef.current = [];
    autoStoppedRef.current = false;
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
      clearRecordTimers();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setMicStream(null);
      beatAudioRef.current?.pause();
      const blob = new Blob(chunksRef.current, { type: mimeRef.current.split(";")[0] });
      setLocalBlobUrl(URL.createObjectURL(blob));
      setPhase("review");
      setUploading(true);
      setProducerTip(null);
      try {
        const form = new FormData();
        form.append("file", blob, "take.webm");
        form.append("source", "record");
        form.append("duration_ms", String(Date.now() - startedAtRef.current));
        await attachAnalysisToForm(form, blob, task, id);
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
        const tip = await fetchProducerRecommendation(task.id, j.recording.id);
        if (tip) setProducerTip(tip);
        void markRecordingStatus();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Save failed");
        setSavedRecordingId(null);
      } finally {
        setUploading(false);
      }
    };

    const limitMs = sectionDurationMs(task);

    startedAtRef.current = Date.now();
    setRecordSeconds(0);
    timerRef.current = setInterval(() => {
      const elapsed = Date.now() - startedAtRef.current;
      setRecordSeconds(Math.floor(elapsed / 1000));
      if (limitMs != null && elapsed >= limitMs && !autoStoppedRef.current) {
        autoStoppedRef.current = true;
        clearRecordTimers();
        beatAudioRef.current?.pause();
        if (mediaRecorderRef.current?.state === "recording") {
          mediaRecorderRef.current.stop();
        }
      }
    }, 100);

    if (limitMs != null) {
      sectionStopRef.current = setTimeout(() => {
        if (autoStoppedRef.current) return;
        autoStoppedRef.current = true;
        clearRecordTimers();
        beatAudioRef.current?.pause();
        if (mediaRecorderRef.current?.state === "recording") {
          mediaRecorderRef.current.stop();
        }
      }, limitMs);
    }

    if (beatAudioRef.current && beatUrl) {
      beatAudioRef.current.currentTime = (task.start_ms ?? 0) / 1000;
      beatAudioRef.current.volume = 0.4;
      beatAudioRef.current.play().catch(() => undefined);
    }
    rec.start(250);
    setPhase("recording");
  }

  async function startRecording() {
    if (!current) return;
    setError(null);
    setProducerTip(null);
    setSavedRecordingId(null);
    try {
      const { stream, fellBack } = await openMicStream(selectedMicIdRef.current);
      if (fellBack) {
        setSelectedMicId("");
        setError("Selected microphone unavailable — using default mic");
      }
      streamRef.current = stream;
      setMicStream(stream);
      setCountdown(3);
      setPhase("countdown");
      void markRecordingStatus();
      if (beatAudioRef.current && beatUrl) {
        beatAudioRef.current.currentTime = Math.max(0, ((current.start_ms ?? 0) - 3000) / 1000);
        beatAudioRef.current.volume = 0.3;
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
        } else setCountdown(n);
      }, 1000);
    } catch (e) {
      setMicStream(null);
      setPhase("ready");
      const name = e instanceof DOMException ? e.name : "";
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        setError("Microphone permission denied. Enable mic access to record.");
      } else if (name === "NotFoundError") {
        setError("No microphone found.");
      } else {
        setError(e instanceof Error ? e.message : "Microphone error");
      }
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
    autoStoppedRef.current = true;
    clearRecordTimers();
    beatAudioRef.current?.pause();
    mediaRecorderRef.current?.stop();
  }

  async function uploadForTask(file: File | null) {
    if (!current || !file) return;
    setError(null);
    setProducerTip(null);
    setUploading(true);
    setPhase("review");
    setLocalBlobUrl(URL.createObjectURL(file));
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("source", "upload");
      await attachAnalysisToForm(form, file, current, id);
      const res = await fetch(`/api/recording-tasks/${current.id}/recordings`, {
        method: "POST",
        body: form,
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "Upload failed");
      if (!j.recording?.id) throw new Error("Upload succeeded but no recording id returned");
      setSavedRecordingId(j.recording.id);
      if (j.recording.audio_url) setLocalBlobUrl(j.recording.audio_url);
      await fetch(`/api/recording-tasks/${current.id}/recordings/${j.recording.id}/select`, {
        method: "POST",
      }).catch(() => undefined);
      const tip = await fetchProducerRecommendation(current.id, j.recording.id);
      if (tip) setProducerTip(tip);
      void markRecordingStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
      setSavedRecordingId(null);
      setPhase("ready");
    } finally {
      setUploading(false);
    }
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
      } else clearFocusAndAdvance(next);
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
    setProduceStage("queued");
    setScreen("assemble");
    try {
      const res = await fetch(`/api/projects/${id}/produce`, { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "Produce failed");

      if (j.master_url && res.status === 200 && j.status === "complete") {
        setMasterUrl(j.master_url);
        setProducing(false);
        setScreen("done");
        return;
      }

      produceStartedAtRef.current = Date.now();
      scheduleProducePoll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Produce failed");
      setProducing(false);
    }
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
    color: C.text,
    fontFamily: "system-ui, sans-serif",
  };
  const titleStyle: React.CSSProperties = {
    fontFamily: "Georgia, serif",
    fontSize: 24,
    fontWeight: 500,
  };

  if (loading) {
    return (
      <AppShell active="studio">
        <div style={wrap}>
          <PlayerLoadingState title="Loading session" subtitle="Pulling your beat, plan, and takes…" seed={`load-${id}`} />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell active="studio" userName="Artist">
      <div style={{ minHeight: "100%", width: "100%" }}>
        {beatUrl && <audio ref={beatAudioRef} src={beatUrl} preload="auto" style={{ display: "none" }} />}

        {screen === "beat" && (
          <div style={wrap}>
            <Link href="/app/studio" style={{ color: C.textMuted, textDecoration: "none", fontSize: 14 }}>
              ← Studio
            </Link>
            <h1 style={{ ...titleStyle, marginTop: 20 }}>{project?.title || "Your beat"}</h1>
            {error && <p style={{ color: C.danger }}>{error}</p>}
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
            <button type="button" style={{ ...btn, marginTop: 18 }} disabled={analyzing || !beatUrl} onClick={startProducerSession}>
              {analyzing ? "Analyzing…" : tasks.length > 0 ? "Continue plan" : "Start with AI Producer"}
            </button>
          </div>
        )}

        {screen === "analyzing" && (
          <div style={wrap}>
            <PlayerLoadingState title="Producer is listening" subtitle="Mapping sections…" seed={`analyze-${id}`} />
          </div>
        )}

        {screen === "plan" && (
          <div style={wrap}>
            <h1 style={titleStyle}>Song plan</h1>
            <SessionSteps tasks={tasks} locked={false} onSelect={selectTask} />
            <ProjectSamplesPanel projectId={id} />
            <button type="button" style={{ ...btn, marginTop: 20 }} onClick={enterSession}>
              Start recording
            </button>
          </div>
        )}

        {screen === "session" && current && (
          <div style={wrap}>
            <button type="button" style={{ background: "none", border: "none", color: C.textMuted, cursor: "pointer" }} onClick={() => setScreen("plan")} disabled={phase === "recording" || phase === "countdown"}>
              ← Plan
            </button>
            <SessionSteps tasks={tasks} highlightId={current.id} locked={phase === "recording" || phase === "review" || phase === "countdown"} compact onSelect={selectTask} />
            <div style={{ marginTop: 16, padding: 14, borderRadius: 14, border: `1px solid ${C.brass}`, background: C.brassSoft }}>
              <div style={{ fontSize: 12, color: C.brass, fontWeight: 600 }}>{sectionLabel(current)}</div>
              <h1 style={{ ...titleStyle, fontSize: "1.35rem", marginTop: 4 }}>{humanTitle(current.type)}</h1>
              <p style={{ color: C.textMuted, fontSize: 14 }}>{current.instruction}</p>
              {(current.start_ms != null || current.end_ms != null) && (
                <p style={{ color: C.textMuted, fontSize: 12, marginTop: 6 }}>
                  Section window: {current.start_ms ?? 0}ms → {current.end_ms ?? "—"}ms
                  {sectionMs != null ? ` · auto-stops at ${Math.round(sectionMs / 1000)}s` : ""}
                </p>
              )}
            </div>
            {error && <p style={{ color: C.danger }}>{error}</p>}

            {phase === "ready" && (
              <div style={{ marginTop: 20 }}>
                <MicInputPicker
                  selectedDeviceId={selectedMicId}
                  onSelect={setSelectedMicId}
                  disabled={false}
                />
                <button type="button" style={{ ...btn, marginTop: 14 }} onClick={startRecording}>
                  {isRetake ? "Retake" : "Record"}
                </button>
                <input
                  ref={uploadInputRef}
                  type="file"
                  accept="audio/*,.wav,.mp3,.m4a,.ogg,.flac,.webm"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    void uploadForTask(e.target.files?.[0] || null);
                    e.target.value = "";
                  }}
                />
                <button type="button" style={{ ...btn2, marginTop: 10 }} disabled={uploading} onClick={() => uploadInputRef.current?.click()}>
                  {uploading ? "Uploading…" : "Upload recording"}
                </button>
                {!current.required && (
                  <button type="button" style={{ ...btn2, marginTop: 10 }} disabled={skipping} onClick={skipCurrent}>
                    Skip
                  </button>
                )}
              </div>
            )}

            {phase === "countdown" && (
              <div style={{ textAlign: "center", marginTop: 24 }}>
                <div style={{ fontSize: 72, fontFamily: "Georgia, serif" }}>{countdown}</div>
                <button type="button" style={{ ...btn2, marginTop: 12 }} onClick={cancelCountdown}>
                  Cancel
                </button>
              </div>
            )}

            {phase === "recording" && (
              <div style={{ marginTop: 8 }}>
                <RecordingVisualizer
                  stream={micStream}
                  seconds={recordSeconds}
                  maxSeconds={sectionMs != null ? sectionMs / 1000 : null}
                  label="Recording"
                  seed={`rec-${current.id}`}
                />
                <button type="button" style={{ ...btn, marginTop: 16, background: C.danger, color: "#fff" }} onClick={stopRecording}>
                  Stop
                </button>
              </div>
            )}

            {phase === "review" && (
              <div style={{ marginTop: 16 }}>
                <p style={{ textAlign: "center", color: C.textMuted }}>
                  {uploading ? "Saving & analyzing take…" : savedRecordingId ? "Saved ✓" : "Review"}
                </p>
                {localBlobUrl && (
                  <CompactAudioPlayer
                    src={localBlobUrl}
                    label="Your take"
                    seed={`take-${current.id}`}
                    beatSrc={beatUrl}
                    beatStartMs={current.start_ms ?? 0}
                    beatEndMs={current.end_ms}
                    vocalVolume={1}
                    beatVolume={0.2}
                  />
                )}
                {producerTip && (
                  <p style={{ marginTop: 10, fontSize: 13.5, color: C.signal, lineHeight: 1.45 }}>{producerTip}</p>
                )}
                <button type="button" style={{ ...btn, marginTop: 16 }} disabled={uploading || !savedRecordingId} onClick={keepAndContinue}>
                  {uploading ? "Saving…" : "Keep take"}
                </button>
                <button
                  type="button"
                  style={{ ...btn2, marginTop: 8 }}
                  disabled={uploading}
                  onClick={() => {
                    setLocalBlobUrl(null);
                    setSavedRecordingId(null);
                    setProducerTip(null);
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
            <h1 style={titleStyle}>All parts done</h1>
            <p style={{ color: C.textMuted, textAlign: "center" }}>
              Hear your full arrangement (beat + every section) before producing.
            </p>
            <button type="button" style={{ ...btn, marginTop: 20 }} onClick={() => setScreen("assemble")}>
              Preview full song
            </button>
          </div>
        )}

        {screen === "assemble" && (
          <div style={wrap}>
            {producing ? (
              <>
                <PlayerLoadingState
                  title="Producing"
                  subtitle={produceStage ? `Stage: ${produceStage}` : "RoEx preview mix & master…"}
                  seed={`produce-${id}`}
                />
                <p style={{ textAlign: "center", color: C.textMuted, fontSize: 13, marginTop: 12 }}>
                  This can take a few minutes. You can refresh — progress will resume.
                </p>
              </>
            ) : (
              <>
                <h1 style={{ ...titleStyle, textAlign: "center" }}>Your song so far</h1>
                <p style={{ color: C.textMuted, textAlign: "center", fontSize: 14, marginTop: 6 }}>
                  Play the full timeline — beat plus every recorded section — then produce when it feels right.
                </p>
                {error && (
                  <div
                    style={{
                      marginTop: 12,
                      padding: 14,
                      borderRadius: 12,
                      border: `1px solid ${C.danger}`,
                      background: C.surface,
                      textAlign: "center",
                    }}
                  >
                    <p style={{ color: C.danger, margin: 0, fontWeight: 600 }}>
                      Production couldn&apos;t be completed.
                    </p>
                    <p style={{ color: C.textMuted, margin: "8px 0 0", fontSize: 14 }}>
                      Your recordings are safe.
                    </p>
                    <p style={{ color: C.textMuted, margin: "6px 0 0", fontSize: 13 }}>{error}</p>
                    <div style={{ display: "flex", gap: 10, marginTop: 14, justifyContent: "center" }}>
                      <button type="button" style={{ ...btn, width: "auto", minWidth: 120 }} onClick={startProduce}>
                        Try Again
                      </button>
                      <button
                        type="button"
                        style={{ ...btn2, width: "auto", minWidth: 140 }}
                        onClick={() => {
                          setError(null);
                          setScreen("session");
                          const open =
                            requiredOpen(tasks)[0] || optionalOpen(tasks)[0] || tasks[0];
                          if (open) setActiveTaskId(open.id);
                        }}
                      >
                        Back to Recording
                      </button>
                    </div>
                  </div>
                )}

                {previewLoading ? (
                  <PlayerLoadingState title="Loading preview" subtitle="Gathering beat and takes…" seed={`prev-${id}`} />
                ) : (
                  <SongPreviewPlayer
                    beatUrl={previewBeatUrl || beatUrl}
                    beatDurationMs={previewBeatDurationMs}
                    layers={previewLayers}
                    title={project?.title || "Full song preview"}
                    seed={project?.title || id}
                  />
                )}

                <button
                  type="button"
                  style={{ ...btn2, marginTop: 12 }}
                  onClick={() => void loadSongPreview()}
                  disabled={previewLoading}
                >
                  Refresh preview
                </button>

                <ProjectSamplesPanel projectId={id} />
                <button type="button" style={{ ...btn, marginTop: 20 }} onClick={startProduce}>
                  Produce my song
                </button>
              </>
            )}
          </div>
        )}

        {screen === "done" && (
          <div style={wrap}>
            <h1 style={{ ...titleStyle, textAlign: "center" }}>Your song is ready</h1>
            {masterUrl && (
              <StudioPlayer src={masterUrl} title={project?.title || "Song"} seed="master" accent="signal" />
            )}
            {!masterUrl && (
              <>
                <p style={{ textAlign: "center", color: C.textMuted }}>Master not ready yet.</p>
                <button type="button" style={btn} onClick={startProduce}>
                  Produce my song
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}
