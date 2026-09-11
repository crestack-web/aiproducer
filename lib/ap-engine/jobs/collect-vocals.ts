/**
 * Collect vocal takes for AP produce — same membership + placement as session-preview.
 * Loads ALL section takes on the active plan (verse + chorus + bridge + …), not one only.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  activePlanTaskIds,
  isCompletedTaskStatus,
  matchRecordingsToActivePlan,
  oneTakePerTask,
  recoverMissingTaskTakes,
} from "@/lib/audio/active-plan-membership";
import { resolvePlacementStartMs } from "@/lib/audio/session-timeline";
import { downloadStorageOrUrl } from "@/lib/audio/roex-assets";
import { isStoragePath } from "@/lib/storage";
import type { ApVocalLayerInput } from "../index";
import { normalizeToInternalPcm } from "../ingestion/normalize";
import { pickBestTake, stitchBestPhrases, scoreTake } from "../production/comping";
import { encodeStereoWav } from "../dsp";


type RecRow = {
  id: string;
  task_id: string | null;
  audio_path: string | null;
  original_audio_path?: string | null;
  original_path?: string | null;
  processed_path?: string | null;
  is_selected?: boolean | null;
  timeline_start_ms?: number | null;
  recording_offset_ms?: number | null;
  created_at?: string | null;
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

function pickPath(rec: RecRow): string | null {
  const candidates = [
    rec.original_path,
    rec.original_audio_path,
    rec.processed_path,
    rec.audio_path,
  ];
  for (const p of candidates) {
    if (p && isStoragePath(p)) return p;
  }
  return null;
}

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

  // Active plan + every completed task that is not explicitly deselected
  const activeIds = activePlanTaskIds(allTasks);
  for (const t of allTasks) {
    if (!isCompletedTaskStatus(t.status)) continue;
    if (t.active === false) continue;
    if (t.selected_in_plan === false) continue;
    if (t.status === "skipped") continue;
    activeIds.add(t.id);
  }
  const selectedTaskIds = [...activeIds];
  const tasks = allTasks.filter((t) => selectedTaskIds.includes(t.id));
  diagnostics.push(`active_plan_tasks=${selectedTaskIds.length}`);

  let recordings: RecRow[] = [];
  const recSelects = [
    "id, task_id, audio_path, original_audio_path, original_path, processed_path, is_selected, timeline_start_ms, recording_offset_ms, created_at, metadata",
    "id, task_id, audio_path, original_audio_path, original_path, is_selected, timeline_start_ms, recording_offset_ms, created_at, metadata",
    "id, task_id, audio_path, original_path, is_selected, timeline_start_ms, metadata",
    "id, task_id, audio_path, is_selected, timeline_start_ms, metadata",
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
      .select(
        "id, task_id, audio_path, original_path, original_audio_path, is_selected, timeline_start_ms, created_at, metadata"
      )
      .in("task_id", selectedTaskIds.slice(0, 80))
      .order("created_at", { ascending: false });
    if (data?.length) {
      recordings = data as unknown as RecRow[];
      diagnostics.push(`recordings_by_task=${recordings.length}`);
    }
  }

  const matched = matchRecordingsToActivePlan(allTasks, recordings);
  let takes = oneTakePerTask(matched);
  takes = recoverMissingTaskTakes({
    planTasks: allTasks,
    allRecordings: recordings,
    currentTakes: takes,
  });
  diagnostics.push(
    `takes_after_membership=${takes.length} matched=${matched.length} recordings=${recordings.length}`
  );

  // Ultimate fallback: one take per task_id among all project recordings with paths
  if (takes.length <= 1 && recordings.length > 1) {
    const withPath = recordings.filter((r) => pickPath(r));
    const expanded = oneTakePerTask(withPath);
    if (expanded.length > takes.length) {
      takes = expanded;
      diagnostics.push(`takes_expanded_all_recordings=${takes.length}`);
    }
  }

  const taskById = new Map(allTasks.map((t) => [t.id, t]));
  const vocals: ApVocalLayerInput[] = [];
  const placementLog: PlacementLog[] = [];

  // Group ALL project recordings by task for automatic comping (best take / phrase stitch)
  const byTask = new Map<string, RecRow[]>();
  for (const r of recordings) {
    if (!pickPath(r)) continue;
    const tid = (r.task_id || r.id) as string;
    // Only tasks we already selected via membership OR that appear in takes
    const allowed = takes.some((t) => (t.task_id || t.id) === tid) || taskById.has(tid);
    if (!allowed) continue;
    const list = byTask.get(tid) || [];
    list.push(r);
    byTask.set(tid, list);
  }
  // Ensure every membership take is represented
  for (const t of takes) {
    const tid = (t.task_id || t.id) as string;
    if (!byTask.has(tid)) byTask.set(tid, [t]);
  }

  for (const [tid, recs] of byTask) {
    const task =
      taskById.get(tid) ||
      ({
        id: tid,
        type: "lead",
        title: null,
        start_ms: null,
        end_ms: null,
      } as TaskRow);

    // Prefer selected first, then newest — max 3 candidates
    const sorted = [...recs].sort((a, b) => {
      if (a.is_selected && !b.is_selected) return -1;
      if (!a.is_selected && b.is_selected) return 1;
      return String(b.created_at || "").localeCompare(String(a.created_at || ""));
    });
    const candidates = sorted.slice(0, 3);

    const taskMeta = (task.metadata || {}) as { section_label?: string };
    const sectionLabel = taskMeta.section_label || task.title || task.type || null;

    type Cand = { rec: RecRow; path: string; pcm: Awaited<ReturnType<typeof normalizeToInternalPcm>>["pcm"]; buffer: Buffer };
    const loaded: Cand[] = [];

    for (const rec of candidates) {
      const path = pickPath(rec);
      if (!path) continue;
      try {
        const buffer = await downloadStorageOrUrl(path);
        const norm = await normalizeToInternalPcm(buffer, path);
        loaded.push({ rec, path, pcm: norm.pcm, buffer });
      } catch (e) {
        diagnostics.push(
          `download_fail task=${tid} rec=${rec.id}: ${e instanceof Error ? e.message : String(e)}`
        );
      }
    }
    if (!loaded.length) continue;

    let chosen = loaded[0];
    let compNote = "single_take";

    if (loaded.length >= 2) {
      try {
        const { best, scores, index } = pickBestTake(loaded.map((c) => ({ pcm: c.pcm })));
        chosen = loaded[index];
        compNote = `best_take idx=${index} score=${scores[index].score.toFixed(1)}`;
        // Phrase stitch when 2+ solid takes of similar length
        const lengths = loaded.map((c) => c.pcm.left.length);
        const minL = Math.min(...lengths);
        const maxL = Math.max(...lengths);
        const solid = loaded.filter((_, i) => scores[i].score > 0 && scores[i].clipRatio < 0.01);
        if (solid.length >= 2 && maxL > 0 && minL / maxL > 0.75) {
          const stitched = stitchBestPhrases(
            solid.map((c) => c.pcm),
            450
          );
          if (stitched.switches >= 1) {
            const wavBuf = encodeStereoWav(stitched.pcm);
            chosen = {
              ...chosen,
              pcm: stitched.pcm,
              buffer: wavBuf,
              path: chosen.path + "#comp",
            };
            compNote = `phrase_comp switches=${stitched.switches} from=${solid.length}`;
          }
        }
      } catch (e) {
        diagnostics.push(`comp_fail task=${tid}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    const meta = (chosen.rec.metadata || {}) as Record<string, unknown>;
    const offsetFromMeta =
      typeof meta.recording_offset_ms === "number" ? (meta.recording_offset_ms as number) : null;
    const placementFromMeta =
      typeof meta.placement_start_ms === "number" ? (meta.placement_start_ms as number) : null;

    const startMs = resolvePlacementStartMs({
      sectionStartMs: task.start_ms,
      recordingOffsetMs:
        typeof chosen.rec.recording_offset_ms === "number"
          ? chosen.rec.recording_offset_ms
          : offsetFromMeta,
      timelineStartMs: chosen.rec.timeline_start_ms,
      placementStartMs: placementFromMeta,
    });

    diagnostics.push(`comp task=${tid} ${compNote} candidates=${loaded.length}`);

    vocals.push({
      buffer: chosen.buffer,
      pathHint: chosen.path,
      taskType: task.type,
      sectionLabel,
      startMs,
    });
    placementLog.push({
      taskId: task.id,
      type: String(task.type || ""),
      startMs,
      path: chosen.path,
      title: task.title,
    });
  }

  diagnostics.push(`vocals_loaded=${vocals.length}`);
  if (vocals.length <= 1 && recordings.length > 1) {
    diagnostics.push(
      `WARN_single_vocal_of_many recordings=${recordings.length} takes=${takes.length}`
    );
  }
  return { vocals, placementLog, diagnostics };
}
