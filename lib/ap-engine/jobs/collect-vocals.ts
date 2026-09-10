/**
 * Collect vocal takes for AP produce — same membership + placement as session-preview.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  activePlanTaskIds,
  isCompletedTaskStatus,
  oneTakePerTask,
} from "@/lib/audio/active-plan-membership";
import { resolvePlacementStartMs } from "@/lib/audio/session-timeline";
import { downloadStorageOrUrl } from "@/lib/audio/roex-assets";
import { isStoragePath } from "@/lib/storage";
import type { ApVocalLayerInput } from "../index";

type RecRow = {
  id: string;
  task_id: string | null;
  audio_path: string | null;
  original_audio_path?: string | null;
  original_path?: string | null;
  is_selected?: boolean | null;
  timeline_start_ms?: number | null;
  recording_offset_ms?: number | null;
  metadata?: Record<string, unknown> | null;
};

type TaskRow = {
  id: string;
  type?: string | null;
  title?: string | null;
  start_ms?: number | null;
  end_ms?: number | null;
  active?: boolean | null;
  selected_in_plan?: boolean | null;
  status?: string | null;
  metadata?: { section_label?: string; section_id?: string } | null;
};

export type PlacementLog = {
  taskId: string;
  type: string;
  startMs: number;
  path: string;
  title?: string | null;
};

export async function collectVocalsForProduce(
  service: SupabaseClient,
  projectId: string
): Promise<{ vocals: ApVocalLayerInput[]; placementLog: PlacementLog[]; diagnostics: string[] }> {
  const diagnostics: string[] = [];

  const taskSelects = [
    "id, type, title, start_ms, end_ms, status, active, selected_in_plan, section_id, metadata",
    "id, type, title, start_ms, end_ms, status, active, selected_in_plan, metadata",
    "id, type, title, start_ms, end_ms, status, metadata",
    "id, type, title, start_ms, end_ms, status",
  ];

  let allTasks: TaskRow[] = [];
  for (const cols of taskSelects) {
    const { data, error } = await service
      .from("recording_tasks")
      .select(cols)
      .eq("project_id", projectId)
      .order("start_ms", { ascending: true });
    if (!error && data) {
      allTasks = data as unknown as TaskRow[];
      diagnostics.push(`tasks=${allTasks.length} cols=${cols.split(",").length}`);
      break;
    }
    if (error) diagnostics.push(`tasks_err: ${error.message}`);
  }

  const activeIds = activePlanTaskIds(allTasks);
  for (const t of allTasks) {
    if (!isCompletedTaskStatus(t.status)) continue;
    if (t.active === false) continue;
    if (t.selected_in_plan === false) continue;
    activeIds.add(t.id);
  }
  const selectedTaskIds = [...activeIds];
  const tasks = allTasks.filter((t) => selectedTaskIds.includes(t.id));
  diagnostics.push(`active_plan_tasks=${selectedTaskIds.length}`);

  let recordings: RecRow[] = [];
  const recSelects = [
    "id, task_id, audio_path, original_audio_path, original_path, is_selected, timeline_start_ms, recording_offset_ms, metadata",
    "id, task_id, audio_path, original_audio_path, is_selected, timeline_start_ms, metadata",
    "id, task_id, audio_path, is_selected, timeline_start_ms, metadata",
    "id, task_id, audio_path, is_selected, metadata",
    "id, task_id, audio_path, is_selected",
  ];
  for (const cols of recSelects) {
    const { data, error } = await service
      .from("recordings")
      .select(cols)
      .eq("project_id", projectId)
      .order("created_at", { ascending: false });
    if (!error && data) {
      recordings = data as unknown as RecRow[];
      diagnostics.push(`recordings=${recordings.length}`);
      break;
    }
    if (error) diagnostics.push(`rec_err: ${error.message}`);
  }

  // Fallback: by task id if project_id column missing / empty
  if (recordings.length === 0 && selectedTaskIds.length > 0) {
    const { data } = await service
      .from("recordings")
      .select("id, task_id, audio_path, original_path, is_selected, timeline_start_ms, metadata")
      .in("task_id", selectedTaskIds.slice(0, 80));
    if (data?.length) {
      recordings = data as unknown as RecRow[];
      diagnostics.push(`recordings_by_task=${recordings.length}`);
    }
  }

  const matched = recordings.filter(
    (r) => r.task_id && selectedTaskIds.includes(r.task_id)
  );
  const takes = oneTakePerTask(matched);
  diagnostics.push(`takes_after_one_per_task=${takes.length}`);

  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const vocals: ApVocalLayerInput[] = [];
  const placementLog: PlacementLog[] = [];

  for (const rec of takes) {
    const task = taskById.get(rec.task_id as string);
    if (!task) continue;

    const path =
      (rec.original_path && isStoragePath(rec.original_path) && rec.original_path) ||
      (rec.original_audio_path && isStoragePath(rec.original_audio_path) && rec.original_audio_path) ||
      (rec.audio_path && isStoragePath(rec.audio_path) && rec.audio_path) ||
      null;
    if (!path) {
      diagnostics.push(`skip_no_path task=${rec.task_id}`);
      continue;
    }

    const meta = (rec.metadata || {}) as Record<string, unknown>;
    const offsetFromMeta =
      typeof meta.recording_offset_ms === "number" ? (meta.recording_offset_ms as number) : null;
    const placementFromMeta =
      typeof meta.placement_start_ms === "number" ? (meta.placement_start_ms as number) : null;

    const startMs = resolvePlacementStartMs({
      sectionStartMs: task.start_ms,
      recordingOffsetMs:
        typeof rec.recording_offset_ms === "number" ? rec.recording_offset_ms : offsetFromMeta,
      timelineStartMs: rec.timeline_start_ms,
      placementStartMs: placementFromMeta,
    });

    const taskMeta = (task.metadata || {}) as { section_label?: string };
    const sectionLabel = taskMeta.section_label || task.title || task.type || null;

    try {
      const buffer = await downloadStorageOrUrl(path);
      vocals.push({
        buffer,
        pathHint: path,
        taskType: task.type,
        sectionLabel,
        startMs,
      });
      placementLog.push({
        taskId: task.id,
        type: String(task.type || ""),
        startMs,
        path,
        title: task.title,
      });
    } catch (e) {
      diagnostics.push(
        `download_fail task=${task.id}: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  diagnostics.push(`vocals_loaded=${vocals.length}`);
  return { vocals, placementLog, diagnostics };
}
