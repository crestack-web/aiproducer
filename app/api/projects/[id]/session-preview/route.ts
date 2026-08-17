import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createSignedDownloadUrl } from "@/lib/storage";
import { resolvePlacementStartMs } from "@/lib/audio/session-timeline";

type Ctx = { params: Promise<{ id: string }> };

type RecRow = {
  id: string;
  task_id: string;
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
};

/**
 * GET /api/projects/:id/session-preview
 * Beat + selected vocal takes so the artist can hear "what I have so far"
 * before Produce.
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

  const { data: tasksRaw, error: tErr } = await supabase
    .from("recording_tasks")
    .select(
      "id, type, title, instruction, status, start_ms, end_ms, required, metadata, active, selected_in_plan"
    )
    .eq("project_id", projectId)
    .order("start_ms", { ascending: true });

  if (tErr) {
    console.error("session-preview tasks", tErr);
    return NextResponse.json({ error: "Could not load tasks" }, { status: 500 });
  }

  // Active plan only — same membership rule as Produce (task identity)
  const tasks = (tasksRaw ?? []).filter((t) => {
    if (t.active === false) return false;
    if (t.selected_in_plan === false) return false;
    if (t.status === "skipped") return false;
    return true;
  });
  const taskIds = tasks.map((t) => t.id);

  const diagnostics: string[] = [];
  let recordings: RecRow[] = [];

  if (taskIds.length > 0) {
    // Prefer full column set; fall back if migrations lag (unknown columns break PostgREST selects)
    const selects = [
      "id, task_id, audio_path, original_audio_path, duration_ms, take_number, is_selected, timeline_start_ms, timeline_end_ms, recording_offset_ms, metadata",
      "id, task_id, audio_path, original_audio_path, duration_ms, take_number, is_selected, timeline_start_ms, timeline_end_ms, metadata",
      "id, task_id, audio_path, duration_ms, take_number, is_selected, timeline_start_ms, metadata",
      "id, task_id, audio_path, duration_ms, take_number, is_selected, metadata",
      "id, task_id, audio_path, duration_ms, take_number, is_selected",
    ];

    let loaded = false;
    for (const cols of selects) {
      const { data: recs, error: rErr } = await supabase
        .from("recordings")
        .select(cols)
        .eq("project_id", projectId)
        .in("task_id", taskIds)
        .order("take_number", { ascending: false });

      if (rErr) {
        diagnostics.push(`recordings select failed (${cols.split(",")[0]}…): ${rErr.message}`);
        continue;
      }
      recordings = ((recs as unknown) as RecRow[]) ?? [];
      loaded = true;
      break;
    }

    if (!loaded) {
      diagnostics.push("Could not load any recordings for active plan tasks");
    } else {
      diagnostics.push(`recordings_rows=${recordings.length} active_tasks=${taskIds.length}`);
    }
  } else {
    diagnostics.push("No active/selected plan tasks");
  }

  // Prefer selected take per task; else latest take (query ordered take_number desc)
  const byTask = new Map<string, RecRow>();
  for (const r of recordings) {
    const existing = byTask.get(r.task_id);
    if (!existing) {
      byTask.set(r.task_id, r);
      continue;
    }
    if (r.is_selected && !existing.is_selected) {
      byTask.set(r.task_id, r);
    }
  }

  const layers = [];
  for (const task of tasks) {
    const rec = byTask.get(task.id);
    if (!rec) {
      diagnostics.push(`no recording for task ${task.type || task.id}`);
      continue;
    }

    // Prefer WAV-looking paths for browser playback (Safari cannot play many webm takes)
    const candidates = [
      rec.audio_path,
      rec.original_audio_path,
      rec.original_path,
    ].filter((p): p is string => Boolean(p));

    candidates.sort((a, b) => {
      const score = (p: string) =>
        p.toLowerCase().endsWith(".wav")
          ? 0
          : p.toLowerCase().endsWith(".mp3") || p.toLowerCase().endsWith(".m4a")
            ? 1
            : 2;
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
    if (!audio_url || !usedPath) continue;

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

    layers.push({
      task_id: task.id,
      recording_id: rec.id,
      type: task.type,
      title: task.title,
      section_label:
        (task.metadata as { section_label?: string } | null)?.section_label ?? null,
      start_ms,
      end_ms,
      take_number: rec.take_number,
      duration_ms: rec.duration_ms,
      audio_url,
      audio_path: usedPath,
      is_selected: Boolean(rec.is_selected),
    });
  }

  if (layers.length === 0) {
    console.warn("session-preview empty layers", { projectId, diagnostics });
  }

  return NextResponse.json({
    project_id: projectId,
    title: project.title,
    beat_url,
    beat_duration_ms: beat?.duration_ms ?? null,
    bpm: beat?.bpm ?? null,
    layers,
    layer_count: layers.length,
    diagnostics: diagnostics.slice(0, 12),
  });
}
