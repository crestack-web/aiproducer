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
import {
  MicInputPicker,
  SpeakerOutputPicker,
  routePlaybackToPreferredOutput,
} from "@/components/mic-input-picker";
import {
  openRecordingStream,
  createVocalRecorder,
  describeInputQualityWarning,
} from "@/lib/audio/recording-engine";
import {
  startSpeakerMonitorDuck,
  isPhoneSpeakerOutput,
  classifyCapture,
  type SpeakerDuckHandle,
  type SpeakerDuckDiagnostics,
} from "@/lib/audio/speaker-monitor-duck";
import {
  analyzeOriginalCaptureBleed,
  buildCaptureDiagnosticSummary,
  type CaptureBleedAnalysis,
} from "@/lib/audio/capture-bleed-analysis";
import {
  createSessionTimeline,
  markCountdownStart,
  markRecordingStart,
  markRecordingStop,
  placementStartMs,
  resolvePlacementStartMs,
  reviewBeatStartMs,
  sessionTimelineToMeta,
  type SessionTimeline,
} from "@/lib/audio/session-timeline";
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
import { PlanEditor, type PlanEditorTask } from "@/components/plan-editor";
import { canProduce, type PlanMode } from "@/lib/plan";

/** Marker: real recording booth UI. Survives minify. Never null page. */
export const FULL_SESSION_UI = true as const;

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

function activeSessionTasksFromPlan(rows: PlanEditorTask[]): Task[] {
  return rows
    .filter((row) => {
      const t = row as PlanEditorTask & {
        active?: boolean | null;
        selected_in_plan?: boolean | null;
      };
      if (t.active === false) return false;
      if (t.selected_in_plan === false) return false;
      if (t.status === "skipped") return false;
      return Boolean(t.id);
    })
    .map((t) => ({
      id: t.id,
      type: t.type,
      title: t.title,
      instruction: t.instruction || "",
      reason: t.reason,
      status: t.status || "pending",
      required: Boolean(t.required),
      start_ms: t.start_ms,
      end_ms: t.end_ms,
      section_id: t.section_id,
      metadata: t.metadata as Task["metadata"],
    }));
}

