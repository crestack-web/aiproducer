/**
 * Integrate AP arrangement engine with existing produce jobs.
 */

import { createServiceClient } from "@/lib/supabase/server";
import { downloadStorageOrUrl } from "@/lib/audio/roex-assets";
import {
  productionMasterPath,
  productionMixPath,
  uploadBuffer,
  isStoragePath,
} from "@/lib/storage";
import { runApArrangement } from "../index";
import type { ApStage } from "../types";
import type { ApVocalLayerInput } from "../index";

export async function runInternalApProduceJob(opts: {
  jobId: string;
  projectId: string;
  userId: string;
}): Promise<{ complete: boolean; error?: string }> {
  const { jobId, projectId, userId } = opts;
  const supabase = createServiceClient();

  const patch = async (stage: string, progress: number, extra?: Record<string, unknown>) => {
    const { data: job } = await supabase.from("jobs").select("output_data").eq("id", jobId).single();
    const out = { ...((job?.output_data as object) || {}), ...(extra || {}), mode: "ap", provider: "ap-internal" };
    await supabase
      .from("jobs")
      .update({
        status:
          stage === "failed"
            ? "failed"
            : stage === "completed" || stage === "complete"
              ? "complete"
              : "processing",
        stage,
        progress,
        output_data: out,
        ...(stage === "completed" || stage === "complete" || stage === "failed"
          ? { completed_at: new Date().toISOString() }
          : {}),
        ...(stage === "failed" && extra?.error ? { error: String(extra.error) } : {}),
      })
      .eq("id", jobId);
  };

  const report = async (stage: ApStage) => {
    const progressMap: Record<string, number> = {
      analyzing: 20,
      restoring: 35,
      producing: 50,
      mixing: 70,
      mastering: 85,
      quality_check: 92,
      completed: 100,
      failed: 100,
      queued: 10,
    };
    await patch(stage === "completed" ? "complete" : stage, progressMap[stage] ?? 40);
  };

  try {
    const { data: project } = await supabase
      .from("projects")
      .select("id, genre, mood, tempo")
      .eq("id", projectId)
      .single();

    const { data: beat } = await supabase
      .from("beats")
      .select("audio_path, duration_ms, tempo")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!beat?.audio_path || !isStoragePath(beat.audio_path)) {
      await patch("failed", 100, { error: "Beat validation failed — add a beat before Produce." });
      await supabase.from("projects").update({ status: "recording" }).eq("id", projectId);
      return { complete: false, error: "Beat validation failed" };
    }

    const { data: tasks } = await supabase
      .from("recording_tasks")
      .select("id, type, title, start_ms, end_ms, status, active, selected_in_plan, section_id, metadata")
      .eq("project_id", projectId);

    const activeTasks = (tasks || []).filter((t) => t.active !== false && t.selected_in_plan !== false);

    const vocals: ApVocalLayerInput[] = [];
    for (const t of activeTasks) {
      const { data: recs } = await supabase
        .from("recordings")
        .select("id, audio_path, original_path, is_selected, timeline_start_ms")
        .eq("task_id", t.id)
        .order("created_at", { ascending: false });
      const selected =
        (recs || []).find((r) => r.is_selected) || (recs || []).find((r) => r.audio_path) || null;
      const path = selected?.original_path || selected?.audio_path;
      if (!path || !isStoragePath(path)) continue;

      const meta = (t.metadata || {}) as { section_label?: string };
      const sectionLabel =
        meta.section_label ||
        t.title ||
        (typeof t.type === "string" ? t.type : null);

      try {
        const buffer = await downloadStorageOrUrl(path);
        vocals.push({
          buffer,
          pathHint: path,
          taskType: t.type,
          sectionLabel,
          startMs: selected?.timeline_start_ms ?? t.start_ms ?? 0,
        });
      } catch (e) {
        console.warn("[ap-tick] skip vocal download", t.id, e);
      }
    }

    if (!vocals.length) {
      await patch("failed", 100, {
        error: "No saved vocal take found. Record a section, then Produce.",
      });
      await supabase.from("projects").update({ status: "recording" }).eq("id", projectId);
      return { complete: false, error: "No vocal take" };
    }

    await report("analyzing");
    const beatBuffer = await downloadStorageOrUrl(beat.audio_path);

    const result = await runApArrangement(
      {
        jobId,
        projectId,
        userId,
        beatBuffer,
        beatPathHint: beat.audio_path,
        vocals,
        genre: project?.genre,
      },
      report
    );

    if (!result.ok) {
      await patch("failed", 100, {
        error: result.error,
        detail: result.detail,
        engineVersion: result.engineVersion,
      });
      await supabase.from("projects").update({ status: "recording" }).eq("id", projectId);
      return { complete: false, error: result.error };
    }

    const mixPath = productionMixPath(userId, projectId, jobId, "wav");
    const masterPath = productionMasterPath(userId, projectId, jobId, "wav");
    const processedVocalPath = `users/${userId}/projects/${projectId}/production/${jobId}/vocal-processed.wav`;
    const restoredVocalPath = `users/${userId}/projects/${projectId}/production/${jobId}/vocal-restored.wav`;

    await uploadBuffer(mixPath, result.mixWav, "audio/wav");
    await uploadBuffer(masterPath, result.masterWav, "audio/wav");
    await uploadBuffer(processedVocalPath, result.processedVocalWav, "audio/wav");
    await uploadBuffer(restoredVocalPath, result.restoredVocalWav, "audio/wav");

    let mp3Path: string | null = null;
    if (result.masterMp3) {
      mp3Path = productionMasterPath(userId, projectId, jobId, "mp3");
      await uploadBuffer(mp3Path, result.masterMp3, "audio/mpeg");
    }

    const roleNote = result.decision.notes.find((n) => n.startsWith("roles:"));

    await supabase.from("songs").insert({
      project_id: projectId,
      audio_path: masterPath,
      status: "ready",
      version: 1,
      metadata: {
        mode: "ap",
        provider: "ap-internal",
        engineVersion: result.engineVersion,
        mix_storage_path: mixPath,
        master_mp3_path: mp3Path,
        processed_vocal_path: processedVocalPath,
        restored_vocal_path: restoredVocalPath,
        decision: result.decision,
        vocal_layers: vocals.length,
        roles: roleNote || null,
        qc: result.qc,
        retryCount: result.retryCount,
      },
    });

    await supabase
      .from("jobs")
      .update({
        status: "complete",
        stage: "complete",
        progress: 100,
        error: null,
        output_data: {
          mode: "ap",
          provider: "ap-internal",
          engineVersion: result.engineVersion,
          mix_storage_path: mixPath,
          master_storage_path: masterPath,
          master_mp3_path: mp3Path,
          processed_vocal_path: processedVocalPath,
          restored_vocal_path: restoredVocalPath,
          vocal_layers: vocals.length,
          decision_notes: result.decision.notes,
          qc: result.qc,
          retryCount: result.retryCount,
          processing_ms: result.durationMs,
        },
        completed_at: new Date().toISOString(),
      })
      .eq("id", jobId);

    await supabase.from("projects").update({ status: "complete" }).eq("id", projectId);
    return { complete: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await patch("failed", 100, { error: msg });
    await supabase.from("projects").update({ status: "recording" }).eq("id", projectId);
    return { complete: false, error: msg };
  }
}
