"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  StudioPlayer,
  CompactAudioPlayer,
  RecordingVisualizer,
  PlayerLoadingState,
} from "@/components/studio-player";
import { forceDownloadFromApi } from "@/lib/download-audio";
import { ApPaywall } from "@/components/ap-paywall";
import { PromptTweakPanel } from "@/components/prompt-tweak-panel";
import { SongPreviewPlayer, type SongPreviewLayer } from "@/components/song-preview-player";
import {
  MicInputPicker,
  SpeakerOutputPicker,
  routePlaybackToPreferredOutput,
} from "@/components/mic-input-picker"
import {
  readPreferredMicId,
  readPreferredSpeakerId,
  readAudioSetupConfirmed,
  writePreferredMicId,
  writePreferredSpeakerId,
  writeAudioSetupConfirmed,
  micSummaryLabel,
  speakerSummaryLabel,
} from "@/lib/audio/device-prefs";
import {
  openRecordingStream,
  createVocalRecorder,
  describeInputQualityWarning,
  formatMicOpenError,
} from "@/lib/audio/recording-engine";
import {
  startSpeakerMonitorDuck,
  isPhoneSpeakerOutput,
  isPhoneHandsetOutput,
  isPhoneBuiltInOutput,
  classifyMonitorMode,
  classifyCapture,
  DEFAULT_SPEAKER_DUCK,
  HANDSET_SPEAKER_DUCK,
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
  markBeatStart,
  markRecordingStart,
  markRecordingStop,
  placementStartMs,
  resolvePlacementStartMs,
  reviewBeatStartMs,
  sessionTimelineToMeta,
  type SessionTimeline,
} from "@/lib/audio/session-timeline";
import { AppShell } from "@/components/app-shell";
import { stableAvatarSeed } from "@/components/artist-avatar";
import { STUDIO_LOGO_URL } from "@/lib/brand";
import {
  SessionSteps,
  sectionLabel,
  isTaskOpen,
  isTaskDone,
  requiredOpen,
  optionalOpen,
  isCoreTask,
  isProductionLayer,
  coreOpen,
  coreDone,
  coreTasks,
  productionLayersAdded,
  nextProductionRecommendation,
  openProductionLayersForSection,
  nextCoreForward,
  openLayersForSection,
  type SessionTask,
  layerRecommendationCopy,
  sectionHasOpenWork,
} from "@/components/session-steps";
import {
  layerPhraseHint,
  normalizeLayerRole,
  sectionGroupKey,
  sameMusicalSection,
} from "@/lib/layer-model";
import { isCompletedTaskStatus } from "@/lib/audio/active-plan-membership";
import { ProjectSamplesPanel } from "@/components/project-samples-panel";
import { useTheme } from "@/lib/theme";
import {
  attachAnalysisToForm,
  fetchProducerRecommendation,
  logLayerSuggestionOutcome,
  type LayerRefinementSuggestionClient,
} from "@/lib/client/recording-analysis";
import { audioBlobToWavDetailed } from "@/lib/client/export-wav";
import { PlanEditor, type PlanEditorTask } from "@/components/plan-editor";
import { canProduce, type PlanMode } from "@/lib/plan";
import { prepareTakesForProduce } from "@/lib/client/prepare-takes-for-produce";
import {
  BoothAdvancedSheet,
  BoothBeatStep,
  BoothDoneStep,
  BoothMakeStep,
  BoothPlanStep,
  BoothRecordStage,
  ConsoleHandoffSheet,
  canMakeSong,
  countInBeatsLeft,
  countInMs as boothCountInMs,
  toBoothParts,
  type BoothMenuItem,
} from "@/components/booth";

/** User-facing produce progress — never show raw pipeline tokens alone. */
function humanProduceStage(stage: string | null | undefined): string {
  if (!stage) return "AP is getting everything ready…";
  const s = stage.toLowerCase().trim();
  const map: Record<string, string> = {
    queued: "Job queued — waiting for the studio engine…",
    preparing: "Preparing your vocal takes…",
    "preparing takes": "Preparing your vocal takes…",
    prepare_vocals: "Preparing your vocal takes…",
    arrange: "Arranging vocals on the beat…",
    arranging: "Arranging vocals on the beat…",
    render_stems: "Building audio stems…",
    analyzing: "Listening to your recording…",
    restoring: "Cleaning up noise and room tone…",
    polishing: "Polishing vocal tone…",
    producing: "Building your vocal sound…",
    mixing: "Blending your voice with the beat…",
    mix: "Blending your voice with the beat…",
    mix_submit: "Sending mix for processing…",
    mix_poll: "Finishing the mix…",
    mix_store: "Saving the mix…",
    mastering: "Adding the final polish…",
    master: "Adding the final polish…",
    master_submit: "Mastering your track…",
    master_poll: "Finishing the master…",
    quality_check: "Checking the final mix…",
    webhook_received: "Finalizing export…",
    complete: "Your song is ready.",
    completed: "Your song is ready.",
    failed: "Production could not finish.",
  };
  if (map[s]) return map[s];
  if (s.includes("mix")) return "Blending your voice with the beat…";
  if (s.includes("master")) return "Adding the final polish…";
  return stage.replace(/_/g, " ");
}

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

function asSessionTask(t: {
  id: string;
  type: string;
  title?: string | null;
  instruction?: string | null;
  reason?: string | null;
  status?: string | null;
  required?: boolean | null;
  start_ms?: number | null;
  end_ms?: number | null;
  section_id?: string | null;
  metadata?: Task["metadata"] | null;
}): Task {
  return {
    id: t.id,
    type: t.type,
    title: t.title ?? null,
    instruction: t.instruction || "",
    reason: t.reason ?? null,
    status: t.status || "pending",
    required: Boolean(t.required),
    start_ms: t.start_ms ?? null,
    end_ms: t.end_ms ?? null,
    section_id: t.section_id ?? null,
    metadata: t.metadata ?? undefined,
  };
}

const PRODUCE_POLL_MS = 3500;
const PRODUCE_MAX_MS = 10 * 60 * 1000;