function screenForStatus(
  status: string,
  hasTasks: boolean,
  hasProgress = false
): Screen | null {
  const s = (status || "").toLowerCase();
  if (s === "complete" || s === "produced" || s === "done") return "done";
  if (s === "processing" || s === "mixing" || s === "mastering") return "assemble";
  // Resume booth whenever recording has started — do not require tasks to have loaded yet
  if (s === "recording" || s === "in_progress") return "session";
  // Plan exists but artist already recorded/completed parts → booth for retakes, not plan chooser
  if (s === "blueprint_ready" || s === "ready" || s === "planned") {
    if (hasProgress) return "session";
    return hasTasks ? "plan" : "beat";
  }
  if (s === "analyzing") return "analyzing";
  // Beat ready → beat screen (Planner entry via Start with AI Producer), never skip Planner
  if (s === "beat_ready" || s === "draft" || s === "generating_beat" || s === "failed") return "beat";
  if (hasProgress) return "session";
  return hasTasks ? "plan" : "beat";
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
  const [reviewVoiceOnly, setReviewVoiceOnly] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [savedRecordingId, setSavedRecordingId] = useState<string | null>(null);
  const [skipping, setSkipping] = useState(false);
  const [planMode, setPlanMode] = useState<PlanMode>("ai");
  /** Full plan list for PlanEditor (includes deselected). Session uses `tasks` (active only). */
  const [planTasks, setPlanTasks] = useState<PlanEditorTask[]>([]);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [micStream, setMicStream] = useState<MediaStream | null>(null);
  const [selectedMicId, setSelectedMicId] = useState("");
  const [selectedSpeakerId, setSelectedSpeakerId] = useState("__headphones__");
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
  /** Canonical musical placement for the active take (session timeline). */
  const sessionTimelineRef = useRef<SessionTimeline | null>(null);
  const [lastRecordingOffsetMs, setLastRecordingOffsetMs] = useState(0);
  const mimeRef = useRef("audio/webm");
  const resumedRef = useRef(false);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const autoStoppedRef = useRef(false);
  const producePollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const produceStartedAtRef = useRef(0);
  const produceActiveRef = useRef(false);
  const selectedMicIdRef = useRef("");
  const selectedSpeakerIdRef = useRef("");
  const speakerDuckRef = useRef<SpeakerDuckHandle | null>(null);
  const duckRafRef = useRef<number | null>(null);
  const lastDuckSummaryRef = useRef<SpeakerDuckDiagnostics | null>(null);
  const recordingStartPerfRef = useRef<number | null>(null);
  const lastBlobAnalysisRef = useRef<CaptureBleedAnalysis | null>(null);
  const lastCaptureDeviceRef = useRef<{
    actualInput?: string | null;
    actualInputLabel?: string | null;
    routingStatus?: string | null;
    requestedInput?: string | null;
    requestedOutput?: string | null;
    actualOutput?: string | null;
  }>({});

  const current =
    tasks.find((t) => t.id === activeTaskId) || tasks.find((t) => isTaskOpen(t)) || null;
  const isRetake = current ? isTaskDone(current) : false;
  const sectionMs = current ? sectionDurationMs(current) : null;

  useEffect(() => {
    selectedMicIdRef.current = selectedMicId;
  }, [selectedMicId]);

  useEffect(() => {
    selectedSpeakerIdRef.current = selectedSpeakerId;
  }, [selectedSpeakerId]);

  // Recorded Section: only CompactAudioPlayer may play the beat — booth monitor stays dead
  useEffect(() => {
    if (phase !== "review") return;
    try {
      const el = beatAudioRef.current;
      if (!el) return;
      el.pause();
      el.volume = 0;
      el.muted = true;
    } catch {
      /* ignore */
    }
  }, [phase, localBlobUrl, reviewVoiceOnly]);

  // Apply speaker choice whenever it changes (and when beat element is ready)
  useEffect(() => {
    void routePlaybackToPreferredOutput(beatAudioRef.current, selectedSpeakerId || undefined);
  }, [selectedSpeakerId, beatUrl]);

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
      const layers = Array.isArray(j.layers) ? j.layers : [];
      setPreviewLayers(layers);
      // Diagnostics behind studio_debug_audio
      try {
        if (
          typeof window !== "undefined" &&
          localStorage.getItem("studio_debug_audio") === "1"
        ) {
          console.info("[session-preview diagnostics]", {
            vocalLayerCount: j.vocal_layer_count ?? layers.length,
            selectedTaskIds: j.selected_task_ids,
            matchedTaskIds: j.matched_task_ids,
            unmatched: j.unmatched_selected_task_ids,
            diagnostics: j.diagnostics ?? [],
            placementStartMs: layers.map((l: { start_ms?: number }) => l.start_ms),
          });
        }
      } catch {
        /* ignore */
      }
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
      try {
        const planRes = await fetch(`/api/projects/${id}/plan`);
        if (planRes.ok) {
          const pj = await planRes.json();
          if (pj.plan_mode) setPlanMode(pj.plan_mode);
          if (Array.isArray(pj.tasks)) {
            // Full list for PlanEditor (includes deselected / inactive)
            setPlanTasks(pj.tasks as PlanEditorTask[]);
          }
        }
      } catch {
        /* non-fatal */
      }
      let recordingCount = 0;
      const sr = await fetch(`/api/projects/${id}/status`);
      if (sr.ok) {
        const st = await sr.json();
        if (st.project) {
          loadedProject = st.project;
          setProject(st.project);
        }
        if (st.master_url) setMasterUrl(st.master_url);
        if (typeof st.recording_count === "number") recordingCount = st.recording_count;

        const jobs = (st.jobs || []) as { type?: string; status?: string; stage?: string }[];
        const produceJob = jobs.find((j) => j.type === "PRODUCE_SONG");
        const js = (produceJob?.status || "").toLowerCase();
        if (js === "queued" || js === "processing") {
          setProducing(true);
          setScreen("assemble");
          setProduceStage(produceJob?.stage || "processing");
          produceStartedAtRef.current = Date.now();
          produceActiveRef.current = true;
          resumedRef.current = true;
          scheduleProducePoll();
        }
      }
      // Plan list may lag; if session tasks empty, hydrate from /plan active rows
      if (loadedTasks.length === 0) {
        try {
          const planRes = await fetch(`/api/projects/${id}/plan`);
          if (planRes.ok) {
            const pj = await planRes.json();
            if (pj.plan_mode) setPlanMode(pj.plan_mode);
            if (Array.isArray(pj.tasks) && pj.tasks.length) {
              setPlanTasks(pj.tasks as PlanEditorTask[]);
              const active = (pj.tasks as Task[]).filter((row) => {
                const task = row as Task & { active?: boolean | null; selected_in_plan?: boolean | null };
                if (task.active === false) return false;
                if (task.selected_in_plan === false) return false;
                if (task.status === "skipped") return false;
                return true;
              });
              if (active.length) {
                loadedTasks = active;
                setTasks(active);
              }
            }
          }
        } catch {
          /* non-fatal */
        }
      }

      if (loadedProject && !resumedRef.current) {
        const hasProgress =
          recordingCount > 0 ||
          loadedTasks.some(
            (task) =>
              task.status === "completed" ||
              task.status === "in_progress" ||
              isTaskDone(task)
          );
        const next = screenForStatus(
          loadedProject.status,
          loadedTasks.length > 0,
          hasProgress
        );
        if (next && !produceActiveRef.current) {
          setScreen(next);
          if (next === "session") {
            const open =
              loadedTasks.find((task) => isTaskOpen(task) && task.required) ||
              loadedTasks.find((task) => isTaskOpen(task)) ||
              loadedTasks[0] ||
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
      if (duckRafRef.current) cancelAnimationFrame(duckRafRef.current);
      try {
        speakerDuckRef.current?.stop();
      } catch {
        /* ignore */
      }
      clearProducePoll();
    };
  }, []);

  /** Open Planner without generating. AI generation is an explicit action on the plan screen. */
  function openPlanner() {
    setError(null);
    setScreen("plan");
  }

  /**
   * Generate AI production plan (analyze + persist tasks).
   * Called only from explicit Generate / Next Step — never from tab switch.
   * Uses the intended mode explicitly (no stale setState-before-read).
   */
  async function generateAiPlan(explicitMode: PlanMode = "ai") {
    setAnalyzing(true);
    setError(null);
    setPlanMode(explicitMode);
    setScreen("analyzing");
    try {
      // Persist mode preference (non-destructive)
      await fetch(`/api/projects/${id}/plan`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set_mode", mode: explicitMode }),
      }).catch(() => undefined);

      const res = await fetch(`/api/projects/${id}/analyze`, { method: "POST" });
      const j = await res.json().catch(() => ({} as Record<string, unknown>));
      if (!res.ok) {
        const msg =
          (typeof j.error === "string" && j.error) ||
          (typeof j.message === "string" && j.message) ||
          `Analyze failed (${res.status})`;
        throw new Error(msg);
      }

      const [tr, planRes, sr] = await Promise.all([
        fetch(`/api/projects/${id}/recording-tasks`),
        fetch(`/api/projects/${id}/plan`),
        fetch(`/api/projects/${id}/status`),
      ]);
      let nextTasks: Task[] = [];
      if (tr.ok) {
        nextTasks = (await tr.json()).tasks || [];
      }
      let nextPlan: PlanEditorTask[] = [];
      if (planRes.ok) {
        const pj = await planRes.json();
        if (Array.isArray(pj.tasks)) nextPlan = pj.tasks as PlanEditorTask[];
        if (pj.plan_mode) setPlanMode(pj.plan_mode);
      }
      if (nextPlan.length) setPlanTasks(nextPlan);
      if (nextTasks.length === 0 && nextPlan.length > 0) {
        nextTasks = activeSessionTasksFromPlan(nextPlan);
      }
      setTasks(nextTasks);
      if (sr.ok) setProject((await sr.json()).project);
      else if (j.project_status) {
        setProject((p) => (p ? { ...p, status: String(j.project_status) } : p));
      }
      setScreen("plan");
    } catch (e) {
      setError(e instanceof Error ? e.message : "AI plan generation failed");
      // Stay on plan so user can retry — never blank
      setScreen("plan");
    } finally {
      setAnalyzing(false);
    }
  }

  /** Beat Ready primary CTA: existing plan → Planner; otherwise open Planner for mode choice. */
  async function startProducerSession() {
    if (
      tasks.length > 0 ||
      planTasks.length > 0 ||
      ["blueprint_ready", "recording", "processing", "mixing", "mastering", "complete"].includes(
        project?.status || ""
      )
    ) {
      openPlanner();
      return;
    }
    // New project: open Planner first so user can choose AI Plan vs Customize
    openPlanner();
  }

  async function enterSession() {
    let list = tasks.filter((t) => t.status !== "skipped");
    if (list.length === 0 && planTasks.length > 0) {
      list = activeSessionTasksFromPlan(planTasks);
      if (list.length) setTasks(list);
    }
    const open =
      list.find((t) => t.status === "pending" || t.status === "in_progress") ||
      list[0] ||
      null;
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


  function stopSpeakerDuck() {
    if (duckRafRef.current) {
      cancelAnimationFrame(duckRafRef.current);
      duckRafRef.current = null;
    }
    try {
      if (speakerDuckRef.current) {
        // Freeze final session stats before teardown
        lastDuckSummaryRef.current = speakerDuckRef.current.getSummary();
        speakerDuckRef.current.stop();
      }
    } catch {
      /* ignore */
    }
    speakerDuckRef.current = null;
  }

  function startSpeakerDuckIfNeeded(micStream: MediaStream) {
    stopSpeakerDuck();
    lastDuckSummaryRef.current = null;
    // Headphones / AirPods / external: never start VAD duck
    if (!isPhoneSpeakerOutput(selectedSpeakerIdRef.current)) return;
    const handle = startSpeakerMonitorDuck(micStream, () => beatAudioRef.current);
    speakerDuckRef.current = handle;
    const loop = () => {
      if (!speakerDuckRef.current) return;
      const d = speakerDuckRef.current.tick();
      lastDuckSummaryRef.current = d;
      try {
        if (
          typeof window !== "undefined" &&
          localStorage.getItem("studio_debug_audio") === "1"
        ) {
          sessionStorage.setItem(
            "studio_last_recording_device",
            JSON.stringify({
              voiceActivity: d.voiceActivity,
              duckingActive: d.duckingActive,
              beatMonitorVolume: d.currentBeatMonitorVolume,
              normalVolume: d.normalBeatVolume ?? 0.05,
              duckedVolume: d.duckedBeatVolume ?? d.currentBeatMonitorVolume,
              duckingReductionDb: d.duckingReductionDb,
              micRms: d.micRms,
              micPeak: d.micPeak,
              rmsSilentAvg: d.rmsSilentAvg,
              rmsVoiceAvg: d.rmsVoiceAvg,
              rmsPeak: d.rmsPeak,
              voiceToBleedRatio: d.voiceToBleedRatio,
              duckEventCount: d.duckEventCount,
              lastDuckStartMs: d.lastDuckStartMs,
              lastDuckReleaseMs: d.lastDuckReleaseMs,
              duckEvents: d.events,
              requestedOutput: selectedSpeakerIdRef.current,
              actualOutput: selectedSpeakerIdRef.current,
              routeIsPhoneSpeaker: true,
              at: Date.now(),
            })
          );
        }
      } catch {
        /* ignore */
      }
      duckRafRef.current = requestAnimationFrame(loop);
    };
    duckRafRef.current = requestAnimationFrame(loop);
  }

  function beginMediaCapture(stream: MediaStream, task: Task) {
    chunksRef.current = [];
    autoStoppedRef.current = false;
    // Mark actual MediaRecorder start on the session timeline (musical offset)
    if (sessionTimelineRef.current) {
      sessionTimelineRef.current = markRecordingStart(sessionTimelineRef.current);
      setLastRecordingOffsetMs(sessionTimelineRef.current.recordingOffsetMs);
    }
    // Vocal-only MediaRecorder — stream must be mic path, never beat mix
    const { recorder: rec, mimeType: mime } = createVocalRecorder(stream);
    mimeRef.current = mime;
    mediaRecorderRef.current = rec;
    rec.ondataavailable = (e) => {
      if (e.data?.size) chunksRef.current.push(e.data);
    };
    rec.onstop = async () => {
      clearRecordTimers();
      stopSpeakerDuck();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setMicStream(null);
      beatAudioRef.current?.pause();
      const blob = new Blob(chunksRef.current, { type: mimeRef.current.split(";")[0] });
      const wallClockMs = Date.now() - startedAtRef.current;
      setLocalBlobUrl(URL.createObjectURL(blob));
      // BUG2: only ONE beat source in review — stop booth monitor element
      try {
        beatAudioRef.current?.pause();
        if (beatAudioRef.current) {
          beatAudioRef.current.volume = 0;
          beatAudioRef.current.muted = true;
        }
      } catch {
        /* ignore */
      }
      setPhase("review");
      setUploading(true);
      setProducerTip(null);
      try {
        // Finalize timeline duration (wall-clock of MediaRecorder; not stretched)
        if (sessionTimelineRef.current) {
          sessionTimelineRef.current = markRecordingStop(sessionTimelineRef.current);
        }
        const tl = sessionTimelineRef.current;
        const offsetMs = tl?.recordingOffsetMs ?? 0;
        const sectionStart = tl?.sectionStartMs ?? (task.start_ms ?? 0);
        const placeMs = tl
          ? placementStartMs(tl)
          : resolvePlacementStartMs({ sectionStartMs: sectionStart, recordingOffsetMs: offsetMs });
        const recordedMs = tl?.recordedDurationMs ?? wallClockMs;
        setLastRecordingOffsetMs(offsetMs);

        const form = new FormData();
        form.append("file", blob, "take.webm");
        form.append("source", "record");
        form.append("duration_ms", String(recordedMs));
        form.append("recording_offset_ms", String(offsetMs));
        form.append("placement_start_ms", String(placeMs));
        form.append("section_start_ms", String(sectionStart));
        if (tl?.sectionEndMs != null) form.append("section_end_ms", String(tl.sectionEndMs));
        form.append("task_id", task.id);
        if (tl) {
          form.append("session_timeline", JSON.stringify(sessionTimelineToMeta(tl)));
        }
        // Diagnostic-only analysis of ORIGINAL MediaRecorder blob (never mutates blob)
        let blobAnalysis: CaptureBleedAnalysis | null = null;
        try {
          blobAnalysis = await analyzeOriginalCaptureBleed(blob, {
            beatInMediaRecorder: false,
            duck: lastDuckSummaryRef.current,
            recordingStartPerfMs: recordingStartPerfRef.current,
          });
          lastBlobAnalysisRef.current = blobAnalysis;
        } catch {
          blobAnalysis = null;
        }

        // Forensic: capture purity — beat is never in this MediaRecorder graph
        try {
          const duck = lastDuckSummaryRef.current;
          const liveClass = classifyCapture({
            beatInMediaRecorder: false,
            rmsSilentAvg: duck?.rmsSilentAvg ?? null,
            rmsVoiceAvg: duck?.rmsVoiceAvg ?? null,
          });
          const finalClass = blobAnalysis?.classification ?? liveClass.classification;
          const finalReason = blobAnalysis?.classificationReason ?? liveClass.reason;
          const summary = buildCaptureDiagnosticSummary({
            route: isPhoneSpeakerOutput(selectedSpeakerIdRef.current)
              ? "phone_mic+phone_speaker"
              : "other",
            requestedInput: lastCaptureDeviceRef.current.requestedInput || selectedMicIdRef.current || null,
            actualInput:
              lastCaptureDeviceRef.current.actualInputLabel ||
              lastCaptureDeviceRef.current.actualInput ||
              selectedMicIdRef.current ||
              null,
            requestedOutput: lastCaptureDeviceRef.current.requestedOutput || selectedSpeakerIdRef.current || null,
            actualOutput: lastCaptureDeviceRef.current.actualOutput || selectedSpeakerIdRef.current || null,
            beatInMediaRecorder: false,
            duckEventCount: duck?.duckEventCount ?? 0,
            analysis: blobAnalysis,
          });
          sessionStorage.setItem("studio_last_capture_summary", JSON.stringify(summary));
          sessionStorage.setItem(
            "studio_last_capture_forensics",
            JSON.stringify({
              mimeType: mimeRef.current,
              blobBytes: blob.size,
              wallClockRecordingMs: wallClockMs,
              beat_in_media_recorder: false,
              beatInMediaRecorder: false,
              beat_capture_possible: "acoustic_only_if_phone_speaker",
              captureGraph: "mic→getUserMedia→MediaRecorder (vocal only); beat→HTMLAudioElement",
              speaker_monitor_duck: isPhoneSpeakerOutput(selectedSpeakerIdRef.current),
              requestedInput: summary.requestedInput,
              actualInput: summary.actualInput,
              requestedOutput: summary.requestedOutput,
              actualOutput: summary.actualOutput,
              recordingOffsetMs: offsetMs,
              placementStartMs: placeMs,
              // Live mic (while recording)
              liveRmsSilentAvg: duck?.rmsSilentAvg ?? null,
              liveRmsVoiceAvg: duck?.rmsVoiceAvg ?? null,
              liveRmsPeak: duck?.rmsPeak ?? null,
              liveVoiceToBleedRatio: duck?.voiceToBleedRatio ?? null,
              duckEventCount: duck?.duckEventCount ?? 0,
              lastDuckStartMs: duck?.lastDuckStartMs ?? null,
              lastDuckReleaseMs: duck?.lastDuckReleaseMs ?? null,
              duckEvents: duck?.events ?? [],
              normalBeatVolume: duck?.normalBeatVolume ?? 0.05,
              duckedBeatVolume: duck?.duckedBeatVolume ?? 0.028,
              averageDuckedVolume: duck?.averageDuckedVolume ?? null,
              // Original blob analysis (diagnostic only — blob not modified)
              originalCaptureUnprocessed: true,
              originalDurationMs: blobAnalysis?.originalDurationMs ?? null,
              vocalEnergy: blobAnalysis?.vocalRms ?? null,
              backgroundEnergy: blobAnalysis?.backgroundRms ?? null,
              voiceToBackgroundRatio: blobAnalysis?.voiceToBackgroundRatio ?? null,
              backgroundLowBandEnergy: blobAnalysis?.backgroundLowBandEnergy ?? null,
              backgroundRmsBeforeDuck: blobAnalysis?.backgroundRmsBeforeDuck ?? null,
              backgroundRmsDuringDuck: blobAnalysis?.backgroundRmsDuringDuck ?? null,
              backgroundRmsAfterDuck: blobAnalysis?.backgroundRmsAfterDuck ?? null,
              duckBackgroundReduction: blobAnalysis?.duckBackgroundReduction ?? null,
              blobAnalysisOk: blobAnalysis?.ok ?? false,
              blobAnalysisMethod: blobAnalysis?.analysisMethod ?? null,
              blobAnalysisLimitations: blobAnalysis?.limitations ?? [],
              classification: finalClass,
              classificationReason: finalReason,
              summary,
              at: Date.now(),
            })
          );
        } catch {
          /* ignore */
        }
        const attached = await attachAnalysisToForm(form, blob, task, id);
        try {
          const prev = sessionStorage.getItem("studio_last_capture_forensics");
          const base = prev ? JSON.parse(prev) : {};
          sessionStorage.setItem(
            "studio_last_capture_forensics",
            JSON.stringify({
              ...base,
              analysisDurationMs: attached.analysis?.durationMs ?? null,
              mic_peak: attached.analysis?.loudness?.peak ?? null,
              mic_rms: attached.analysis?.loudness?.rms ?? null,
              micPeak: attached.analysis?.loudness?.peak ?? null,
              micRms: attached.analysis?.loudness?.rms ?? null,
              sourceSampleRate: attached.sourceSampleRate,
              conversionSampleRate: attached.conversionSampleRate,
              conversionMethod: attached.conversionMethod,
              durationMs: attached.analysis?.durationMs ?? wallClockMs,
              // Reaffirm: analysis above did not modify the stored take
              originalCaptureUnprocessed: true,
              at: Date.now(),
            })
          );
        } catch {
          /* ignore */
        }
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
    recordingStartPerfRef.current = performance.now();
    lastBlobAnalysisRef.current = null;
    // Beat seeks to canonical section start (musical position), not 0
    if (beatAudioRef.current && beatUrl) {
      void routePlaybackToPreferredOutput(beatAudioRef.current, selectedSpeakerIdRef.current || undefined);
      beatAudioRef.current.currentTime = (task.start_ms ?? 0) / 1000;
      const isSpeaker = isPhoneSpeakerOutput(selectedSpeakerIdRef.current);
      beatAudioRef.current.muted = false;
      // Phone speaker: keep monitor low to reduce acoustic bleed into phone mic
      beatAudioRef.current.volume = isSpeaker ? 0.05 : 0.12;
      beatAudioRef.current.play().catch(() => undefined);
    }
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

    rec.start(250);
    setPhase("recording");
    // Phone speaker only: VAD duck on monitor — MediaRecorder graph unchanged
    startSpeakerDuckIfNeeded(stream);
  }

  async function startRecording() {
    if (!current) return;
    setError(null);
    setProducerTip(null);
    setSavedRecordingId(null);
    try {
      // CAPTURE: phone mic only (RecordingEngine). MONITOR: beat via setSinkId — separate graphs.
      const opened = await openRecordingStream({
        preferredInputId: selectedMicIdRef.current,
        outputPreference: selectedSpeakerIdRef.current || "__headphones__",
      });
      // Keep the artist's selection in the picker; do not silently rewrite it to the OS mic.
      // Surface honest routing status when the platform overrode input.
      lastCaptureDeviceRef.current = {
        actualInput: (opened.info as { actualDeviceId?: string }).actualDeviceId
          ?? (opened.info as { deviceId?: string }).deviceId
          ?? null,
        actualInputLabel: opened.info.actualInputLabel ?? null,
        routingStatus: opened.info.routingStatus ?? null,
        requestedInput: selectedMicIdRef.current || null,
        requestedOutput: selectedSpeakerIdRef.current || null,
        actualOutput: selectedSpeakerIdRef.current || null,
      };
      try {
        if (typeof window !== "undefined" && localStorage.getItem("studio_debug_audio") === "1") {
          sessionStorage.setItem(
            "studio_last_recording_device",
            JSON.stringify({
              ...lastCaptureDeviceRef.current,
              actualOutput: selectedSpeakerIdRef.current,
              at: Date.now(),
            })
          );
        }
      } catch {
        /* ignore */
      }
      const qualityWarn = describeInputQualityWarning(opened.info);
      if (qualityWarn) {
        setError(qualityWarn);
      } else if (opened.fellBack && opened.info.routingStatus === "FALLBACK") {
        setError(
          opened.info.actualInputLabel
            ? `Using microphone: “${opened.info.actualInputLabel}”`
            : "Selected microphone unavailable — using default mic"
        );
      }
      streamRef.current = opened.recordStream;
      setMicStream(opened.stream);
      // Playback route only — does not change MediaRecorder input (beat stays on <audio>)
      await routePlaybackToPreferredOutput(
        beatAudioRef.current,
        selectedSpeakerIdRef.current || undefined
      );
      // Canonical session timeline from task musical position (never rewritten by plan)
      let tl = createSessionTimeline({
        taskId: current.id,
        sectionStartMs: current.start_ms ?? 0,
        sectionEndMs: current.end_ms,
        countInMs: 3000,
      });
      tl = markCountdownStart(tl);
      sessionTimelineRef.current = tl;
      setLastRecordingOffsetMs(0);

      setCountdown(3);
      setPhase("countdown");
      void markRecordingStatus();
      if (beatAudioRef.current && beatUrl) {
        // Pre-roll: beat seeks to sectionStart - countIn (musical clock)
        beatAudioRef.current.currentTime = Math.max(0, ((current.start_ms ?? 0) - 3000) / 1000);
        const isSpeaker = isPhoneSpeakerOutput(selectedSpeakerIdRef.current);
        beatAudioRef.current.muted = false;
        // Lower monitor level — reduces bleed if OS still routes to the phone speaker
        beatAudioRef.current.volume = isSpeaker ? 0.05 : 0.12;
        beatAudioRef.current.play().catch(() => undefined);
      }
      const captureStream = opened.recordStream;
      let n = 3;
      if (countdownRef.current) clearInterval(countdownRef.current);
      countdownRef.current = setInterval(() => {
        n -= 1;
        if (n <= 0) {
          if (countdownRef.current) clearInterval(countdownRef.current);
          countdownRef.current = null;
          setCountdown(0);
          beginMediaCapture(captureStream, current);
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
    stopSpeakerDuck();
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
    stopSpeakerDuck();
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
      const res = await fetch(`/api/recording-tasks/${current.id}/skip`, { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "Skip failed");
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

  async function skipAllOptional() {
    const openOptional = optionalOpen(tasks);
    if (openOptional.length === 0) return;
    if (phase === "recording" || phase === "countdown") return;
    setSkipping(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${id}/skip-optional`, { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "Could not skip optional parts");
      setTasks((prev) => {
        const next = prev.map((t) =>
          !t.required && (t.status === "pending" || t.status === "in_progress")
            ? { ...t, status: "skipped" }
            : t
        );
        setActiveTaskId(null);
        setLocalBlobUrl(null);
        setSavedRecordingId(null);
        setPhase("ready");
        if (requiredOpen(next).length === 0) {
          setScreen("assemble");
        } else {
          setScreen("session");
          const nextReq = requiredOpen(next)[0];
          if (nextReq) setActiveTaskId(nextReq.id);
        }
        return next;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Skip all failed");
    } finally {
      setSkipping(false);
    }
  }

  async function startProduce() {
    const gate = canProduce(
      tasks.map((t) => ({
        id: t.id,
        type: t.type,
        status: t.status,
        required: t.required,
        start_ms: t.start_ms,
        end_ms: t.end_ms,
        active: true,
        selected_in_plan: true,
      }))
    );
    if (!gate.ok) {
      setError(gate.reason || "Record at least one selected part before Produce.");
      setScreen("assemble");
      return;
    }
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
              {analyzing
                ? "Generating…"
                : tasks.length > 0 || planTasks.length > 0
                  ? "Continue plan"
                  : "Open Planner"}
            </button>
          </div>
        )}

        {screen === "analyzing" && (
          <div style={wrap}>
            <PlayerLoadingState
              title="Generating your AI production plan…"
              subtitle="Mapping sections and building recording tasks"
              seed={`analyze-${id}`}
            />
            {error && (
              <p style={{ color: C.danger, marginTop: 16 }}>
                {error}{" "}
                <button
                  type="button"
                  style={{ ...btn2, display: "inline", padding: "6px 12px", marginLeft: 8 }}
                  onClick={() => void generateAiPlan("ai")}
                >
                  Retry
                </button>
              </p>
            )}
          </div>
        )}

        {screen === "plan" && (
          <div style={wrap}>
            <button
              type="button"
              style={{ background: "none", border: "none", color: C.textMuted, cursor: "pointer", padding: 0 }}
              onClick={() => setScreen("beat")}
            >
              ← Beat
            </button>
            <h1 style={{ ...titleStyle, marginTop: 12 }}>Song plan</h1>
            <p style={{ color: C.textMuted, fontSize: 14, marginTop: 4 }}>
              AI suggests. You decide. Only parts you keep are in your active plan.
            </p>
            {error && (
              <p style={{ color: C.danger, fontSize: 14 }}>
                {error}{" "}
                <button
                  type="button"
                  style={{ ...btn2, display: "inline", padding: "6px 12px", marginLeft: 8 }}
                  disabled={analyzing}
                  onClick={() => void generateAiPlan(planMode === "customize" ? "customize" : "ai")}
                >
                  Retry
                </button>
              </p>
            )}
            <PlanEditor
              projectId={id}
              tasks={(planTasks.length > 0 ? planTasks : (tasks as PlanEditorTask[]))}
              planMode={planMode}
              onModeChange={setPlanMode}
              onTasksChange={(next) => {
                setPlanTasks(next);
                const active = next
                  .filter((t) => t.active !== false && t.selected_in_plan !== false)
                  .map((t) => ({
                    id: t.id,
                    type: t.type,
                    title: t.title,
                    instruction: t.instruction || "",
                    reason: t.reason,
                    status: t.status,
                    required: Boolean(t.required),
                    start_ms: t.start_ms,
                    end_ms: t.end_ms,
                    section_id: t.section_id,
                    metadata: t.metadata as Task["metadata"],
                  }));
                setTasks(active);
                // Refresh session list from active-plan endpoint
                void fetch(`/api/projects/${id}/recording-tasks`)
                  .then((r) => r.json())
                  .then((j) => {
                    if (Array.isArray(j.tasks)) setTasks(j.tasks);
                  })
                  .catch(() => undefined);
              }}
            />

            {/* Explicit generate — only when no plan yet; never on tab switch */}
            {planTasks.length === 0 && tasks.length === 0 && planMode !== "scratch" && (
              <button
                type="button"
                style={{ ...btn, marginTop: 20 }}
                disabled={analyzing || !beatUrl}
                onClick={() => void generateAiPlan(planMode)}
              >
                {analyzing
                  ? "Generating…"
                  : planMode === "ai"
                    ? "Generate AI Plan"
                    : "Generate recommendations to customize"}
              </button>
            )}
            {planTasks.length === 0 && tasks.length === 0 && planMode === "scratch" && (
              <p style={{ color: C.textMuted, fontSize: 13, marginTop: 16 }}>
                Use “+ Add custom part” above to build your plan from scratch. No AI generation required.
              </p>
            )}

            {(planTasks.length > 0 || tasks.length > 0) && (
              <>
                <SessionSteps tasks={tasks} locked={false} onSelect={selectTask} />
                <ProjectSamplesPanel projectId={id} />
                <button
                  type="button"
                  style={{ ...btn, marginTop: 20 }}
                  onClick={enterSession}
                  disabled={
                    analyzing ||
                    (tasks.filter((t) => t.status !== "skipped").length === 0 &&
                      activeSessionTasksFromPlan(planTasks).length === 0)
                  }
                >
                  Start recording
                </button>
                {tasks.some((t) => t.status === "pending" || t.status === "in_progress") && (
                  <button
                    type="button"
                    style={{ ...btn2, marginTop: 10 }}
                    disabled={skipping || analyzing}
                    onClick={() => void skipAllOptional()}
                  >
                    {skipping ? "Skipping…" : "Skip remaining optional parts"}
                  </button>
                )}
              </>
            )}
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
                <SpeakerOutputPicker
                  selectedDeviceId={selectedSpeakerId}
                  onSelect={setSelectedSpeakerId}
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
                    {skipping ? "Skipping…" : "Skip this part"}
                  </button>
                )}
                {optionalOpen(tasks).length > 0 && (
                  <button
                    type="button"
                    style={{ ...btn2, marginTop: 10 }}
                    disabled={skipping}
                    onClick={() => void skipAllOptional()}
                  >
                    {skipping
                      ? "Skipping…"
                      : optionalOpen(tasks).length === 1
                        ? "Skip optional part"
                        : `Skip all optional (${optionalOpen(tasks).length})`}
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
                  <>
                    <CompactAudioPlayer
                      src={localBlobUrl}
                      label="Your take"
                      seed={`take-${current.id}`}
                      beatSrc={beatUrl}
                      beatStartMs={reviewBeatStartMs(
                        current.start_ms ?? 0,
                        lastRecordingOffsetMs
                      )}
                      beatEndMs={current.end_ms}
                      vocalVolume={1}
                      beatVolume={reviewVoiceOnly ? 0 : 0.45}
                    />
                    <button
                      type="button"
                      onClick={() => setReviewVoiceOnly((v) => !v)}
                      style={{
                        display: "block",
                        margin: "10px auto 0",
                        padding: "8px 14px",
                        borderRadius: 999,
                        border: `1px solid ${C.border}`,
                        background: reviewVoiceOnly ? C.brassSoft : "transparent",
                        color: reviewVoiceOnly ? C.brass : C.textMuted,
                        fontSize: 13,
                        fontWeight: 600,
                        cursor: "pointer",
                        fontFamily: "inherit",
                      }}
                    >
                      {reviewVoiceOnly ? "Voice only · on" : "Beat + Voice"}
                    </button>
                  </>
                )}
                {producerTip && (
                  <p style={{ marginTop: 10, fontSize: 13.5, color: C.signal, lineHeight: 1.45 }}>{producerTip}</p>
                )}
                <button type="button" style={{ ...btn, marginTop: 16 }} disabled={uploading || !savedRecordingId} onClick={keepAndContinue}>
                  {uploading ? "Saving…" : "Keep take"}
                </button>
                {savedRecordingId && current && (current.type || "").toUpperCase().includes("LEAD") && (
                  <button
                    type="button"
                    style={{ ...btn2, marginTop: 8 }}
                    disabled={uploading || skipping}
                    onClick={() => {
                      void (async () => {
                        keepAndContinue();
                        try {
                          await fetch(`/api/projects/${id}/plan`, {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              action: "add",
                              task: {
                                type: "DOUBLE",
                                title: "Double",
                                instruction: "Sing the same line again, matching your lead as closely as you can.",
                                start_ms: current.start_ms ?? 0,
                                end_ms: current.end_ms ?? (current.start_ms ?? 0) + 8000,
                                section_id: current.section_id,
                                section_label: current.metadata?.section_label,
                              },
                            }),
                          });
                          const tr = await fetch(`/api/projects/${id}/recording-tasks`);
                          if (tr.ok) setTasks((await tr.json()).tasks || []);
                        } catch {
                          /* non-fatal */
                        }
                      })();
                    }}
                  >
                    Add a double (optional)
                  </button>
                )}
                <button
                  type="button"
                  style={{ ...btn2, marginTop: 8 }}
                  disabled={uploading}
                  onClick={() => {
                    setLocalBlobUrl(null);
                    setSavedRecordingId(null);
                    setProducerTip(null);
                    setReviewVoiceOnly(false);
                    setPhase("ready");
                  }}
                >
                  Record again
                </button>
                {savedRecordingId && (
                  <button
                    type="button"
                    style={{ ...btn2, marginTop: 8 }}
                    disabled={uploading}
                    onClick={() => {
                      if (savedRecordingId) keepAndContinue();
                      setScreen("assemble");
                    }}
                  >
                    I'm done — preview song
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {screen === "session" && !current && (
          <div style={wrap}>
            <h1 style={titleStyle}>
              {optionalOpen(tasks).length > 0 ? "Optional parts left" : "All parts done"}
            </h1>
            <p style={{ color: C.textMuted, textAlign: "center" }}>
              {optionalOpen(tasks).length > 0
                ? "You can record optional parts or skip them all and continue to preview."
                : "Hear your full arrangement (beat + every section) before producing."}
            </p>
            {optionalOpen(tasks).length > 0 && (
              <button
                type="button"
                style={{ ...btn2, marginTop: 16 }}
                disabled={skipping}
                onClick={() => void skipAllOptional()}
              >
                {skipping
                  ? "Skipping…"
                  : `Skip all optional (${optionalOpen(tasks).length})`}
              </button>
            )}
            <button type="button" style={{ ...btn, marginTop: 12 }} onClick={() => setScreen("assemble")}>
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
                {error && <p style={{ color: C.danger, textAlign: "center" }}>{error}</p>}

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
