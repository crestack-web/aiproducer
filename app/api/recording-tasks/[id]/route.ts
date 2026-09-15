import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";

type Ctx = { params: Promise<{ id: string }> };

/** Phase 4 — per-track monitor/production FX (decision-map compatible) */
const TrackFxSchema = z.object({
  gainDb: z.number().min(-24).max(24).optional(),
  eqLowDb: z.number().min(-12).max(12).optional(),
  eqMidDb: z.number().min(-12).max(12).optional(),
  eqHighDb: z.number().min(-12).max(12).optional(),
  compress: z.number().min(0).max(1).optional(),
  reverb: z.number().min(0).max(1).optional(),
  delay: z.number().min(0).max(1).optional(),
  saturation: z.number().min(0).max(1).optional(),
});

const PatchSchema = z.object({
  start_ms: z.number().min(0).optional(),
  end_ms: z.number().min(0).optional(),
  status: z.enum(["completed", "pending", "skipped", "cancelled"]).optional(),
  track_fx: TrackFxSchema.optional(),
});

/**
 * PATCH recording task timing / status / track_fx.
 * Producer View Phase 2–4 — single source of truth on recording_tasks.
 */
export async function PATCH(req: Request, ctx: Ctx) {
  const { user, error } = await requireUser();
  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const service = createServiceClient();
  const { data: task, error: loadErr } = await service
    .from("recording_tasks")
    .select("id, project_id, start_ms, end_ms, status, type, metadata")
    .eq("id", id)
    .maybeSingle();

  if (loadErr || !task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  const { data: project } = await service
    .from("projects")
    .select("id, user_id")
    .eq("id", task.project_id)
    .maybeSingle();

  if (!project || project.user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const patch: Record<string, unknown> = {};
  if (parsed.data.start_ms !== undefined) patch.start_ms = Math.round(parsed.data.start_ms);
  if (parsed.data.end_ms !== undefined) patch.end_ms = Math.round(parsed.data.end_ms);
  if (parsed.data.status !== undefined) patch.status = parsed.data.status;

  if (parsed.data.track_fx) {
    const prevMeta =
      task.metadata && typeof task.metadata === "object" && !Array.isArray(task.metadata)
        ? (task.metadata as Record<string, unknown>)
        : {};
    const prevFx =
      prevMeta.track_fx && typeof prevMeta.track_fx === "object"
        ? (prevMeta.track_fx as Record<string, unknown>)
        : {};
    patch.metadata = {
      ...prevMeta,
      track_fx: { ...prevFx, ...parsed.data.track_fx },
      track_fx_source: "producer_view",
      track_fx_updated_at: new Date().toISOString(),
    };
  }

  if (patch.start_ms != null && patch.end_ms != null && (patch.end_ms as number) <= (patch.start_ms as number)) {
    return NextResponse.json({ error: "end_ms must be after start_ms" }, { status: 400 });
  }
  const nextStart = (patch.start_ms as number | undefined) ?? task.start_ms ?? 0;
  const nextEnd = (patch.end_ms as number | undefined) ?? task.end_ms ?? nextStart + 1000;
  if (nextEnd <= nextStart) {
    return NextResponse.json({ error: "end_ms must be after start_ms" }, { status: 400 });
  }

  let updated: Record<string, unknown> | null = null;
  let upErr: { message?: string; code?: string } | null = null;
  {
    const res = await service
      .from("recording_tasks")
      .update(patch)
      .eq("id", id)
      .select("id, start_ms, end_ms, status, type, title, metadata")
      .single();
    updated = res.data as Record<string, unknown> | null;
    upErr = res.error;
  }
  // If metadata column missing, retry without it
  if (upErr && parsed.data.track_fx) {
    const { track_fx: _tf, ...rest } = parsed.data;
    const timingOnly: Record<string, unknown> = {};
    if (rest.start_ms !== undefined) timingOnly.start_ms = Math.round(rest.start_ms);
    if (rest.end_ms !== undefined) timingOnly.end_ms = Math.round(rest.end_ms);
    if (rest.status !== undefined) timingOnly.status = rest.status;
    if (Object.keys(timingOnly).length) {
      const res2 = await service
        .from("recording_tasks")
        .update(timingOnly)
        .eq("id", id)
        .select("id, start_ms, end_ms, status, type, title")
        .single();
      if (!res2.error) {
        return NextResponse.json({
          task: res2.data,
          warning: "track_fx not persisted (metadata column unavailable)",
        });
      }
    }
    console.error("[recording-tasks PATCH]", upErr);
    return NextResponse.json({ error: "Could not update task" }, { status: 500 });
  }
  if (upErr) {
    console.error("[recording-tasks PATCH]", upErr);
    return NextResponse.json({ error: "Could not update task" }, { status: 500 });
  }

  return NextResponse.json({ task: updated });
}
