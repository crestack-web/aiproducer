"use client";

import { analyzeAudioBlob } from "@/lib/audio/analysis";
import type { AudioAnalysis } from "@/lib/audio/analysis-types";
import { audioBlobToWavDetailed } from "@/lib/client/export-wav";

export type AnalysisTaskRef = {
  id: string;
  type: string;
  start_ms?: number | null;
  end_ms?: number | null;
  section_id?: string | null;
  metadata?: { section_label?: string; section_id?: string } | null;
};

export type AttachAnalysisResult = {
  analysis: AudioAnalysis | null;
  wavBlob: Blob | null;
  conversionMethod: string | null;
  conversionSampleRate: number | null;
  sourceSampleRate: number | null;
  sourceChannels: number | null;
  sourceDurationSec: number | null;
  outputDurationSec: number | null;
  sourceFrameCount: number | null;
  outputFrameCount: number | null;
  durationDeltaMs: number | null;
};

/**
 * Analyze blob, convert to WAV for produce alignment, append to FormData.
 * Preserves original MediaRecorder blob as original_file.
 * Never throws — analysis / WAV failure is soft.
 */
export async function attachAnalysisToForm(
  form: FormData,
  blob: Blob,
  task: AnalysisTaskRef,
  projectId: string
): Promise<AttachAnalysisResult> {
  const expected =
    typeof task.end_ms === "number" && typeof task.start_ms === "number"
      ? task.end_ms - task.start_ms
      : null;
  const sectionId =
    task.section_id ||
    (task.metadata && typeof task.metadata.section_id === "string"
      ? task.metadata.section_id
      : null);

  const result: AttachAnalysisResult = {
    analysis: null,
    wavBlob: null,
    conversionMethod: null,
    conversionSampleRate: null,
    sourceSampleRate: null,
    sourceChannels: null,
    sourceDurationSec: null,
    outputDurationSec: null,
    sourceFrameCount: null,
    outputFrameCount: null,
    durationDeltaMs: null,
  };

  if (!form.has("original_file")) {
    const origName =
      (blob.type || "").includes("mp4")
        ? "take.mp4"
        : (blob.type || "").includes("webm")
          ? "take.webm"
          : "take.bin";
    form.set("original_file", blob, origName);
  }
  form.set("original_mime", blob.type || "application/octet-stream");
  form.set("original_bytes", String(blob.size));

  try {
    const wav = await audioBlobToWavDetailed(blob);
    result.wavBlob = wav.blob;
    result.conversionMethod = wav.method;
    result.conversionSampleRate = wav.sampleRate;
    result.sourceSampleRate = wav.sourceSampleRate;
    result.sourceChannels = wav.sourceChannels;
    result.sourceDurationSec = wav.sourceDurationSec;
    result.outputDurationSec = wav.outputDurationSec;
    result.sourceFrameCount = wav.sourceFrameCount;
    result.outputFrameCount = wav.outputFrameCount;
    result.durationDeltaMs = wav.durationDeltaMs;
    form.set("file", wav.blob, "take.wav");
    form.set("conversion_method", wav.method);
    form.set("conversion_sample_rate", String(wav.sampleRate));
    form.set("source_sample_rate", String(wav.sourceSampleRate));
    form.set("source_channels", String(wav.sourceChannels));
    form.set("source_duration_sec", String(wav.sourceDurationSec));
    form.set("output_duration_sec", String(wav.outputDurationSec));
    form.set("duration_delta_ms", String(wav.durationDeltaMs));
    form.set("wav_conversion", "ok");
  } catch (e) {
    // Produce needs WAV — mark failure so we don't silently store WebM as the produce source
    form.set("wav_conversion", "failed");
    form.set(
      "wav_conversion_error",
      e instanceof Error ? e.message.slice(0, 200) : "wav_conversion_failed"
    );
    console.warn("[attachAnalysisToForm] WAV conversion failed", e);
  }

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
    if (analysis.loudness?.peak != null) {
      form.set("peak", String(analysis.loudness.peak));
    }
    if (analysis.loudness?.rms != null) {
      form.set("rms", String(analysis.loudness.rms));
    }
    result.analysis = analysis;
    return result;
  } catch {
    return result;
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
