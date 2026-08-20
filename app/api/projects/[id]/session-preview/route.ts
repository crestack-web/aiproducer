import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { createSignedDownloadUrl } from "@/lib/storage";
import { resolvePlacementStartMs } from "@/lib/audio/session-timeline";
import {
  activePlanTaskIds,
  isCompletedTaskStatus,
  oneTakePerTask,
  type PlanTaskFlags,
} from "@/lib/audio/active-plan-membership";

type Ctx = { params: Promise<{ id: string }> };

type RecRow = {
  id: string;
  task_id: string | null;
  audio_path: string | null;
  original_audio_path?: string | null;
  original_path?: string | null;
  duration_ms: number | null;
  take_number: number | null;
  is_selected: boolean | null;
  timeline_start_ms?: number | null;
  timeline_end_ms?: number | null;
  recording_offset_ms?: number | null;
  metadata?: Record<string, unknown> | null;
  project_id?: string | null;
};

type TaskRow = PlanTaskFlags & {
  type?: string | null;
  title?: string | null;
  instruction?: string | null;
  start_ms?: number | null;
  end_ms?: number | null;
  required?: boolean | null;
  metadata?: { section_label?: string } | null;
};

/**
 * GET /api/projects/:id/session-preview
 *
 * Membership (same as Produce):
 *   active plan task ids → recordings.task_id → one take per task → placementStartMs
 */
