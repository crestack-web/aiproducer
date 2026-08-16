"use client";

import { analyzeAudioBlob } from "@/lib/audio/analysis";
import type { AudioAnalysis } from "@/lib/audio/analysis-types";

export type AnalysisTaskRef = {
  id: string;
  type: string;
  start_ms?: number | null;
  end_ms?: number | null;
  section_id?: string | null;
  metadata?: { section_label?: string; section_id?: string } | null;
};

/** Analyze blob and append analysis + duration to FormData. Never throws. */
export async function attachAnalysisToForm(
  form: FormData,
  blob: Blob,
  task: AnalysisTaskRef,
  projectId: string
): Promise<AudioAnalysis | null> {
  const expected =
    typeof task.end_ms === "number" && typeof task.start_ms === "number"
      ? task.end_ms - task.start_ms
      : null;
  const sectionId =
    task.section_id ||
    (task.metadata && typeof task.metadata.section_id === "string"
      ? task.metadata.section_id
      : null);
  try {
    const analysis = await analyzeAudioBlob(blob, {
      projectId,
      sectionId,
      role: task.type,
      timelineStartMs: task.start_ms ?? null,
      timelineEndMs: task.end_ms ?? null,
      expectedDurationMs: expected,
    });
    form.append("analysis", JSON.stringify(analysis));
    if (analysis.durationMs != null) {
      form.set("duration_ms", String(analysis.durationMs));
    }
    return analysis;
  } catch {
    return null;
  }
}

export async function fetchProducerRecommendation(
  taskId: string,
  recordingId: string
): Promise<string | null> {
  try {
    const res = await fetch(
      `/api/recording-tasks/${taskId}/recordings/${recordingId}/analyze`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }
    );
    const j = await res.json().catch(() => ({}));
    if (res.ok && j.recommendation?.message) return String(j.recommendation.message);
  } catch {
    /* ignore */
  }
  return null;
}
