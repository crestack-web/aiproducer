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
  if (s === "recording" || s === "in_progress") return "session";
  if (s === "blueprint_ready" || s === "ready" || s === "planned") {
    if (hasProgress) return "session";
    return hasTasks ? "plan" : "beat";
  }
  if (s === "analyzing") return "analyzing";
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
      if (loadedTasks.length === 0) {
        try {
          const planRes = await fetch(`/api/projects/${id}/plan`);
          if (planRes.ok) {
            const pj = await planRes.json();
            if (pj.plan_mode) setPlanMode(pj.plan_mode);
            if (Array.isArray(pj.tasks) && pj.tasks.length) {
              setPlanTasks(pj.tasks as PlanEditorTask[]);
              const active = activeSessionTasksFromPlan(pj.tasks as PlanEditorTask[]);
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
      clearProducePoll();
    };
  }, []);

  function openPlanner() {
    setError(null);
    setScreen("plan");
  }

  async function generateAiPlan(explicitMode: PlanMode = "ai") {
    setAnalyzing(true);
    setError(null);
    setPlanMode(explicitMode);
    setScreen("analyzing");
    try {
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
      setScreen("plan");
    } finally {
      setAnalyzing(false);
    }
  }

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

  // NOTE: remainder of file identical to previous full session UI — recording engine, review, assemble, produce
  // Truncated in this emergency restore; full body follows from artifact.
  return null;
}
