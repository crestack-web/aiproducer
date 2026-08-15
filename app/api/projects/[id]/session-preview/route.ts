import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createSignedDownloadUrl } from "@/lib/storage";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/projects/:id/session-preview
 * Beat + selected vocal takes so the artist can hear "what I have so far"
 * during the producer recording session (before full mix/master).
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

  const { data: tasks, error: tErr } = await supabase
    .from("recording_tasks")
    .select("id, type, title, instruction, status, start_ms, end_ms, required, metadata")
    .eq("project_id", projectId)
    .order("start_ms", { ascending: true });

  if (tErr) {
    console.error("session-preview tasks", tErr);
    return NextResponse.json({ error: "Could not load tasks" }, { status: 500 });
  }

  const taskIds = (tasks ?? []).map((t) => t.id);
  let recordings: Array<{
    id: string;
    task_id: string;
    audio_path: string | null;
    duration_ms: number | null;
    take_number: number | null;
    is_selected: boolean | null;
  }> = [];

  if (taskIds.length > 0) {
    const { data: recs } = await supabase
      .from("recordings")
      .select("id, task_id, audio_path, duration_ms, take_number, is_selected")
      .eq("project_id", projectId)
      .in("task_id", taskIds)
      .order("take_number", { ascending: false });

    recordings = recs ?? [];
  }

  // Prefer selected take per task; else latest take
  const byTask = new Map<string, (typeof recordings)[0]>();
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
  for (const task of tasks ?? []) {
    const rec = byTask.get(task.id);
    if (!rec?.audio_path) continue;

    let audio_url: string | null = null;
    try {
      audio_url = await createSignedDownloadUrl(rec.audio_path, 3600);
    } catch {
      continue;
    }
    if (!audio_url) continue;

    layers.push({
      task_id: task.id,
      type: task.type,
      title: task.title,
      section_label: (task.metadata as { section_label?: string } | null)?.section_label ?? null,
      start_ms: task.start_ms ?? 0,
      end_ms: task.end_ms ?? null,
      take_number: rec.take_number,
      duration_ms: rec.duration_ms,
      audio_url,
      is_selected: Boolean(rec.is_selected),
    });
  }

  return NextResponse.json({
    project_id: projectId,
    title: project.title,
    beat_url,
    beat_duration_ms: beat?.duration_ms ?? null,
    bpm: beat?.bpm ?? null,
    layers,
    layer_count: layers.length,
  });
}
