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

// PARTIAL - full body continues in next commit
export default function ProjectDetailPage() {
  return (
    <div style={{ padding: 24 }}>
      <p>Session UI restoring…</p>
    </div>
  );
}