function formatBoothTime(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "0:00";
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

function formatBoothTimeline(
  startMs: number | null | undefined,
  endMs: number | null | undefined
): string | null {
  if (startMs == null && endMs == null) return null;
  const a = formatBoothTime(startMs ?? 0);
  const b = endMs != null ? formatBoothTime(endMs) : "—";
  return `${a} – ${b}`;
}

function humanTitle(type: string) {
  const t = (type || "").toLowerCase();
  if (t.includes("harmony")) return "Harmony";
  if (t.includes("adlib")) return "Ad-libs";
  if (t.includes("double")) return "Double";
  return "Lead vocal";
}


/** Canonical musical window for a task — prefers columns, then metadata timeline. */
function resolveTaskWindow(task: {
  start_ms?: number | null;
  end_ms?: number | null;
  metadata?: Record<string, unknown> | null;
  title?: string | null;
  type?: string | null;
}): { startMs: number; endMs: number | null; durationMs: number | null } {
  const meta = (task.metadata || {}) as Record<string, unknown>;
  const startCandidate = [
    task.start_ms,
    meta.timeline_start_ms,
    meta.section_start_ms,
    meta.placement_start_ms,
  ].find((v) => v != null && Number.isFinite(Number(v)));
  const endCandidate = [
    task.end_ms,
    meta.timeline_end_ms,
    meta.section_end_ms,
    meta.placement_end_ms,
  ].find((v) => v != null && Number.isFinite(Number(v)));
  const startMs = Math.max(0, Math.round(Number(startCandidate) || 0));
  const endMs =
    endCandidate != null && Number.isFinite(Number(endCandidate))
      ? Math.max(startMs + 500, Math.round(Number(endCandidate)))
      : null;
  const durationMs = endMs != null ? endMs - startMs : null;
  return { startMs, endMs, durationMs };
}

/** Merge plan row times onto a task so review/record never fall back to 0ms wrongly. */
function withPlanTiming<T extends {
  id: string;
  start_ms?: number | null;
  end_ms?: number | null;
  section_id?: string | null;
  metadata?: Record<string, unknown> | null;
}>(task: T, plan: Array<{ id: string; start_ms?: number | null; end_ms?: number | null; section_id?: string | null; metadata?: unknown }> = []): T {
  const p = plan.find((x) => x.id === task.id);
  if (!p) return task;
  return {
    ...task,
    start_ms: task.start_ms ?? p.start_ms ?? null,
    end_ms: task.end_ms ?? p.end_ms ?? null,
    section_id: task.section_id ?? p.section_id ?? null,
    metadata: (task.metadata as Record<string, unknown>) || (p.metadata as Record<string, unknown>) || null,
  };
}

function fmtSectionWindow(startMs: number, endMs: number | null): string {
  const fmt = (ms: number) => {
    const s = Math.max(0, ms) / 1000;
    const m = Math.floor(s / 60);
    const r = Math.floor(s % 60);
    return `${m}:${String(r).padStart(2, "0")}`;
  };
  return endMs != null ? `${fmt(startMs)} → ${fmt(endMs)}` : fmt(startMs);
}
function sectionDurationMs(task: Task): number | null {
  const w = resolveTaskWindow(task);
  return w.durationMs != null && w.durationMs > 500 ? w.durationMs : null;
}

function activeSessionTasksFromPlan(rows: PlanEditorTask[]): Task[] {
  return rows
    .filter((row) => {
      const t = row as PlanEditorTask & {
        active?: boolean | null;
        selected_in_plan?: boolean | null;
      };
      if (t.active === false) return false;
      // null/undefined selected_in_plan means included in plan
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
  if (s === "complete" || s === "completed" || s === "produced" || s === "done") return "done";
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
  const router = useRouter();
  const { colors: C } = useTheme();
  const [boothUserName, setBoothUserName] = useState("Artist");
  const [boothUserEmail, setBoothUserEmail] = useState<string | null>(null);
  const [boothUserId, setBoothUserId] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { createClient } = await import("@/lib/supabase/client");
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user || cancelled) return;
        const { data: profile } = await supabase
          .from("profiles")
          .select("display_name")
          .eq("id", user.id)
          .maybeSingle();
        if (cancelled) return;
        setBoothUserId(user.id);
        setBoothUserEmail(user.email || null);
        setBoothUserName(profile?.display_name || user.email?.split("@")[0] || "Artist");
      } catch {
        /* ignore */
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const [project, setProject] = useState<ProjectMeta | null>(null);
  const [beatUrl, setBeatUrl] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [screen, setScreen] = useState<Screen>("beat");
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [producerTip, setProducerTip] = useState<string | null>(null);
  const [layerSuggestion, setLayerSuggestion] = useState<LayerRefinementSuggestionClient | null>(null);
  const [producing, setProducing] = useState(false);
  const [produceStage, setProduceStage] = useState<string | null>(null);
  const [produceJobId, setProduceJobId] = useState<string | null>(null);
  const [produceProgress, setProduceProgress] = useState(0);
  const [masterUrl, setMasterUrl] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("ready");
  const [countdown, setCountdown] = useState(3);
  const [localBlobUrl, setLocalBlobUrl] = useState<string | null>(null);
  /** Diagnostic-only: exact MediaRecorder Blob (untouched) for raw playback. */
  const rawTakeBlobRef = useRef<Blob | null>(null);
  const rawTakeAudioRef = useRef<HTMLAudioElement | null>(null);
  const [rawCaptureStatus, setRawCaptureStatus] = useState<
    "UNKNOWN" | "RAW_CAPTURE_CLEAN" | "RAW_CAPTURE_DISTORTED" | "RAW_CAPTURE_UNPLAYABLE"
  >("UNKNOWN");
  const [rawCaptureMeta, setRawCaptureMeta] = useState<{
    mimeType: string;
    sizeBytes: number;
    durationSec: number | null;
    canDecode: boolean;
  } | null>(null);
  const [reviewVoiceOnly, setReviewVoiceOnly] = useState(false);
  const [reviewOverdubSrcs, setReviewOverdubSrcs] = useState<
    { url: string; volume?: number; label?: string }[]
  >([]);
  const [taskTakes, setTaskTakes] = useState<
    {
      id: string;
      take_number?: number | null;
      is_selected?: boolean | null;
      duration_ms?: number | null;
      audio_url?: string | null;
    }[]
  >([]);
  const [sectionPreviewOnly, setSectionPreviewOnly] = useState(false);
  const [selectingTakeId, setSelectingTakeId] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [savedRecordingId, setSavedRecordingId] = useState<string | null>(null);
  const [skipping, setSkipping] = useState(false);
  const searchParams = useSearchParams();
  const [planMode, setPlanMode] = useState<PlanMode>("ai");
  /** Full plan list for PlanEditor (includes deselected). Session uses `tasks` (active only). */
  const [planTasks, setPlanTasks] = useState<PlanEditorTask[]>([]);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [micStream, setMicStream] = useState<MediaStream | null>(null);
  const [selectedMicId, setSelectedMicId] = useState("");
  const [selectedSpeakerId, setSelectedSpeakerId] = useState("__handset__");
  /** Full mic/speaker pickers: only forced until the artist confirms once on this device. */
  const [audioSetupOpen, setAudioSetupOpen] = useState(true);
  const audioPrefsHydrated = useRef(false);
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
  /** Existing section vocals played only during layer recording (not into MediaRecorder). */
  const layerMonitorAudiosRef = useRef<HTMLAudioElement[]>([]);
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

    const current: Task | null = (() => {
    if (activeTaskId) {
      const hit = tasks.find((t) => t.id === activeTaskId);
      // Do not fall back to another section's task — that caused "already recorded" UI
      return hit || null;
    }
    return (
      (coreOpen(tasks)[0] as Task | undefined) ||
      (optionalOpen(tasks)[0] as Task | undefined) ||
      null
    );
  })();

  /** Review/Keep UI only when this task actually has a take — never for a fresh lead */
  const showReviewUi =
    phase === "review" &&
    Boolean(current) &&
    Boolean(savedRecordingId || localBlobUrl || taskTakes.some((x) => x.audio_url));

  const currentIsLayer = current ? isProductionLayer(current) : false;
  const sectionLayerStack = (() => {
    if (!current) return [] as Task[];
    const key =
      current.section_id ||
      current.metadata?.section_id ||
      (current.start_ms != null ? `ms:${current.start_ms}` : current.id);
    return tasks.filter((t) => {
      const k =
        t.section_id ||
        t.metadata?.section_id ||
        (t.start_ms != null ? `ms:${t.start_ms}` : t.id);
      return k === key || (current.section_id && t.section_id === current.section_id);
    });
  })();
  /** Saved take exists for this task (review / listen). Not the same as "artist chose Retake". */
  const hasSavedTake = Boolean(
    current &&
      (Boolean(savedRecordingId) ||
        Boolean(localBlobUrl) ||
        taskTakes.some((x) => x.audio_url) ||
        isTaskDone(current))
  );
  /** Ready-phase: task already has a take — offer listen / record-again, not "first Record". */
  const canRecordAgain = Boolean(
    current && isTaskDone(current) && (savedRecordingId || localBlobUrl || taskTakes.some((x) => x.audio_url))
  );
  const sectionMs = current ? sectionDurationMs(current) : null;

  useEffect(() => {
    selectedMicIdRef.current = selectedMicId;
  }, [selectedMicId]);

  useEffect(() => {
    selectedSpeakerIdRef.current = selectedSpeakerId;
  }, [selectedSpeakerId]);

  // Device-level prefs: load once, then persist every change
  useEffect(() => {
    if (audioPrefsHydrated.current) return;
    audioPrefsHydrated.current = true;
    try {
      const mic = readPreferredMicId();
      const spk = readPreferredSpeakerId();
      const confirmed = readAudioSetupConfirmed();
      setSelectedMicId(mic);
      setSelectedSpeakerId(spk);
      selectedMicIdRef.current = mic;
      selectedSpeakerIdRef.current = spk;
      setAudioSetupOpen(!confirmed);
    } catch {
      setAudioSetupOpen(true);
    }
  }, []);

  useEffect(() => {
    if (!audioPrefsHydrated.current) return;
    writePreferredMicId(selectedMicId);
  }, [selectedMicId]);

  useEffect(() => {
    if (!audioPrefsHydrated.current) return;
    writePreferredSpeakerId(selectedSpeakerId);
  }, [selectedSpeakerId]);

  function onMicSelect(deviceId: string) {
    setSelectedMicId(deviceId);
    writePreferredMicId(deviceId);
    writeAudioSetupConfirmed(true);
  }

  function onSpeakerSelect(deviceId: string) {
    setSelectedSpeakerId(deviceId);
    writePreferredSpeakerId(deviceId);
    writeAudioSetupConfirmed(true);
  }

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

  // Review: CompactAudioPlayer owns beat + take only.
  // Do NOT auto-play section layer monitors here — extra <audio> elements on mobile
  // steal the session and leave the take stuck at currentTime=0 / readyState=3 while
  // the beat runs alone (see Review diagnostics). Layers still monitor while RECORDING.
  useEffect(() => {
    if (phase === "review") {
      stopLayerMonitors();
    }
  }, [phase]);

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
    setPreviewError(null);
    try {
      const res = await fetch(`/api/projects/${id}/session-preview`);
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.warn("[session-preview] request failed", res.status, j?.error || j);
        return;
      }
      setPreviewBeatUrl(j.beat_url || beatUrl || null);
      setPreviewBeatDurationMs(
        typeof j.beat_duration_ms === "number" ? j.beat_duration_ms : null
      );
      const layers = Array.isArray(j.layers) ? j.layers : [];
      setPreviewLayers(layers);
    } catch (e) {
      console.warn("[session-preview] load error", e);
      setPreviewError(
        e instanceof Error ? e.message : "Could not load song preview. Try Refresh."
      );
      setPreviewLayers([]);
    } finally {
      setPreviewLoading(false);
    }
  }, [id, beatUrl]);


  function offsetFromTake(t: {
    recording_offset_ms?: number | null;
    metadata?: Record<string, unknown> | null;
  } | null | undefined): number {
    if (!t) return 0;
    if (typeof t.recording_offset_ms === "number" && Number.isFinite(t.recording_offset_ms)) {
      return Math.max(0, Math.round(t.recording_offset_ms));
    }
    const meta = (t.metadata || {}) as Record<string, unknown>;
    if (typeof meta.recording_offset_ms === "number" && Number.isFinite(meta.recording_offset_ms)) {
      return Math.max(0, Math.round(meta.recording_offset_ms as number));
    }
    return 0;
  }

  const applySelectedTakeToReview = useCallback(
    (
      list: {
        id: string;
        take_number?: number | null;
        is_selected?: boolean | null;
        duration_ms?: number | null;
        audio_url?: string | null;
        recording_offset_ms?: number | null;
        metadata?: Record<string, unknown> | null;
      }[]
    ) => {
      if (!list.length) return;
      const selected =
        list.find((t) => t.is_selected) ||
        list[list.length - 1];
      if (selected?.audio_url) {
        setLocalBlobUrl(selected.audio_url);
        setSavedRecordingId(selected.id);
        setLastRecordingOffsetMs(Math.max(0, Math.min(offsetFromTake(selected), 180000)));
      }
    },
    []
  );

  const loadTaskTakes = useCallback(async (taskId: string) => {
    try {
      const res = await fetch(`/api/recording-tasks/${taskId}/recordings`);
      if (!res.ok) {
        setTaskTakes([]);
        return [];
      }
      const j = await res.json();
      const list = (j.recordings || []) as {
        id: string;
        take_number?: number | null;
        is_selected?: boolean | null;
        duration_ms?: number | null;
        audio_url?: string | null;
        recording_offset_ms?: number | null;
        metadata?: Record<string, unknown> | null;
      }[];
      const safe = Array.isArray(list) ? list : [];
      setTaskTakes(safe);
      return safe;
    } catch {
      setTaskTakes([]);
      return [];
    }
  }, []);

  const selectTake = useCallback(
    async (taskId: string, recordingId: string) => {
      setSelectingTakeId(recordingId);
      setError(null);
      try {
        const res = await fetch(
          `/api/recording-tasks/${taskId}/recordings/${recordingId}/select`,
          { method: "POST" }
        );
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(
            (j as { error?: string }).error || "Could not select take — try again"
          );
        }
        const list = await loadTaskTakes(taskId);
        const marked = list.map((tk) => ({
          ...tk,
          is_selected: tk.id === recordingId,
        }));
        setTaskTakes(marked);
        const chosen =
          marked.find((tk) => tk.id === recordingId) ||
          marked.find((tk) => tk.is_selected);
        if (chosen?.audio_url) {
          setLocalBlobUrl(chosen.audio_url);
          setSavedRecordingId(chosen.id);
          setLastRecordingOffsetMs(offsetFromTake(chosen as { recording_offset_ms?: number | null; metadata?: Record<string, unknown> | null }));
        } else {
          applySelectedTakeToReview(marked);
          setError("Take selected but audio URL missing — refresh and try again");
        }
        void loadSongPreview();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not switch take");
      } finally {
        setSelectingTakeId(null);
      }
    },
    [loadTaskTakes, loadSongPreview, applySelectedTakeToReview]
  );


  useEffect(() => {
    if (phase === "review" && current?.id) {
      void loadTaskTakes(current.id).then((list) => {
        // Only replace Review source when we have a server take with URL
        // (keep local blob for the just-recorded take until URLs are ready).
        if (list.some((t) => t.audio_url)) {
          applySelectedTakeToReview(list);
        }
      });
    }
  }, [phase, current?.id, loadTaskTakes, applySelectedTakeToReview]);


  async function markRecordingStatus() {
    try {
      // Never demote a produced project back to "recording" (breaks done-screen resume)
      const cur = (project?.status || "").toLowerCase();
      if (cur === "complete" || cur === "completed" || cur === "produced" || cur === "done") {
        return;
      }
      if (masterUrl) return;
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
                    setLayerSuggestion(null);
    setLocalBlobUrl(null);
    setSavedRecordingId(null);
    setLastRecordingOffsetMs(0);
    setTaskTakes([]);
    setReviewOverdubSrcs([]);
    stopLayerMonitors();
    try {
      if (beatAudioRef.current) {
        beatAudioRef.current.pause();
        const task = tasks.find((t) => t.id === taskId);
        if (task) {
          beatAudioRef.current.currentTime = resolveTaskWindow(task).startMs / 1000;
        }
      }
    } catch {
      /* ignore */
    }
    setActiveTaskId(taskId);
    setScreen("session");
    void markRecordingStatus();

    const task = tasks.find((t) => t.id === taskId);
    // Revisit a completed section: open Review with the selected take so the
    // artist can listen without recording again.
    if (task && isTaskDone(task)) {
      void loadTaskTakes(taskId).then((list) => {
        // Stale "completed" with no files → treat as fresh record
        if (list.some((t) => t.audio_url)) {
          setPhase("review");
          applySelectedTakeToReview(list);
        } else {
          setPhase("ready");
          setSavedRecordingId(null);
          setLocalBlobUrl(null);
          setTasks((prev) =>
            prev.map((t) => (t.id === taskId ? { ...t, status: "pending" } : t))
          );
        }
      });
      return;
    }
    // Fresh / open task — never show Keep take
    setPhase("ready");
    setSavedRecordingId(null);
    setLocalBlobUrl(null);
    setTaskTakes([]);
    // Preload same-section recorded vocals for monitoring while adding layers
    if (task && !isTaskDone(task)) {
      void startLayerMonitors(task, { play: false });
    }
  }

  const pollProduceOnce = useCallback(async (): Promise<
    "complete" | "failed" | "pending" | "error"
  > => {
    try {
      const sr = await fetch(`/api/projects/${id}/status`);
      const st = await sr.json().catch(() => ({}));
      if (!sr.ok) return "error";

      if (st.project) setProject(st.project);
      const jobs = (st.jobs || []) as {
        id?: string;
        type?: string;
        status?: string;
        stage?: string;
        progress?: number;
        error?: string;
      }[];
      // Strict: with produceJobId set, only that job can complete the run.
      const tracked =
        produceJobId ? jobs.find((j) => j.id === produceJobId) : undefined;
      const trackedStatus = String(tracked?.status || "").toLowerCase();

      if (produceJobId && tracked && trackedStatus === "failed") {
        setError(tracked.error || "Produce failed");
        setProduceProgress(100);
        setProducing(false);
        return "failed";
      }

      let produceJob = tracked;
      if (!produceJob && !produceJobId) {
        produceJob =
          jobs.find(
            (j) =>
              j.type === "PRODUCE_SONG" &&
              ["queued", "processing", "running"].includes(String(j.status || "").toLowerCase())
          ) || jobs.find((j) => j.type === "PRODUCE_SONG");
        if (produceJob?.id) setProduceJobId(String(produceJob.id));
      }

      const jobStatus = (produceJob?.status || "").toLowerCase();
      // Only show engine stages after worker claim — queued stays at "waiting"
      if (jobStatus === "queued" || jobStatus === "pending" || !jobStatus) {
        setProduceStage("queued");
        setProduceProgress(5);
      } else if (jobStatus === "processing" || jobStatus === "running") {
        if (produceJob?.stage) setProduceStage(String(produceJob.stage));
        if (typeof produceJob?.progress === "number" && Number.isFinite(produceJob.progress)) {
          setProduceProgress(Math.max(5, Math.min(99, Math.round(produceJob.progress))));
        }
      } else {
        if (produceJob?.stage) setProduceStage(String(produceJob.stage));
        if (typeof produceJob?.progress === "number" && Number.isFinite(produceJob.progress)) {
          setProduceProgress(Math.max(0, Math.min(100, Math.round(produceJob.progress))));
        }
      }

      if (jobStatus === "failed") {
        setError(produceJob?.error || "Produce failed");
        return "failed";
      }

      if (jobStatus === "complete" || jobStatus === "completed") {
        if (st.master_url) setMasterUrl(st.master_url);
        return "complete";
      }

      return "pending";
    } catch {
      return "error";
    }
  }, [id, produceJobId]);


  // When opening a finished song, resolve master URL for full playback + download
  useEffect(() => {
    if (screen !== "done") return;
    if (masterUrl) return;
    let cancelled = false;
    (async () => {
      try {
        const sr = await fetch(`/api/projects/${id}/status`);
        const st = await sr.json().catch(() => ({}));
        if (cancelled) return;
        if (st.master_url) setMasterUrl(st.master_url);
        else {
          const dr = await fetch(`/api/projects/${id}/download?kind=master&format=wav`);
          const dj = await dr.json().catch(() => ({}));
          if (dj.download_url) setMasterUrl(dj.download_url);
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [screen, masterUrl, id]);

  const scheduleProducePoll = useCallback(() => {
    clearProducePoll();
    produceActiveRef.current = true;
    const tick = async () => {
      if (!produceActiveRef.current) return;
      if (Date.now() - produceStartedAtRef.current > PRODUCE_MAX_MS) {
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
          produceActiveRef.current = false;
          return;
        }
        // Still running on worker — extend wait, do not treat as hard failure
        produceStartedAtRef.current = Date.now() - PRODUCE_MAX_MS + 15 * 60 * 1000;
        setError(
          "Still producing on the server — longer songs can take a while. Leave this open or refresh later."
        );
        producePollRef.current = setTimeout(() => void tick(), PRODUCE_POLL_MS);
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
      let statusMasterUrl: string | null = null;
      const sr = await fetch(`/api/projects/${id}/status`);
      if (sr.ok) {
        const st = await sr.json();
        if (st.project) {
          loadedProject = st.project;
          setProject(st.project);
        }
        statusMasterUrl = st.master_url || null;
        if (statusMasterUrl) setMasterUrl(statusMasterUrl);
        if (typeof st.recording_count === "number") recordingCount = st.recording_count;

        const jobs = (st.jobs || []) as {
          type?: string;
          status?: string;
          stage?: string;
          created_at?: string;
          started_at?: string;
        }[];
        const produceJob = jobs.find((j) => j.type === "PRODUCE_SONG");
        const js = (produceJob?.status || "").toLowerCase();
        if (js === "queued" || js === "processing") {
          // If this job has been running for hours (worker lost it), clear and let user re-produce
          const origin = Date.parse(
            String(produceJob?.started_at || produceJob?.created_at || "")
          );
          const ageMs = origin && Number.isFinite(origin) ? Date.now() - origin : 0;
          // 8 min with no live advance = stalled (worker restart / empty queue), not "still working"
          if (ageMs > 8 * 60_000) {
            setError(
              "A previous produce job stalled. Tap Produce again to start a fresh job — your recordings are safe."
            );
            setProducing(false);
            setProduceStage("failed");
            // Best-effort cancel so the worker reaper / force produce can supersede
            void fetch(`/api/projects/${id}/produce/cancel`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ reason: "stale_client_resume" }),
            }).catch(() => undefined);
          } else {
            setProducing(true);
            setScreen("assemble");
            setProduceStage(
              (produceJob?.status || "").toLowerCase() === "queued"
                ? "queued"
                : (produceJob?.stage || "queued")
            );
            produceStartedAtRef.current = origin && ageMs > 0 ? origin : Date.now();
            produceActiveRef.current = true;
            resumedRef.current = true;
            scheduleProducePoll();
          }
        } else if (statusMasterUrl) {
          // Produced song — always resume on done (not the recording booth)
          setScreen("done");
          setProduceStage("complete");
          resumedRef.current = true;
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
        // Master present → done screen wins over stale "recording" status
        let next = screenForStatus(
          loadedProject.status,
          loadedTasks.length > 0,
          hasProgress
        );
        if (statusMasterUrl) {
          next = "done";
        }
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


  // ?plan=ai | ?plan=scratch from Studio after uploaded beat
  const planQueryHandled = useRef(false);
  useEffect(() => {
    if (planQueryHandled.current) return;
    const planQ = (searchParams?.get("plan") || "").toLowerCase();
    if (!planQ) return;
    if (loading) return;
    planQueryHandled.current = true;
    if (planQ === "ai") {
      void generateAiPlan("ai");
    } else if (planQ === "scratch") {
      setPlanMode("scratch");
      // If already in scratch (or has completed takes), only sticky-set mode.
      // clear_to_scratch is safe for unfinished AI slots but must not wipe progress.
      void (async () => {
        try {
          const planRes = await fetch(`/api/projects/${id}/plan`);
          const pj = planRes.ok ? await planRes.json().catch(() => ({})) : {};
          const already = String(pj.plan_mode || "") === "scratch";
          const hasDone = Array.isArray(pj.tasks)
            ? pj.tasks.some(
                (x: { status?: string }) =>
                  String(x.status || "").toLowerCase() === "completed"
              )
            : false;
          const action = already || hasDone ? "set_mode" : "clear_to_scratch";
          const body =
            action === "set_mode"
              ? { action: "set_mode", mode: "scratch" }
              : { action: "clear_to_scratch" };
          const res = await fetch(`/api/projects/${id}/plan`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          if (res.ok) {
            const j = await res.json().catch(() => ({}));
            if (j.plan_mode) setPlanMode(j.plan_mode);
            if (Array.isArray(j.tasks)) setPlanTasks(j.tasks as PlanEditorTask[]);
          }
        } catch {
          /* ignore */
        }
      })();
      openPlanner();
    }
    // strip query so refresh does not re-fire
    try {
      router.replace(`/app/studio/${id}`);
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, searchParams, id]);

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
    // Ensure every core/lead stays required when starting the session
    try {
      await fetch(`/api/projects/${id}/plan`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "require_cores" }),
      });
    } catch {
      /* non-blocking */
    }

    let list = tasks.filter((t) => t.status !== "skipped");
    if (list.length === 0 && planTasks.length > 0) {
      list = activeSessionTasksFromPlan(planTasks);
      if (list.length) setTasks(list);
    }
    // Mark cores required on client
    list = list.map((t) =>
      isCoreTask(t) ? { ...t, required: true } : t
    );
    setTasks(list);

    const open =
      list.find((t) => isCoreTask(t) && isTaskOpen(t)) ||
      list.find((t) => isTaskOpen(t)) ||
      null;
    setSavedRecordingId(null);
    setLocalBlobUrl(null);
    setTaskTakes([]);
    setReviewOverdubSrcs([]);
    if (open) setActiveTaskId(open.id);
    else setActiveTaskId(null);
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
    const routeId = selectedSpeakerIdRef.current;
    // Headphones / AirPods / external: never start VAD duck
    if (!isPhoneBuiltInOutput(routeId)) return;
    // Handset: mild duck only (physical separation does most of the work)
    // Loudspeaker: moderate duck from DEFAULT_SPEAKER_DUCK
    const duckCfg = isPhoneHandsetOutput(routeId) ? HANDSET_SPEAKER_DUCK : DEFAULT_SPEAKER_DUCK;
    const handle = startSpeakerMonitorDuck(micStream, () => beatAudioRef.current, duckCfg);
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
              monitorMode: classifyMonitorMode(selectedSpeakerIdRef.current),
              routeIsPhoneSpeaker: isPhoneSpeakerOutput(selectedSpeakerIdRef.current),
              routeIsPhoneHandset: isPhoneHandsetOutput(selectedSpeakerIdRef.current),
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

  /**
   * DIAGNOSTIC ONLY — decode original MediaRecorder Blob via native Audio.
   * No beat, no CompactAudioPlayer, no Web Audio, no processing.
   * Classification is decode/playability only; human ear still required for "scratchy".
   */
  async function diagnoseRawCaptureBlob(
    blob: Blob,
    mimeType: string,
    deviceInfo: Record<string, unknown>
  ): Promise<void> {
    rawTakeBlobRef.current = blob;
    const sizeBytes = blob.size;
    let durationSec: number | null = null;
    let canDecode = false;
    let playError: string | null = null;
    let status: "UNKNOWN" | "RAW_CAPTURE_CLEAN" | "RAW_CAPTURE_DISTORTED" | "RAW_CAPTURE_UNPLAYABLE" =
      "UNKNOWN";

    try {
      const url = URL.createObjectURL(blob);
      const a = new Audio();
      a.preload = "auto";
      a.src = url;
      await new Promise<void>((resolve) => {
        let settled = false;
        const done = () => {
          if (settled) return;
          settled = true;
          a.removeEventListener("loadedmetadata", onMeta);
          a.removeEventListener("error", onErr);
          clearTimeout(timer);
          resolve();
        };
        const onMeta = () => {
          canDecode = true;
          durationSec = Number.isFinite(a.duration) ? a.duration : null;
          done();
        };
        const onErr = () => {
          playError = a.error ? `MediaError code ${a.error.code}` : "audio element error";
          canDecode = false;
          done();
        };
        a.addEventListener("loadedmetadata", onMeta);
        a.addEventListener("error", onErr);
        const timer = setTimeout(() => {
          if (a.readyState >= 1 && Number.isFinite(a.duration)) {
            canDecode = true;
            durationSec = a.duration;
          }
          done();
        }, 4000);
        try {
          a.load();
        } catch {
          /* ignore */
        }
      });
      try {
        a.removeAttribute("src");
        a.load();
      } catch {
        /* ignore */
      }
      URL.revokeObjectURL(url);
    } catch (e) {
      playError = e instanceof Error ? e.message : String(e);
      canDecode = false;
    }

    if (!canDecode || sizeBytes < 256) {
      status = "RAW_CAPTURE_UNPLAYABLE";
    } else {
      status = "UNKNOWN";
    }

    setRawCaptureStatus(status);
    setRawCaptureMeta({
      mimeType: blob.type || mimeType,
      sizeBytes,
      durationSec,
      canDecode,
    });

    const payload = {
      classification: status,
      note:
        status === "RAW_CAPTURE_UNPLAYABLE"
          ? "Blob failed to decode or is empty"
          : "Play Raw Take and set classification to CLEAN or DISTORTED by ear",
      mimeType: blob.type || mimeType,
      sizeBytes,
      durationSec,
      canDecode,
      playError,
      mediaRecorderMime: mimeType,
      beatInMediaRecorder: false,
      captureGraph: "mic→getUserMedia→MediaRecorder (vocal only); beat→HTMLAudioElement",
      device: deviceInfo,
      at: Date.now(),
    };
    try {
      if (typeof window !== "undefined") {
        sessionStorage.setItem("studio_last_raw_capture_diagnostic", JSON.stringify(payload));
        if (localStorage.getItem("studio_debug_audio") === "1") {
          sessionStorage.setItem("studio_last_capture_forensics", JSON.stringify(payload));
        }
      }
    } catch {
      /* ignore */
    }
  }

  function playRawTakeDiagnostic() {
    const blob = rawTakeBlobRef.current;
    if (!blob) return;
    try {
      rawTakeAudioRef.current?.pause();
    } catch {
      /* ignore */
    }
    const url = URL.createObjectURL(blob);
    const a = new Audio();
    a.preload = "auto";
    a.src = url;
    a.onended = () => {
      try {
        URL.revokeObjectURL(url);
      } catch {
        /* ignore */
      }
    };
    rawTakeAudioRef.current = a;
    void a.play().catch((e) => {
      setRawCaptureStatus("RAW_CAPTURE_UNPLAYABLE");
      try {
        sessionStorage.setItem(
          "studio_last_raw_capture_diagnostic",
          JSON.stringify({
            classification: "RAW_CAPTURE_UNPLAYABLE",
            playError: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
            at: Date.now(),
          })
        );
      } catch {
        /* ignore */
      }
    });
  }

  function markRawCaptureByEar(result: "RAW_CAPTURE_CLEAN" | "RAW_CAPTURE_DISTORTED") {
    setRawCaptureStatus(result);
    try {
      const prev = sessionStorage.getItem("studio_last_raw_capture_diagnostic");
      const base = prev ? JSON.parse(prev) : {};
      sessionStorage.setItem(
        "studio_last_raw_capture_diagnostic",
        JSON.stringify({ ...base, classification: result, classifiedBy: "human_ear", at: Date.now() })
      );
    } catch {
      /* ignore */
    }
  }

  function beginMediaCapture(stream: MediaStream, task: Task) {

    chunksRef.current = [];
    autoStoppedRef.current = false;
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
      stopLayerMonitors();
      const blob = new Blob(chunksRef.current, { type: mimeRef.current.split(";")[0] });
      const wallClockMs = Date.now() - startedAtRef.current;
      setLocalBlobUrl(URL.createObjectURL(blob));
      void diagnoseRawCaptureBlob(blob, mimeRef.current, {
        ...(lastCaptureDeviceRef.current || {}),
        wallClockMs,
      });
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
      void loadReviewOverdubs(task);
      setUploading(true);
      setProducerTip(null);
                    setLayerSuggestion(null);
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

        // REQUIRED: MediaRecorder blob → WAV. Never store webm/m4a for produce.
        let uploadBlob: Blob;
        let uploadName: string;
        try {
          const wav = await audioBlobToWavDetailed(blob);
          uploadBlob = wav.blob;
          uploadName = "take.wav";
          try {
            sessionStorage.setItem(
              "studio_last_wav_export",
              JSON.stringify({
                method: wav.method,
                sampleRate: wav.sampleRate,
                sourceDurationSec: wav.sourceDurationSec,
                outputDurationSec: wav.outputDurationSec,
                durationDeltaMs: wav.durationDeltaMs,
              })
            );
          } catch {
            /* ignore */
          }
        } catch (convErr) {
          // Still save the original take so the section is not lost; server may convert later.
          console.error("[upload] WAV conversion failed — uploading original", convErr);
          uploadBlob = blob;
          const mime = (blob.type || mimeRef.current || "audio/webm").split(";")[0];
          uploadName =
            mime.includes("wav")
              ? "take.wav"
              : mime.includes("mp4") || mime.includes("m4a")
                ? "take.m4a"
                : mime.includes("mpeg") || mime.includes("mp3")
                  ? "take.mp3"
                  : "take.webm";
        }

        const form = new FormData();
        form.append("file", uploadBlob, uploadName);
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
            route: (() => {
              const m = classifyMonitorMode(selectedSpeakerIdRef.current);
              if (m === "PHONE_HANDSET") return "phone_mic+handset";
              if (m === "PHONE_SPEAKER") return "phone_mic+phone_speaker";
              return m.toLowerCase();
            })(),
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
              speaker_monitor_duck: isPhoneBuiltInOutput(selectedSpeakerIdRef.current),
              monitorMode: classifyMonitorMode(selectedSpeakerIdRef.current),
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
        // Server already marks the task completed — mirror that in local plan state
        // so the section shows as saved without requiring an extra "Keep" tap.
        setTasks((prev) =>
          prev.map((row) => (row.id === task.id ? { ...row, status: "completed" } : row))
        );
        await fetch(`/api/recording-tasks/${task.id}/recordings/${j.recording.id}/select`, {
          method: "POST",
        }).catch(() => undefined);
        void loadTaskTakes(task.id);
        const rec = await fetchProducerRecommendation(task.id, j.recording.id);
        if (rec.tip) setProducerTip(rec.tip);
        if (rec.layerSuggestion) setLayerSuggestion(rec.layerSuggestion);
        else setLayerSuggestion(null);
        void markRecordingStatus();
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Save failed — tap Retake or try again");
        setSavedRecordingId(null);
        // Keep localBlobUrl so the artist can still hear the take and retake
      } finally {
        setUploading(false);
      }
    };

    const taskTimed = withPlanTiming(task, planTasks);
    const taskWin = resolveTaskWindow(taskTimed);
    const limitMs = taskWin.durationMs != null && taskWin.durationMs > 500 ? taskWin.durationMs : sectionDurationMs(task);

    startedAtRef.current = Date.now();
    recordingStartPerfRef.current = performance.now();
    lastBlobAnalysisRef.current = null;
    // Beat seeks to canonical section start (musical position), not 0
    if (beatAudioRef.current && beatUrl) {
      void routePlaybackToPreferredOutput(beatAudioRef.current, selectedSpeakerIdRef.current || undefined);
      beatAudioRef.current.currentTime = taskWin.startMs / 1000;
      const mode = classifyMonitorMode(selectedSpeakerIdRef.current);
      beatAudioRef.current.muted = false;
      // Handset: higher usable level (earpiece far from bottom mic). Loudspeaker: moderate.
      // Headphones: normal monitoring level.
      // Keep monitor quiet on speaker so the mic does not capture the beat into the take.
      beatAudioRef.current.volume =
        mode === "PHONE_HANDSET" ? 0.1 : mode === "PHONE_SPEAKER" ? 0.02 : 0.14;
      // Beat play starts *after* we arm the recorder below (tighter musical lock).
    }
    // Load section peers FIRST so doubles/harmonies hear the lead with the beat.
    setRecordSeconds(0);
    timerRef.current = setInterval(() => {
      const elapsed = Date.now() - startedAtRef.current;
      setRecordSeconds(Math.floor(elapsed / 1000));
      if (limitMs != null && elapsed >= limitMs && !autoStoppedRef.current) {
        autoStoppedRef.current = true;
        clearRecordTimers();
        beatAudioRef.current?.pause();
        stopLayerMonitors();
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
        stopLayerMonitors();
        if (mediaRecorderRef.current?.state === "recording") {
          mediaRecorderRef.current.stop();
        }
      }, limitMs);
    }

    const armAndStart = () => {
      // Align beat to section start — soft if pre-roll already landed nearby
      if (beatAudioRef.current && beatUrl) {
        const targetSec = taskWin.startMs / 1000;
        try {
          const cur = beatAudioRef.current.currentTime;
          if (!Number.isFinite(cur) || Math.abs(cur - targetSec) > 0.12) {
            beatAudioRef.current.currentTime = targetSec;
          }
        } catch {
          try {
            beatAudioRef.current.currentTime = taskWin.startMs / 1000;
          } catch {
            /* ignore */
          }
        }
        beatAudioRef.current.muted = false;
        beatAudioRef.current.play().catch(() => undefined);
      }

      if (sessionTimelineRef.current) {
        sessionTimelineRef.current = markRecordingStart(sessionTimelineRef.current);
        setLastRecordingOffsetMs(sessionTimelineRef.current.recordingOffsetMs);
      }

      // Peers start with the section (t=0 on take files), not during pre-roll
      seekLayerMonitorsToSectionStart(taskWin.startMs);
      playLayerMonitors();

      // Guard: mic tracks must still be live
      const live = stream.getAudioTracks().some((t) => t.readyState === "live");
      if (!live) {
        setError("Microphone disconnected — tap Record to try again");
        setPhase("ready");
        try {
          rec.stop();
        } catch {
          /* ignore */
        }
        return;
      }

      try {
        if (rec.state === "inactive") rec.start(100);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not start recorder");
        setPhase("ready");
        return;
      }
      setPhase("recording");
      startSpeakerDuckIfNeeded(stream);
    };

    void (async () => {
      // Only fetch peers if countdown preload did not populate them
      // Always refresh same-section monitors so lead/harmonies are present for this take
      try {
        await startLayerMonitors(task, { play: false });
      } catch { /* ignore */ }
      if (false && layerMonitorAudiosRef.current.length === 0) {
        try {
          await startLayerMonitors(task, { play: false });
        } catch (e) {
          console.warn("[layer-monitor] failed", e);
        }
      }
      armAndStart();
    })();
  }

  function stopLayerMonitors() {
    for (const el of layerMonitorAudiosRef.current) {
      try {
        el.pause();
        el.removeAttribute("src");
        el.load();
      } catch {
        /* ignore */
      }
    }
    layerMonitorAudiosRef.current = [];
  }

  /** Align existing section vocals to the same musical clock as the beat monitor. */
  function seekLayerMonitorsToSectionStart(_sectionStartMs: number) {
    // Same-section takes: file t=0 ≈ section placement — start with the beat at section start.
    for (const el of layerMonitorAudiosRef.current) {
      try {
        el.currentTime = 0;
      } catch {
        /* ignore */
      }
    }
  }

  function playLayerMonitors() {
    for (const el of layerMonitorAudiosRef.current) {
      try {
        el.muted = false;
        void el.play().catch(() => undefined);
      } catch {
        /* ignore */
      }
    }
  }

  /**
   * While recording any layer, play existing selected takes in the same section
   * (Lead under harmony/ad-lib, or any prior layers under a retake).
   * Mic path is separate; these Audio elements never go into MediaRecorder.
   */

  /** Prior takes in this section for Review — hear lead under a new double, etc. */
  async function loadReviewOverdubs(task: Task) {
    const srcs: { url: string; volume?: number; label?: string }[] = [];
    const peers = tasks.filter(
      (t0) =>
        t0.id !== task.id &&
        isCompletedTaskStatus(t0.status) &&
        sameMusicalSection(task, t0)
    );
    peers.sort((a, b) => (isCoreTask(a) ? 0 : 1) - (isCoreTask(b) ? 0 : 1));
    for (const p of peers.slice(0, 4)) {
      try {
        const res = await fetch(`/api/recording-tasks/${p.id}/recordings`);
        if (!res.ok) continue;
        const j = await res.json();
        const list = (Array.isArray(j.recordings) ? j.recordings : []) as {
          is_selected?: boolean | null;
          audio_url?: string | null;
        }[];
        const selected =
          list.find((r) => r.is_selected) || list[list.length - 1] || list[0];
        if (selected?.audio_url) {
          srcs.push({
            url: selected.audio_url,
            volume: isCoreTask(p) ? 0.7 : 0.45,
            label: sectionLabel(p),
          });
        }
      } catch {
        /* skip */
      }
    }
    setReviewOverdubSrcs(srcs);
  }

  /** Load section peers into layerMonitorAudiosRef without playing (for countdown prep). */
  async function preloadLayerMonitors(task: Task) {
    await startLayerMonitors(task, { play: false });
  }

  async function startLayerMonitors(task: Task, opts?: { play?: boolean }) {
    stopLayerMonitors();
    const shouldPlay = opts?.play !== false;

    const sectionStart = resolveTaskWindow(task).startMs;
    const sectionId =
      task.section_id ||
      (task.metadata as { section_id?: string } | null | undefined)?.section_id ||
      null;
    const label = (sectionLabel(task) || "").toLowerCase().trim();

    type MonitorSrc = { url: string; isLead: boolean; startMs: number };
    const sources: MonitorSrc[] = [];

    // Prefer live plan tasks → selected take URLs (works even when previewLayers is empty)
    const taskKey = sectionGroupKey(task);
    const peers = tasks.filter((t0) => {
      if (t0.id === task.id) return false;
      const done = isCompletedTaskStatus(t0.status) || isTaskDone(t0);
      if (!done) return false;
      if (sameMusicalSection(task, t0)) return true;
      if (sectionGroupKey(t0) === taskKey) return true;
      const a = task.section_id || (task.metadata as { section_id?: string } | null)?.section_id;
      const b = t0.section_id || (t0.metadata as { section_id?: string } | null)?.section_id;
      if (a && b && a === b) return true;
      const ts = task.start_ms != null ? Number(task.start_ms) : null;
      const ps = t0.start_ms != null ? Number(t0.start_ms) : null;
      if (ts != null && ps != null && Math.abs(ts - ps) <= 4000) return true;
      return false;
    });
    peers.sort((a, b) => {
      const ca = isCoreTask(a) ? 0 : 1;
      const cb = isCoreTask(b) ? 0 : 1;
      return ca - cb;
    });

    for (const p of peers.slice(0, 6)) {
      try {
        const res = await fetch(`/api/recording-tasks/${p.id}/recordings`);
        if (!res.ok) continue;
        const j = await res.json();
        const list = (Array.isArray(j.recordings) ? j.recordings : []) as {
          id: string;
          is_selected?: boolean | null;
          audio_url?: string | null;
        }[];
        const selected =
          list.find((r) => r.is_selected) || list[list.length - 1] || list[0];
        if (selected?.audio_url) {
          sources.push({
            url: selected.audio_url,
            isLead: isCoreTask(p),
            startMs: p.start_ms ?? sectionStart,
          });
        }
      } catch {
        /* skip */
      }
    }

    // Fallback: session-preview layers
    if (!sources.length) {
      let layers = previewLayers;
      if (!layers.length) {
        try {
          const res = await fetch(`/api/projects/${id}/session-preview`);
          if (res.ok) {
            const j = await res.json();
            layers = Array.isArray(j.layers) ? j.layers : [];
            if (layers.length) setPreviewLayers(layers);
          }
        } catch {
          /* non-fatal */
        }
      }
      const sameSection = layers.filter((l) => {
        if (l.task_id === task.id) return false;
        if (!l.audio_url) return false;
        if (sectionId && l.section_id && sectionId === l.section_id) return true;
        const s = l.start_ms || 0;
        return Math.abs(s - sectionStart) < 10000;
      });
      sameSection.sort((a, b) => {
        const ra = (a.type || "").toLowerCase().includes("lead") ? 0 : 1;
        const rb = (b.type || "").toLowerCase().includes("lead") ? 0 : 1;
        return ra - rb;
      });
      for (const l of sameSection.slice(0, 4)) {
        sources.push({
          url: l.audio_url,
          isLead: (l.type || "").toLowerCase().includes("lead"),
          startMs: l.start_ms || sectionStart,
        });
      }
    }

    if (!sources.length) {
      console.warn("[layer-monitor] no existing section vocals to monitor", {
        taskId: task.id,
        sectionId,
        sectionStart,
        peerCount: peers.length,
      });
      return;
    }

    const sink = selectedSpeakerIdRef.current || undefined;
    const mode = classifyMonitorMode(selectedSpeakerIdRef.current);
    // Keep monitors usable but below typical mic bleed risk on speaker
    // Hearable under the new take; still below typical speaker feedback risk
    // Layer monitors must stay soft on speaker — they also bleed into the mic.
    const leadVol = mode === "PHONE_SPEAKER" ? 0.14 : 0.9;
    const otherVol = mode === "PHONE_SPEAKER" ? 0.1 : 0.6;

    for (const src of sources.slice(0, 4)) {
      try {
        const el = new Audio();
        el.preload = "auto";
        el.crossOrigin = "anonymous";
        el.src = src.url;
        el.volume = src.isLead ? leadVol : otherVol;
        el.muted = false;
        // Same-section takes: file t=0 = section placement. Do not seek by start_ms delta.
        try {
          el.currentTime = 0;
        } catch {
          /* ignore */
        }
        await routePlaybackToPreferredOutput(el, sink);
        el.pause();
        el.currentTime = 0;
        layerMonitorAudiosRef.current.push(el);
        if (shouldPlay) {
          await el.play().catch((e) => {
            console.warn("[layer-monitor] play failed", e);
          });
        }
      } catch {
        /* skip broken layer */
      }
    }
  }

  async function startRecording() {
    if (!current) return;
    setError(null);
    setProducerTip(null);
                    setLayerSuggestion(null);
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
      const win = resolveTaskWindow(current);
      // Booth: 4-beat count-in at the song tempo (falls back to 3s without a tempo)
      const countInTotalMs = boothCountInMs(project?.tempo);
      let tl = createSessionTimeline({
        taskId: current.id,
        sectionStartMs: win.startMs,
        sectionEndMs: win.endMs,
        countInMs: countInTotalMs,
      });
      tl = markCountdownStart(tl);
      sessionTimelineRef.current = tl;
      setLastRecordingOffsetMs(0);

      setCountdown(4);
      setPhase("countdown");
      void markRecordingStatus();
      // Preload section peers during countdown (do NOT play — would be 3s early vs beat)
      void preloadLayerMonitors(current).catch(() => undefined);

      if (beatAudioRef.current && beatUrl) {
        // Pre-roll: beat seeks to sectionStart - countIn (musical clock)
        const preRollStart = Math.max(0, (resolveTaskWindow(current).startMs - countInTotalMs) / 1000);
        try {
          beatAudioRef.current.currentTime = preRollStart;
        } catch {
          /* ignore */
        }
        const mode = classifyMonitorMode(selectedSpeakerIdRef.current);
        beatAudioRef.current.muted = false;
        beatAudioRef.current.volume =
          mode === "PHONE_HANDSET" ? 0.1 : mode === "PHONE_SPEAKER" ? 0.02 : 0.14;
        beatAudioRef.current.play().catch(() => undefined);
        if (sessionTimelineRef.current) {
          sessionTimelineRef.current = markBeatStart(sessionTimelineRef.current);
        }
      }
      const captureStream = opened.recordStream;
      const taskSnapshot = current;
      let n = 3;
      if (countdownRef.current) clearInterval(countdownRef.current);
      // Use performance.now deadline so countdown stays tight to the 3s pre-roll
      const countDeadline = performance.now() + countInTotalMs;
      countdownRef.current = setInterval(() => {
        const left = countInBeatsLeft(countDeadline - performance.now(), countInTotalMs);
        if (left <= 0) {
          if (countdownRef.current) clearInterval(countdownRef.current);
          countdownRef.current = null;
          setCountdown(0);
          beginMediaCapture(captureStream, taskSnapshot);
        } else {
          setCountdown(left);
          n = left;
        }
      }, 100);
    } catch (e) {
      setMicStream(null);
      setPhase("ready");
      setError(formatMicOpenError(e));
    }
  }

  function cancelCountdown() {
    if (countdownRef.current) clearInterval(countdownRef.current);
    countdownRef.current = null;
    stopSpeakerDuck();
    beatAudioRef.current?.pause();
    stopLayerMonitors();
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
                    setLayerSuggestion(null);
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
      setTasks((prev) =>
        prev.map((row) => (row.id === current.id ? { ...row, status: "completed" } : row))
      );
      if (j.recording.audio_url) setLocalBlobUrl(j.recording.audio_url);
      await fetch(`/api/recording-tasks/${current.id}/recordings/${j.recording.id}/select`, {
        method: "POST",
      }).catch(() => undefined);
      void loadTaskTakes(current.id);
      const rec = await fetchProducerRecommendation(current.id, j.recording.id);
      if (rec.tip) setProducerTip(rec.tip);
      if (rec.layerSuggestion) setLayerSuggestion(rec.layerSuggestion);
      else setLayerSuggestion(null);
      void markRecordingStatus();
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed — tap Retake or try again");
      setSavedRecordingId(null);
      setPhase("ready");
    } finally {
      setUploading(false);
    }
  }

  function clearFocusAndAdvance(next: Task[], completed?: Task | null | undefined) {
    setLocalBlobUrl(null);
    setReviewOverdubSrcs([]);
    setPhase("ready");
    setScreen("session");

    // Merge planTasks so layers that exist in the plan but dropped from `tasks` still count
    const pool: Task[] = (() => {
      const byId = new Map<string, Task>();
      for (const t of next) byId.set(t.id, t);
      for (const p of planTasks) {
        if (p.active === false || p.selected_in_plan === false || p.status === "skipped") continue;
        if (byId.has(p.id)) {
          // Keep session status (just completed) over stale plan status
          const cur = byId.get(p.id)!;
          byId.set(p.id, {
            ...cur,
            // Fill missing placement/section from plan so sameMusicalSection works
            section_id: cur.section_id ?? p.section_id ?? null,
            start_ms: cur.start_ms ?? p.start_ms ?? null,
            end_ms: cur.end_ms ?? p.end_ms ?? null,
            title: cur.title || p.title,
            metadata: (cur.metadata as Task["metadata"]) || (p.metadata as Task["metadata"]) || undefined,
            type: cur.type || p.type,
          });
          continue;
        }
        byId.set(p.id, {
          id: p.id,
          type: p.type,
          title: p.title,
          instruction: p.instruction || "",
          reason: p.reason,
          status: p.id === completed?.id ? "completed" : p.status || "pending",
          required: Boolean(p.required),
          start_ms: p.start_ms,
          end_ms: p.end_ms,
          section_id: p.section_id,
          metadata: p.metadata as Task["metadata"],
        });
      }
      // If we just completed, force that status in pool
      if (completed) {
        const d = byId.get(completed.id);
        if (d) byId.set(completed.id, { ...d, status: "completed" });
      }
      return Array.from(byId.values());
    })();

    const ensureActive = (task: Task | SessionTask) => {
      const normalized: Task = asSessionTask(task);
      // Always reset capture UI — never carry "Keep take" onto a new unrecorded task
      setSavedRecordingId(null);
      setLocalBlobUrl(null);
      setTaskTakes([]);
      setReviewOverdubSrcs([]);
      setPhase("ready");
      setError(null);
      setTasks((prev) => {
        const openStatus = isTaskOpen(normalized) ? "pending" : normalized.status;
        // If task is still open, force pending in client state so UI never treats it as done
        const merged = {
          ...normalized,
          status: isTaskOpen(normalized) ? "pending" : normalized.status || openStatus,
        };
        if (prev.some((t) => t.id === merged.id)) {
          return prev.map((t) => (t.id === merged.id ? { ...t, ...merged } : t));
        }
        return [...prev, merged];
      });
      setActiveTaskId(normalized.id);
    };

    // 1) HARD RULE: finish remaining layers on THIS section before any other section
    if (completed) {
      const rec = nextProductionRecommendation(pool, completed);
      if (rec) {
        ensureActive(rec);
        return;
      }
      const openSame = pool
        .filter(
          (t) =>
            t.id !== completed.id &&
            isTaskOpen(t) &&
            !isCoreTask(t) &&
            sameMusicalSection(completed, t)
        )
        .sort((a, b) => {
          const rank = (ty: string) => {
            const x = (ty || "").toLowerCase();
            if (x.includes("double")) return 0;
            if (x.includes("harmony")) return 1;
            if (x.includes("background") || x.includes("hum")) return 2;
            if (x.includes("adlib")) return 3;
            return 5;
          };
          return rank(a.type) - rank(b.type);
        });
      if (openSame[0]) {
        ensureActive(openSame[0]);
        return;
      }
      // Tight start_ms match only (±4s) — do not pull earlier sections
      const ps = completed.start_ms != null ? Number(completed.start_ms) : null;
      if (ps != null) {
        const byTime = pool
          .filter((t) => {
            if (t.id === completed.id || !isTaskOpen(t) || isCoreTask(t)) return false;
            const cs = t.start_ms != null ? Number(t.start_ms) : null;
            if (cs == null) return false;
            return Math.abs(cs - ps) <= 4000;
          })
          .sort((a, b) => {
            const rank = (ty: string) => {
              const x = (ty || "").toLowerCase();
              if (x.includes("double")) return 0;
              if (x.includes("harmony")) return 1;
              if (x.includes("adlib")) return 3;
              return 5;
            };
            return rank(a.type) - rank(b.type);
          });
        if (byTime[0]) {
          ensureActive(byTime[0]);
          return;
        }
      }
    }

    // 2) Next section's lead — FORWARD in timeline only (never jump to an earlier open lead)
    const nextCore = nextCoreForward(pool, completed);
    if (nextCore) {
      stopLayerMonitors();
      setReviewOverdubSrcs([]);
      ensureActive(nextCore);
      return;
    }
    setActiveTaskId(null);
    if (coreOpen(pool).length === 0 && pool.every((t) => !isTaskOpen(t))) {
      setScreen("assemble");
    }
  }

  /**
   * After a saved take: advance using clearFocusAndAdvance (same-section layers first).
   * Never treat "task already completed / has a take" as a retake short-circuit.
   */
  async function keepAndContinue() {
    if (!current) return;
    if (!savedRecordingId) {
      setError("Take is not saved yet. Wait until it says Saved, or press Retake.");
      return;
    }
    const completedId = current.id;
    const completedSnapshot: Task = { ...current, status: "completed" };
    setError(null);
    setSavedRecordingId(null);
    setLocalBlobUrl(null);
    setReviewOverdubSrcs([]);
    stopLayerMonitors();
    try {
      beatAudioRef.current?.pause();
    } catch {
      /* ignore */
    }

    // Mark completed locally immediately
    setPlanTasks((prev) =>
      prev.map((t) => (t.id === completedId ? { ...t, status: "completed" } : t))
    );
    setTasks((prev) =>
      prev.map((t) => (t.id === completedId ? { ...t, status: "completed" } : t))
    );

    // Authoritative list from server — never trust stale client-only layer membership
    let pool: Task[] = [];
    try {
      const [tr, pr] = await Promise.all([
        fetch(`/api/projects/${id}/recording-tasks`),
        fetch(`/api/projects/${id}/plan`),
      ]);
      const sessionRows: Task[] = tr.ok ? ((await tr.json()).tasks || []) : [];
      let planRows: PlanEditorTask[] = [];
      if (pr.ok) {
        const pj = await pr.json();
        planRows = Array.isArray(pj.tasks) ? (pj.tasks as PlanEditorTask[]) : [];
        if (planRows.length) setPlanTasks(planRows);
      }
      const byId = new Map<string, Task>();
      for (const t of sessionRows) {
        byId.set(t.id, {
          ...t,
          status: t.id === completedId ? "completed" : t.status,
          start_ms: t.start_ms ?? null,
          end_ms: t.end_ms ?? null,
        });
      }
      for (const p of planRows) {
        if (p.active === false || p.selected_in_plan === false) continue;
        if ((p.status || "").toLowerCase() === "skipped") continue;
        const existing = byId.get(p.id);
        if (existing) {
          byId.set(p.id, {
            ...existing,
            status: p.id === completedId ? "completed" : existing.status,
            section_id: existing.section_id ?? p.section_id,
            start_ms: existing.start_ms ?? p.start_ms ?? null,
            end_ms: existing.end_ms ?? p.end_ms ?? null,
            metadata: existing.metadata ?? (p.metadata as Task["metadata"]),
          });
        } else {
          byId.set(
            p.id,
            asSessionTask({
              id: p.id,
              type: p.type,
              title: p.title,
              instruction: p.instruction,
              reason: p.reason,
              status: p.id === completedId ? "completed" : p.status || "pending",
              required: p.required,
              start_ms: p.start_ms,
              end_ms: p.end_ms,
              section_id: p.section_id,
              metadata: (p.metadata as Task["metadata"] | null) ?? undefined,
            })
          );
        }
      }
      // Ensure the just-completed task is marked done even if API is lagging
      const done = byId.get(completedId);
      if (done) byId.set(completedId, { ...done, status: "completed" });
      else byId.set(completedId, completedSnapshot);
      pool = Array.from(byId.values());
      setTasks(pool.filter((t) => (t.status || "").toLowerCase() !== "skipped"));
    } catch {
      pool = tasks.map((t) =>
        t.id === completedId ? { ...t, status: "completed" } : t
      );
    }

    clearFocusAndAdvance(pool, completedSnapshot);
  }

  /** Explicit: jump to the next section's lead only (artist chose "Next section"). */
  async function goToNextSectionLead() {
    if (!current) return;
    if (!savedRecordingId && !isTaskDone(current)) {
      setError("Save a take for this part first, or skip it.");
      return;
    }
    const completedId = current.id;
    const completedSnapshot: Task = { ...current, status: "completed" };
    setError(null);
    setSavedRecordingId(null);
    setLocalBlobUrl(null);
    setReviewOverdubSrcs([]);
    stopLayerMonitors();
    try {
      beatAudioRef.current?.pause();
    } catch {
      /* ignore */
    }
    setPlanTasks((prev) =>
      prev.map((t) => (t.id === completedId ? { ...t, status: "completed" } : t))
    );
    setTasks((prev) =>
      prev.map((t) => (t.id === completedId ? { ...t, status: "completed" } : t))
    );

    let pool: Task[] = tasks.map((t) =>
      t.id === completedId ? { ...t, status: "completed" } : t
    );
    try {
      const tr = await fetch(`/api/projects/${id}/recording-tasks`);
      if (tr.ok) {
        const sessionRows: Task[] = (await tr.json()).tasks || [];
        pool = sessionRows.map((t) =>
          t.id === completedId ? { ...t, status: "completed" } : t
        );
        setTasks(pool.filter((t) => (t.status || "").toLowerCase() !== "skipped"));
      }
    } catch {
      /* use local pool */
    }

    const nextCore = nextCoreForward(pool, completedSnapshot);
    if (nextCore) {
      stopLayerMonitors();
      setReviewOverdubSrcs([]);
      setActiveTaskId(nextCore.id);
      setPhase("ready");
      setScreen("session");
      setError(null);
      return;
    }
    setActiveTaskId(null);
    setPhase("ready");
    setScreen("assemble");
    void loadSongPreview();
  }

  /**
   * Explicit: stay on this section and open the next planned layer
   * (or no-op with message if none planned).
   */
  async function goToSameSectionLayer() {
    if (!current) return;
    if (!savedRecordingId) {
      setError("Take is not saved yet. Wait until it says Saved, or press Retake.");
      return;
    }
    const completedId = current.id;
    const completedSnapshot: Task = { ...current, status: "completed" };
    const keptRecordingId = savedRecordingId;
    const keptBlob = localBlobUrl;
    setError(null);
    setReviewOverdubSrcs([]);
    stopLayerMonitors();
    try {
      beatAudioRef.current?.pause();
    } catch {
      /* ignore */
    }
    setPlanTasks((prev) =>
      prev.map((t) => (t.id === completedId ? { ...t, status: "completed" } : t))
    );

    let pool: Task[] = tasks.map((t) =>
      t.id === completedId ? { ...t, status: "completed" } : t
    );
    try {
      const [tr, pr] = await Promise.all([
        fetch(`/api/projects/${id}/recording-tasks`),
        fetch(`/api/projects/${id}/plan`),
      ]);
      const sessionRows: Task[] = tr.ok ? ((await tr.json()).tasks || []) : [];
      let planRows: PlanEditorTask[] = [];
      if (pr.ok) {
        const pj = await pr.json();
        planRows = Array.isArray(pj.tasks) ? (pj.tasks as PlanEditorTask[]) : [];
        if (planRows.length) setPlanTasks(planRows);
      }
      const byId = new Map<string, Task>();
      for (const row of sessionRows) {
        byId.set(row.id, {
          ...row,
          status: row.id === completedId ? "completed" : row.status,
        });
      }
      for (const plan of planRows) {
        if (plan.active === false || plan.selected_in_plan === false) continue;
        if ((plan.status || "").toLowerCase() === "skipped") continue;
        if (!byId.has(plan.id)) {
          byId.set(
            plan.id,
            asSessionTask({
              id: plan.id,
              type: plan.type,
              title: plan.title,
              instruction: plan.instruction,
              reason: plan.reason,
              status: plan.id === completedId ? "completed" : plan.status || "pending",
              required: plan.required,
              start_ms: plan.start_ms,
              end_ms: plan.end_ms,
              section_id: plan.section_id,
              metadata: (plan.metadata as Task["metadata"] | null) ?? undefined,
            })
          );
        }
      }
      const done = byId.get(completedId);
      if (done) byId.set(completedId, { ...done, status: "completed" });
      else byId.set(completedId, completedSnapshot);
      pool = Array.from(byId.values());
      setTasks(pool.filter((row) => (row.status || "").toLowerCase() !== "skipped"));
    } catch {
      /* local pool */
    }

    const rec = nextProductionRecommendation(pool, completedSnapshot);
    if (rec) {
      setSavedRecordingId(null);
      setLocalBlobUrl(null);
      setActiveTaskId(rec.id);
      setPhase("ready");
      setScreen("session");
      setError(null);
      return;
    }
    // No planned open layer — keep review state so artist can add a layer or go next section
    setSavedRecordingId(keptRecordingId);
    if (keptBlob) setLocalBlobUrl(keptBlob);
    setActiveTaskId(completedId);
    setPhase("review");
    setError(null);
  }

  async function skipCurrent() {
    if (!current || (current.required && isCoreTask(current))) return;
    setSkipping(true);
    try {
      const res = await fetch(`/api/recording-tasks/${current.id}/skip`, { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "Skip failed");
      setTasks((prev) => {
        const next = prev.map((t) => (t.id === current.id ? { ...t, status: "skipped" } : t));
        clearFocusAndAdvance(next, current);
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

  /**
   * Existing phone takes may still be webm. Convert selected takes to WAV in the
   * browser and re-upload so Produce never hits server-side webm without ffmpeg.
   */
  async function repairTakesToWavForProduce(): Promise<void> {
    await prepareTakesForProduce({
      tasks: tasks.map((task) => ({ id: task.id, status: task.status })),
      onStage: (s) => setProduceStage(s),
    });
  }

  const [downloadModalOpen, setDownloadModalOpen] = useState(false);
  const [paywallOpen, setPaywallOpen] = useState(false);
  const [downloadUnlocked, setDownloadUnlocked] = useState(false);
  useEffect(() => {
    const meta = (project as { metadata?: Record<string, unknown> } | null)?.metadata;
    if (meta?.download_unlocked === true || meta?.subscription_plan) {
      setDownloadUnlocked(true);
    }
  }, [project]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const q = new URLSearchParams(window.location.search);
    if (q.get("unlocked") === "1") {
      setDownloadUnlocked(true);
      setPaywallOpen(false);
    }
    if (q.get("paywall") === "1") setPaywallOpen(true);
  }, []);

  const [downloadBusy, setDownloadBusy] = useState(false);

  async function downloadMaster(format: "wav" | "mp3") {
    setDownloadBusy(true);
    const result = await forceDownloadFromApi(
      id,
      format,
      `${project?.title || "song"}.${format}`
    );
    setDownloadBusy(false);
    if (!result.ok) {
      if (result.code === "PAYWALL") {
        setDownloadModalOpen(false);
        setPaywallOpen(true);
        setError(null);
        return;
      }
      setError(result.error);
      return;
    }
    setDownloadModalOpen(false);
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
    // Always detach from any previous job so retry is a true fresh produce
    clearProducePoll();
    produceActiveRef.current = false;
    setProduceJobId(null);
    setProduceProgress(0);
    setProducing(true);
    setError(null);
    setProduceStage("preparing takes");
    setScreen("assemble");
    try {
      await repairTakesToWavForProduce();
      setProduceStage("queued");
      const res = await fetch(`/api/projects/${id}/produce`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: true }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "Produce failed");

      const jid = j.jobId || j.job_id;
      if (!jid) {
        throw new Error(
          "Production job was not created. Check your connection and try Produce again."
        );
      }
      produceStartedAtRef.current = Date.now();
      setProduceJobId(String(jid));
      setProduceStage("queued");
      setProduceProgress(5);
      setProduceProgress(5);
      // Always poll — never treat a prior master as this run finishing.
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
    background: `linear-gradient(180deg, #FFB089, ${C.brass})`,
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

  // ── New Booth (Suno-style) presentation state ──────────────────────────
  const [stageOpen, setStageOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [advancedPanel, setAdvancedPanel] = useState<"menu" | "audio" | "plan">("menu");
  const [handoffOpen, setHandoffOpen] = useState(false);
  const [handingOff, setHandingOff] = useState(false);
  const boothUploadRef = useRef<HTMLInputElement | null>(null);

  const planSourceRows = (planTasks.length > 0 ? planTasks : (tasks as PlanEditorTask[])).filter(
    (t) => t.active !== false && t.selected_in_plan !== false
  );
  const boothParts = toBoothParts(
    (screen === "session" || screen === "assemble" ? tasks : planSourceRows) as Parameters<typeof toBoothParts>[0],
    (row) => sectionLabel(row as Task) || humanTitle(String(row.type || "")),
    humanTitle
  );
  const stageVisible = screen === "session" && Boolean(current) && (stageOpen || phase !== "ready");
  const boothBusy = phase === "recording" || phase === "countdown";

  function openAdvanced(panel: "menu" | "audio" | "plan" = "menu") {
    setAdvancedPanel(panel);
    setAdvancedOpen(true);
  }

  function recordPart(taskId: string) {
    if (boothBusy) return;
    if (screen !== "session") {
      void (async () => {
        await enterSession();
        selectTask(taskId);
        setStageOpen(true);
      })();
      return;
    }
    selectTask(taskId);
    setStageOpen(true);
  }

  function recordNext() {
    if (screen !== "session") {
      void enterSession().then(() => setStageOpen(true));
      return;
    }
    setStageOpen(true);
  }

  function resetTakeForRetry() {
    setError(null);
    setLocalBlobUrl(null);
    setSavedRecordingId(null);
    setProducerTip(null);
    setLayerSuggestion(null);
    setReviewVoiceOnly(false);
    setTaskTakes([]);
    setPhase("ready");
  }

  function openPreview() {
    setStageOpen(false);
    setSectionPreviewOnly(false);
    setScreen("assemble");
    void loadSongPreview();
  }

  function handlePlanTasksChange(next: PlanEditorTask[]) {
    setPlanTasks(next);
    const active = next
      .filter((t) => t.active !== false && t.selected_in_plan !== false && t.status !== "skipped")
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
  }

  async function confirmConsoleHandoff() {
    setHandingOff(true);
    try {
      const res = await fetch(`/api/projects/${id}/handoff-console`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error || "Could not open this song in Console");
        setHandoffOpen(false);
        return;
      }
      window.location.href = `/app/console/${id}`;
    } finally {
      setHandingOff(false);
    }
  }

  const advancedItems: BoothMenuItem[] = [
    ...(screen === "session" && current
      ? [
          {
            key: "upload",
            label: uploading ? "Uploading…" : "Upload a recording",
            hint: "Use a take you recorded somewhere else",
            disabled: uploading || boothBusy,
            onSelect: () => boothUploadRef.current?.click(),
          },
          ...(!current.required
            ? [
                {
                  key: "skip",
                  label: skipping ? "Skipping…" : "Skip this part",
                  disabled: skipping || boothBusy,
                  onSelect: () => {
                    setAdvancedOpen(false);
                    void skipCurrent();
                  },
                },
              ]
            : []),
        ]
      : []),
    ...(optionalOpen(tasks).length > 0
      ? [
          {
            key: "skip-optional",
            label: skipping ? "Skipping…" : `Skip optional parts (${optionalOpen(tasks).length})`,
            disabled: skipping,
            onSelect: () => {
              setAdvancedOpen(false);
              void skipAllOptional();
            },
          },
        ]
      : []),
    {
      key: "audio",
      label: "Mic & headphones",
      hint: "Choose your input and where you hear the beat",
      onSelect: () => setAdvancedPanel("audio"),
    },
    ...(planSourceRows.length > 0
      ? [{ key: "plan", label: "Edit song plan", hint: "Add, remove or move parts", onSelect: () => setAdvancedPanel("plan") }]
      : []),
    ...(coreDone(tasks).length > 0 && screen !== "assemble"
      ? [{ key: "preview", label: "Hear what I have", onSelect: () => { setAdvancedOpen(false); openPreview(); } }]
      : []),
    {
      key: "console",
      label: "Open in Console",
      hint: "Full studio. The song moves there for good.",
      disabled: boothBusy,
      onSelect: () => {
        setAdvancedOpen(false);
        setHandoffOpen(true);
      },
    },
  ];

  const reviewPlayer =
    current && localBlobUrl ? (
      <CompactAudioPlayer
        src={localBlobUrl}
        label="Your take"
        seed={`take-${current.id}`}
        beatSrc={beatUrl}
        beatStartMs={reviewBeatStartMs(
          resolveTaskWindow(withPlanTiming(current, planTasks)).startMs,
          Math.max(0, Math.min(lastRecordingOffsetMs, 120000))
        )}
        beatEndMs={
          resolveTaskWindow(withPlanTiming(current, planTasks)).endMs ??
          resolveTaskWindow(withPlanTiming(current, planTasks)).startMs + 120000
        }
        vocalVolume={1}
        beatVolume={0.06}
        overdubSrcs={reviewOverdubSrcs}
        playbackSinkId={
          !selectedSpeakerId || selectedSpeakerId === "__handset__" || selectedSpeakerId === "__headphones__"
            ? "__speaker__"
            : selectedSpeakerId
        }
        debugSectionLabel={sectionLabel(current)}
        debugTaskId={current.id}
        debugSectionStartMs={resolveTaskWindow(current).startMs}
        debugRecordingOffsetMs={lastRecordingOffsetMs}
      />
    ) : null;

  const stepIndex = current ? boothParts.findIndex((p) => p.id === current.id) : -1;

  return (
    <AppShell active="studio" userName={boothUserName} userSeed={stableAvatarSeed({ userId: boothUserId, email: boothUserEmail, name: boothUserName })}>
      <div style={{ minHeight: "100%", width: "100%" }}>
        {beatUrl && <audio ref={beatAudioRef} src={beatUrl} preload="auto" style={{ display: "none" }} />}

        {screen === "beat" && (
          <BoothBeatStep
            title={project?.title || "Your beat"}
            subtitle={[project?.genre, project?.mood, project?.tempo ? `${project.tempo} BPM` : null]
              .filter(Boolean)
              .join(" · ")}
            beatUrl={beatUrl}
            seed={project?.title || id}
            busy={analyzing}
            error={error}
            ctaLabel={tasks.length > 0 || planTasks.length > 0 ? "Continue my song" : "Start my song"}
            onStart={startProducerSession}
            onMore={() => openAdvanced()}
          />
        )}

        {screen === "analyzing" && (
          <div className="bx">
            <div className="bx-make" aria-live="polite">
              <p className="bx-eyebrow">Listening to your beat</p>
              <div className="bx-orb" aria-hidden />
              <h1 className="bx-h1" style={{ marginTop: -40 }}>Writing your song plan</h1>
              <p className="bx-sub">Finding the sections and what to sing in each.</p>
              {error ? (
                <p className="bx-error">
                  <span>{error}</span>
                  <button type="button" className="bx-chip" style={{ border: 0, cursor: "pointer" }} onClick={() => void generateAiPlan("ai")}>
                    Retry
                  </button>
                </p>
              ) : null}
            </div>
          </div>
        )}

        {screen === "plan" && boothParts.length === 0 && (
          <BoothBeatStep
            title={project?.title || "Your beat"}
            subtitle="No plan yet"
            beatUrl={beatUrl}
            seed={project?.title || id}
            busy={analyzing}
            error={error}
            ctaLabel="Write my song plan"
            onStart={() => void generateAiPlan("ai")}
            onMore={() => openAdvanced()}
          />
        )}

        {(screen === "plan" && boothParts.length > 0) || (screen === "session" && !stageVisible) ? (
          <BoothPlanStep
            title={project?.title || "Your song"}
            parts={boothParts}
            busy={analyzing || skipping}
            error={error}
            onRetry={screen === "plan" ? () => void generateAiPlan("ai") : undefined}
            onBack={() => setScreen("beat")}
            onMore={() => openAdvanced()}
            onRecordPart={recordPart}
            onRecordNext={recordNext}
            onMake={openPreview}
          />
        ) : null}

        {stageVisible && current && (
          <BoothRecordStage
            phase={phase}
            sectionLabel={sectionLabel(current)}
            partTitle={current.title?.trim() || humanTitle(current.type)}
            lyric={current.instruction?.trim() || null}
            meta={
              current.start_ms != null || current.end_ms != null
                ? `${fmtSectionWindow(resolveTaskWindow(current).startMs, resolveTaskWindow(current).endMs)}${
                    sectionMs != null ? ` · ${Math.round(sectionMs / 1000)}s` : ""
                  }`
                : null
            }
            stepText={stepIndex >= 0 ? `Part ${stepIndex + 1} of ${boothParts.length}` : "Recording"}
            countdown={countdown}
            canRecordAgain={canRecordAgain}
            showReview={showReviewUi}
            saving={uploading}
            canKeep={Boolean(savedRecordingId) || isTaskDone(current)}
            error={error}
            visualizer={
              <RecordingVisualizer
                stream={micStream}
                seconds={recordSeconds}
                maxSeconds={sectionMs != null ? sectionMs / 1000 : null}
                label="Recording"
                seed={`rec-${current.id}`}
                title={sectionLabel(current)}
                subtitle={current.title?.trim() || humanTitle(current.type)}
                timeline={formatBoothTimeline(current.start_ms, current.end_ms)}
              />
            }
            reviewPlayer={reviewPlayer}
            onRecord={startRecording}
            onStop={stopRecording}
            onCancelCount={cancelCountdown}
            onKeep={() => void goToNextSectionLead()}
            onRetry={resetTakeForRetry}
            onClose={() => {
              if (phase === "review") resetTakeForRetry();
              setStageOpen(false);
            }}
            onMore={() => openAdvanced()}
          />
        )}

        {screen === "assemble" && (
          <BoothMakeStep
            producing={producing}
            progress={produceProgress}
            stageText={produceStage ? humanProduceStage(produceStage) : null}
            error={error || previewError}
            canMake={canMakeSong(boothParts) || coreDone(tasks).length > 0}
            onMake={startProduce}
            onBack={() => {
              setSectionPreviewOnly(false);
              setScreen("session");
              setPhase("ready");
              setStageOpen(false);
            }}
            onMore={() => openAdvanced()}
            preview={
              previewLoading ? (
                <PlayerLoadingState title="Loading preview" subtitle="Gathering beat and takes…" seed={`prev-${id}`} />
              ) : (
                <SongPreviewPlayer
                  beatUrl={previewBeatUrl || beatUrl}
                  beatDurationMs={previewBeatDurationMs}
                  layers={previewLayers}
                  title={`Recorded · ${coreDone(tasks).length}/${coreTasks(tasks).length} parts`}
                  seed={project?.title || id}
                  sectionFilterSectionId={null}
                  sectionFilterStartMs={null}
                  sectionFilterEndMs={null}
                  playbackSinkId={selectedSpeakerId || "__headphones__"}
                />
              )
            }
          />
        )}

        {screen === "done" && (
          <BoothDoneStep
            title={project?.title || "Your song"}
            hasMaster={Boolean(masterUrl)}
            player={
              masterUrl ? (
                <StudioPlayer src={masterUrl} title={project?.title || "Song"} seed={project?.title || "master"} accent="signal" />
              ) : null
            }
            onDownload={() => {
              if (downloadUnlocked) setDownloadModalOpen(true);
              else setPaywallOpen(true);
            }}
            onMake={startProduce}
            onMore={() => openAdvanced()}
            extras={
              masterUrl ? (
                <div style={{ marginTop: 24 }}>
                  <PromptTweakPanel
                    projectId={id}
                    colors={{ text: C.text, textMuted: C.textMuted, surface: C.surface, border: C.border, bg: C.bg }}
                    onMasterUrl={(url) => setMasterUrl(url)}
                  />
                </div>
              ) : null
            }
          />
        )}

        <input
          ref={boothUploadRef}
          type="file"
          accept="audio/*,.wav,.mp3,.m4a,.ogg,.flac,.webm"
          style={{ display: "none" }}
          onChange={(e) => {
            setAdvancedOpen(false);
            setStageOpen(true);
            void uploadForTask(e.target.files?.[0] || null);
            e.target.value = "";
          }}
        />

        <BoothAdvancedSheet
          open={advancedOpen}
          title={advancedPanel === "audio" ? "Mic & headphones" : advancedPanel === "plan" ? "Edit song plan" : "Advanced"}
          items={advancedPanel === "menu" ? advancedItems : undefined}
          onClose={() => setAdvancedOpen(false)}
        >
          {advancedPanel === "audio" ? (
            <div>
              <MicInputPicker selectedDeviceId={selectedMicId} onSelect={onMicSelect} disabled={boothBusy} />
              <SpeakerOutputPicker selectedDeviceId={selectedSpeakerId} onSelect={onSpeakerSelect} disabled={boothBusy} />
              <button
                type="button"
                className="ap-sheet-btn primary"
                style={{ marginTop: 14 }}
                onClick={() => {
                  writeAudioSetupConfirmed(true);
                  setAudioSetupOpen(false);
                  setAdvancedOpen(false);
                }}
              >
                Done
              </button>
            </div>
          ) : null}
          {advancedPanel === "plan" ? (
            <PlanEditor
              projectId={id}
              tasks={planSourceRows}
              planMode={planMode}
              onModeChange={(m) => {
                setPlanMode(m);
                void fetch(`/api/projects/${id}/plan`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ action: "set_mode", mode: m }),
                }).catch(() => undefined);
              }}
              onTasksChange={handlePlanTasksChange}
            />
          ) : null}
        </BoothAdvancedSheet>

        <ConsoleHandoffSheet
          open={handoffOpen}
          songTitle={project?.title}
          busy={handingOff}
          onConfirm={() => void confirmConsoleHandoff()}
          onCancel={() => setHandoffOpen(false)}
        />

      {paywallOpen && (
        <ApPaywall
          open={paywallOpen}
          onClose={() => setPaywallOpen(false)}
          songTitle={project?.title}
          projectId={id}
          colors={{
            text: C.text,
            textMuted: C.textMuted,
            surface: C.bg,
            border: C.border,
            accent: "#c17a12",
            bg: C.bg,
          }}
          onUnlocked={() => {
            setDownloadUnlocked(true);
            setPaywallOpen(false);
            setDownloadModalOpen(true);
          }}
        />
      )}
      {downloadModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 10000,
            background: "rgba(0,0,0,0.55)",
            display: "grid",
            placeItems: "center",
            padding: 16,
          }}
          onClick={() => setDownloadModalOpen(false)}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 340,
              borderRadius: 18,
              background: C.surface,
              border: `1px solid ${C.border}`,
              padding: "22px 20px",
              boxShadow: C.cardShadow,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 6 }}>Download</div>
            <p style={{ color: C.textMuted, fontSize: 13, margin: "0 0 16px" }}>
              Choose a format for your master.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <button
                type="button"
                style={{ ...btn, width: "100%" }}
                onClick={() => {
                  setDownloadModalOpen(false);
                  void downloadMaster("wav");
                }}
              >
                WAV
              </button>
              <button
                type="button"
                style={{ ...btn2, width: "100%" }}
                onClick={() => {
                  setDownloadModalOpen(false);
                  void downloadMaster("mp3");
                }}
              >
                MP3
              </button>
              <button
                type="button"
                style={{
                  padding: 10,
                  border: "none",
                  background: "transparent",
                  color: C.textMuted,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
                onClick={() => setDownloadModalOpen(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    </AppShell>
  );
}
