import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { createSignedDownloadUrl, isStoragePath } from "@/lib/storage";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/projects/:id/beats
 * All beat versions for this project (section reworks, regenerations).
 */
export async function GET(_req: Request, ctx: Ctx) {
  const { id: projectId } = await ctx.params;
  const { user, supabase, error } = await requireUser();
  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: project } = await supabase
    .from("projects")
    .select("id, metadata")
    .eq("id", projectId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const service = createServiceClient();
  const { data: rows, error: bErr } = await service
    .from("beats")
    .select("id, audio_path, duration_ms, tempo, source, status, metadata, created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(24);

  if (bErr) {
    console.error("[beats list]", bErr.message);
    return NextResponse.json({ error: "Could not load beats" }, { status: 500 });
  }

  const meta =
    project.metadata && typeof project.metadata === "object"
      ? (project.metadata as Record<string, unknown>)
      : {};
  const activeId = typeof meta.active_beat_id === "string" ? meta.active_beat_id : null;

  const beats = [];
  for (let i = 0; i < (rows || []).length; i++) {
    const b = rows![i];
    if (!b.audio_path || !isStoragePath(b.audio_path)) continue;
    let audio_url: string | null = null;
    try {
      audio_url = await createSignedDownloadUrl(b.audio_path, 3600);
    } catch {
      continue;
    }
    const bm =
      b.metadata && typeof b.metadata === "object"
        ? (b.metadata as Record<string, unknown>)
        : {};
    const editSection =
      typeof bm.edit_section === "string"
        ? bm.edit_section
        : typeof bm.section_edit === "string"
          ? bm.section_edit
          : null;
    beats.push({
      id: b.id,
      audio_url,
      duration_ms: b.duration_ms,
      tempo: b.tempo,
      source: b.source,
      status: b.status,
      created_at: b.created_at,
      label: editSection
        ? `Rework · ${editSection}`
        : i === 0 && !editSection
          ? "Latest"
          : `Version ${(rows || []).length - i}`,
      edit_section: editSection,
      is_active: activeId ? activeId === b.id : i === 0,
    });
  }

  return NextResponse.json({ beats, active_beat_id: activeId || beats[0]?.id || null });
}

const SelectSchema = z.object({
  select_beat_id: z.string().uuid(),
});

/**
 * POST /api/projects/:id/beats
 * Choose which beat version is active for Booth / Console / Produce.
 */
export async function POST(req: Request, ctx: Ctx) {
  const { id: projectId } = await ctx.params;
  const { user, supabase, error } = await requireUser();
  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = SelectSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "select_beat_id required" }, { status: 400 });
  }

  const { data: project } = await supabase
    .from("projects")
    .select("id, metadata")
    .eq("id", projectId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const service = createServiceClient();
  const { data: beat } = await service
    .from("beats")
    .select("id")
    .eq("id", parsed.data.select_beat_id)
    .eq("project_id", projectId)
    .maybeSingle();
  if (!beat) {
    return NextResponse.json({ error: "Beat not found on this project" }, { status: 404 });
  }

  const prev =
    project.metadata && typeof project.metadata === "object"
      ? (project.metadata as Record<string, unknown>)
      : {};
  const nextMeta = {
    ...prev,
    active_beat_id: beat.id,
    active_beat_selected_at: new Date().toISOString(),
  };
  await service.from("projects").update({ metadata: nextMeta }).eq("id", projectId);

  return NextResponse.json({ ok: true, active_beat_id: beat.id });
}