export async function GET(_req: Request, ctx: Ctx) {
  const { id: projectId } = await ctx.params;
  const { user, supabase, error } = await requireUser();
  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: project } = await supabase
    .from("projects")
    .select("id, title")
    .eq("id", projectId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data: beat } = await supabase
    .from("beats")
    .select("id, audio_path, duration_ms, bpm")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let beat_url: string | null = null;
  if (beat?.audio_path) {
    try {
      beat_url = await createSignedDownloadUrl(beat.audio_path, 3600);
    } catch (e) {
      console.error("session-preview beat url", e);
    }
  }

  // Resilient task load: older DBs may lack section_id / plan flags.
  // Explicit select of a missing column caused HTTP 500 "Could not load tasks"
  // and empty Preview (layer_count 0) even when the session UI had 7/7 completed.
  const service = createServiceClient();
  const taskSelects = [
    "id, type, title, instruction, status, start_ms, end_ms, required, metadata, active, selected_in_plan, section_id",
    "id, type, title, instruction, status, start_ms, end_ms, required, metadata, active, selected_in_plan",
    "id, type, title, instruction, status, start_ms, end_ms, required, metadata",
    "id, type, title, instruction, status, start_ms, end_ms, required",
    "id, type, title, status, start_ms, end_ms, metadata",
    "id, type, status, start_ms, end_ms",
  ];

  let tasksRaw: unknown[] | null = null;
  let taskLoadDiag = "";
  for (const cols of taskSelects) {
    // Prefer service after ownership check (same as recordings) so RLS cannot empty the plan.
    const { data, error: tErr } = await service
      .from("recording_tasks")
      .select(cols)
      .eq("project_id", projectId)
      .order("start_ms", { ascending: true });
    if (!tErr) {
      tasksRaw = (data as unknown[]) ?? [];
      taskLoadDiag = `tasks_cols=${cols.split(",").length} count=${tasksRaw.length}`;
      break;
    }
    taskLoadDiag = `tasks_select_failed: ${tErr.message}`;
    // Retry same cols with user client in case service key misconfigured
    const { data: dataUser, error: tErrUser } = await supabase
      .from("recording_tasks")
      .select(cols)
      .eq("project_id", projectId)
      .order("start_ms", { ascending: true });
    if (!tErrUser) {
      tasksRaw = (dataUser as unknown[]) ?? [];
      taskLoadDiag = `tasks_user_cols=${cols.split(",").length} count=${tasksRaw.length}`;
      break;
    }
    taskLoadDiag = `tasks_select_failed: ${tErr.message}; user: ${tErrUser.message}`;
  }

  if (tasksRaw == null) {
    console.error("session-preview tasks", taskLoadDiag);
    return NextResponse.json(
      {
        error: "Could not load tasks",
        diagnostics: [taskLoadDiag],
        layer_count: 0,
        selected_task_ids: [],
        matched_task_ids: [],
        unmatched_selected_task_ids: [],
        layers: [],
      },
      { status: 500 }
    );
  }

  const allTasks = (tasksRaw ?? []) as (TaskRow & {
    status?: string | null;
    section_id?: string | null;
  })[];

  // Active plan is authoritative. Also keep completed plan tasks that still
  // belong to the artist plan (same rule as coreDone / progress UI) so Preview
  // Recorded cannot go empty while the progress indicator shows N/M recorded.
  const activeIds = activePlanTaskIds(allTasks);
  for (const t of allTasks) {
    const status = (t.status || "").toLowerCase();
    if (!isCompletedTaskStatus(status)) continue;
    if (t.active === false) continue;
    if (t.selected_in_plan === false) continue;
    activeIds.add(t.id);
  }
  const selectedTaskIds = [...activeIds];
  const tasks = allTasks.filter((t) => selectedTaskIds.includes(t.id));

  const diagnostics: string[] = [];
  if (taskLoadDiag) diagnostics.push(taskLoadDiag);
  diagnostics.push(
    `active_plan_tasks=${selectedTaskIds.length} total_tasks=${allTasks.length} completed_in_plan=${allTasks.filter((t) => isCompletedTaskStatus(t.status)).length}`
  );

  let recordings: RecRow[] = [];

  // service client already created above (tasks + recordings after ownership check)

  if (selectedTaskIds.length > 0) {
    const selects = [
      "id, task_id, project_id, audio_path, original_audio_path, duration_ms, take_number, is_selected, timeline_start_ms, timeline_end_ms, recording_offset_ms, metadata",
      "id, task_id, project_id, audio_path, original_audio_path, duration_ms, take_number, is_selected, timeline_start_ms, timeline_end_ms, metadata",
      "id, task_id, project_id, audio_path, duration_ms, take_number, is_selected, timeline_start_ms, metadata",
      "id, task_id, project_id, audio_path, duration_ms, take_number, is_selected, metadata",
      "id, task_id, audio_path, duration_ms, take_number, is_selected, metadata",
      "id, task_id, audio_path, duration_ms, take_number, is_selected",
    ];

    let loaded = false;
    for (const cols of selects) {
      const { data: recs, error: rErr } = await service
        .from("recordings")
        .select(cols)
        .eq("project_id", projectId)
        .order("take_number", { ascending: false });
      if (rErr) {
        diagnostics.push(`recordings by project failed: ${rErr.message}`);
        continue;
      }
      recordings = ((recs as unknown) as RecRow[]) ?? [];
      loaded = true;
      diagnostics.push(`recordings_by_project=${recordings.length}`);
      break;
    }

    if (!loaded || recordings.length === 0) {
      const idChunks: string[][] = [];
      for (let i = 0; i < selectedTaskIds.length; i += 80) {
        idChunks.push(selectedTaskIds.slice(i, i + 80));
      }
      for (const cols of selects) {
        const collected: RecRow[] = [];
        let anyOk = false;
        for (const chunk of idChunks) {
          const { data: recs, error: rErr } = await service
            .from("recordings")
            .select(cols)
            .in("task_id", chunk)
            .order("take_number", { ascending: false });
          if (rErr) {
            diagnostics.push(`recordings by task_id failed: ${rErr.message}`);
            continue;
          }
          anyOk = true;
          collected.push(...(((recs as unknown) as RecRow[]) ?? []));
        }
        if (anyOk) {
          recordings = collected;
          loaded = true;
          diagnostics.push(`recordings_by_task_id=${recordings.length}`);
          break;
        }
      }
    }

    if ((!loaded || recordings.length === 0) && allTasks.length > 0) {
      const allIds = allTasks.map((t) => t.id);
      for (const cols of selects) {
        const { data: recs, error: rErr } = await service
          .from("recordings")
          .select(cols)
          .in("task_id", allIds.slice(0, 100))
          .order("take_number", { ascending: false });
        if (!rErr && recs) {
          recordings = (recs as unknown as RecRow[]) ?? [];
          loaded = true;
          diagnostics.push(`recordings_by_all_task_ids=${recordings.length}`);
          break;
        }
        if (rErr) diagnostics.push(`recordings all-task fallback: ${rErr.message}`);
      }
    }

    if (!loaded) {
      diagnostics.push("Could not load any recordings for active plan tasks");
    }
  } else {
    diagnostics.push("No active/selected plan tasks");
  }

  // Match against the expanded selectedTaskIds set (active plan + completed plan tasks),
  // not a second recomputation of activePlanTaskIds that could drop completed rows.
  const selectedIdSet = new Set(selectedTaskIds);
  const planRecordings = recordings.filter(
    (r) => Boolean(r.task_id) && selectedIdSet.has(r.task_id as string)
  );
  diagnostics.push(`plan_recordings_matched=${planRecordings.length}`);
  const onePerTask = oneTakePerTask(
    planRecordings.map((r) => ({
      ...r,
      task_id: r.task_id,
      is_selected: r.is_selected,
    }))
  ) as RecRow[];

  const byTask = new Map<string, RecRow>();
  for (const r of onePerTask) {
    if (r.task_id) byTask.set(r.task_id, r);
  }

  // Recovery: fill any missing task → recording links from the full project set
  // so completed Leads always appear even when active-plan filters under-match.
  if (recordings.length > 0) {
    const knownTaskIds = new Set(allTasks.map((t) => t.id));
    const recovered = oneTakePerTask(
      recordings
        .filter((r) => r.task_id && knownTaskIds.has(r.task_id))
        .map((r) => ({ ...r, task_id: r.task_id, is_selected: r.is_selected }))
    ) as RecRow[];
    let filled = 0;
    for (const r of recovered) {
      if (r.task_id && !byTask.has(r.task_id)) {
        byTask.set(r.task_id, r);
        filled += 1;
      }
    }
    if (filled > 0 || byTask.size === 0) {
      diagnostics.push(`recovery_by_task_id=${byTask.size} filled=${filled}`);
    }
  }

  const matchedTaskIds: string[] = [];
  const unmatchedSelectedTaskIds: string[] = [];
  const layers: Array<Record<string, unknown>> = [];

  // Prefer selected plan tasks; if still no matches, walk completed tasks with recordings.
  const tasksToRender =
    tasks.length > 0
      ? tasks
      : allTasks.filter((t) => {
          const st = (t.status || "").toLowerCase();
          return st === "completed" && t.selected_in_plan !== false && t.active !== false;
        });

  for (const task of tasksToRender) {
    const rec = byTask.get(task.id);
    if (!rec) {
      unmatchedSelectedTaskIds.push(task.id);
      diagnostics.push(`no recording for task ${task.type || task.id}`);
      continue;
    }
    matchedTaskIds.push(task.id);

    const candidates = [
      rec.audio_path,
      rec.original_audio_path,
      rec.original_path,
    ].filter((p): p is string => Boolean(p));

    candidates.sort((a, b) => {
      const score = (p: string) => {
        const l = p.toLowerCase();
        if (l.endsWith(".wav")) return 0;
        if (l.endsWith(".m4a") || l.endsWith(".mp4") || l.endsWith(".mp3")) return 1;
        if (l.endsWith(".webm") || l.endsWith(".ogg")) return 3;
        return 2;
      };
      return score(a) - score(b);
    });

    if (candidates.length === 0) {
      diagnostics.push(`missing audio path for task ${task.type || task.id}`);
      continue;
    }

    let audio_url: string | null = null;
    let usedPath: string | null = null;
    for (const path of candidates) {
      try {
        audio_url = await createSignedDownloadUrl(path, 3600);
        usedPath = path;
        break;
      } catch (e) {
        diagnostics.push(
          `signed url failed for ${path}: ${e instanceof Error ? e.message : "error"}`
        );
      }
    }
    if (!audio_url || !usedPath) {
      diagnostics.push(`no playable url for task ${task.type || task.id}`);
      continue;
    }

    const meta = (rec.metadata || {}) as Record<string, unknown>;
    const offsetFromMeta =
      typeof meta.recording_offset_ms === "number" ? (meta.recording_offset_ms as number) : null;
    const placementFromMeta =
      typeof meta.placement_start_ms === "number" ? (meta.placement_start_ms as number) : null;
    const start_ms = resolvePlacementStartMs({
      sectionStartMs: task.start_ms,
      recordingOffsetMs:
        typeof rec.recording_offset_ms === "number" ? rec.recording_offset_ms : offsetFromMeta,
      timelineStartMs: rec.timeline_start_ms,
      placementStartMs: placementFromMeta,
    });
    const end_ms =
      typeof rec.timeline_end_ms === "number"
        ? rec.timeline_end_ms
        : task.end_ms != null
          ? task.end_ms
          : start_ms + (rec.duration_ms || 0);

    const taskMeta = (task.metadata || {}) as {
      section_label?: string;
      start_bar?: number | null;
      end_bar?: number | null;
      production_type?: string;
    };
    layers.push({
      task_id: task.id,
      recording_id: rec.id,
      type: task.type,
      title: task.title,
      section_id:
        (task as { section_id?: string | null }).section_id ??
        ((task.metadata as { section_id?: string } | null | undefined)?.section_id ?? null),
      section_label: taskMeta.section_label ?? task.metadata?.section_label ?? null,
      start_ms,
      end_ms,
      start_bar: taskMeta.start_bar ?? null,
      end_bar: taskMeta.end_bar ?? null,
      layer_role: taskMeta.production_type || task.type || null,
      take_number: rec.take_number,
      duration_ms: rec.duration_ms,
      audio_url,
      audio_path: usedPath,
      is_selected: Boolean(rec.is_selected),
    });
  }

  const payload = {
    project_id: projectId,
    title: project.title,
    beat_url,
    beat_duration_ms: beat?.duration_ms ?? null,
    bpm: beat?.bpm ?? null,
    layers,
    layer_count: layers.length,
    vocal_layer_count: layers.length,
    selected_task_ids: selectedTaskIds,
    matched_task_ids: matchedTaskIds,
    unmatched_selected_task_ids: unmatchedSelectedTaskIds,
    diagnostics: diagnostics.slice(0, 20),
  };

  console.info("[session-preview]", {
    projectId,
    selectedTaskIds,
    matchedTaskIds,
    unmatchedSelectedTaskIds,
    vocalLayerCount: layers.length,
    placementStartMs: layers.map((l) => l.start_ms),
  });

  if (layers.length === 0 && selectedTaskIds.length > 0) {
    console.warn("session-preview empty layers despite active tasks", {
      projectId,
      diagnostics,
      selectedTaskIds,
    });
  }

  return NextResponse.json(payload);
}
