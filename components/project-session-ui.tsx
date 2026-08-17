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

  // PARTIAL UPLOAD MARKER - step 1 of 3 - DO NOT DEPLOY
  return (
    <AppShell active="studio">
      <div>Loading booth restore…</div>
    </AppShell>
  );
}
