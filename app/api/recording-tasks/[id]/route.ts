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
  pan: z.number().min(-1).max(1).optional(),
});

const ConsoleClipSchema = z.object({
  id: z.string().min(1),
  start_ms: z.number().min(0),
  end_ms: z.number().min(0),
  recording_id: z.string().nullable().optional(),
});

const PatchSchema = z.object({
  start_ms: z.number().min(0).optional(),
  end_ms: z.number().min(0).optional(),
  status: z.enum(["completed", "pending", "skipped", "cancelled"]).optional(),
  /** Display name in Console — optional custom track title */
  title: z.string().trim().min(1).max(80).optional(),
  track_fx: TrackFxSchema.optional(),
  track_color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  /** DAW split regions on this track (same lane, multiple clips) */
  console_clips: z.array(ConsoleClipSchema).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

function asFxObject(v: unknown): Record<string, unknown> {
  if (v && typeof v === "object" && !Array.isArray(v)) return { ...(v as Record<string, unknown>) };
  return {};
}

/**
 * PATCH recording task timing / status / track_fx / track_color.
 * Canonical FX + color live on recording_tasks.track_fx and track_color columns.
 * metadata.* is dual-written for legacy readers only.
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
  type TaskRow = {
    id: string;
    project_id: string;
    start_ms: number | null;
    end_ms: number | null;
    status: string | null;
    type: string | null;
    metadata: unknown;
    track_fx?: unknown;
    track_color?: string | null;
  };
  let task: TaskRow | null = null;

  {
    const res = await service
      .from("recording_tasks")
      .select("id, project_id, start_ms, end_ms, status, type, metadata, track_fx, track_color")
      .eq("id", id)
      .maybeSingle();
    if (!res.error && res.data) {
      task = res.data as TaskRow;
    } else {
      const fallback = await service
        .from("recording_tasks")
        .select("id, project_id, start_ms, end_ms, status, type, metadata")
        .eq("id", id)
        .maybeSingle();
      if (fallback.error || !fallback.data) {
        return NextResponse.json({ error: "Task not found" }, { status: 404 });
      }
      task = fallback.data as TaskRow;
    }
  }

  if (!task) {
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
  if (parsed.data.title !== undefined) patch.title = parsed.data.title;

  const prevMeta =
    task.metadata && typeof task.metadata === "object" && !Array.isArray(task.metadata)
      ? ({ ...(task.metadata as Record<string, unknown>) } as Record<string, unknown>)
      : ({} as Record<string, unknown>);

  if (parsed.data.track_fx) {
    const base = asFxObject(task.track_fx != null ? task.track_fx : prevMeta.track_fx);
    const merged = { ...base, ...parsed.data.track_fx };
    patch.track_fx = merged;
    prevMeta.track_fx = merged;
    prevMeta.track_fx_source = "producer_view";
    prevMeta.track_fx_updated_at = new Date().toISOString();
    patch.metadata = prevMeta;
  }

  if (parsed.data.track_color) {
    patch.track_color = parsed.data.track_color;
    prevMeta.track_color = parsed.data.track_color;
    patch.metadata = prevMeta;
  }

  if (parsed.data.console_clips) {
    prevMeta.console_clips = parsed.data.console_clips;
    patch.metadata = prevMeta;
  }
  if (parsed.data.metadata && typeof parsed.data.metadata === "object") {
    Object.assign(prevMeta, parsed.data.metadata);
    patch.metadata = prevMeta;
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
      .select("id, start_ms, end_ms, status, type, title, metadata, track_fx, track_color")
      .single();
    updated = res.data as Record<string, unknown> | null;
    upErr = res.error;
  }

  if (upErr && (parsed.data.track_fx || parsed.data.track_color)) {
    const metaOnly: Record<string, unknown> = {};
    if (parsed.data.start_ms !== undefined) metaOnly.start_ms = Math.round(parsed.data.start_ms);
    if (parsed.data.end_ms !== undefined) metaOnly.end_ms = Math.round(parsed.data.end_ms);
    if (parsed.data.status !== undefined) metaOnly.status = parsed.data.status;
    if (parsed.data.title !== undefined) metaOnly.title = parsed.data.title;
    if (patch.metadata) metaOnly.metadata = patch.metadata;
    if (Object.keys(metaOnly).length) {
      const res2 = await service
        .from("recording_tasks")
        .update(metaOnly)
        .eq("id", id)
        .select("id, start_ms, end_ms, status, type, title, metadata")
        .single();
      if (!res2.error) {
        return NextResponse.json({
          task: res2.data,
          warning:
            "track_fx/track_color columns unavailable — persisted on metadata only until migration is applied",
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

  // Console free-move: keep recording placement in sync with the clip position.
  // session-preview / Produce resolve placement from the recording row first; if we
  // only update task.start_ms the clip snaps back to 0 (or the original section).
  if (parsed.data.start_ms !== undefined || parsed.data.end_ms !== undefined) {
    try {
      await syncRecordingPlacementForTask(service, id, nextStart, nextEnd);
    } catch (e) {
      console.error("[recording-tasks PATCH] placement sync", e);
    }
  }

  // Per-clip placements after a DAW split (same track, multiple recordings)
  if (parsed.data.console_clips && parsed.data.console_clips.length > 0) {
    for (const clip of parsed.data.console_clips) {
      const rid = clip.recording_id;
      if (!rid) continue;
      try {
        await syncRecordingPlacementById(service, rid, clip.start_ms, clip.end_ms);
      } catch (e) {
        console.error("[recording-tasks PATCH] clip placement", rid, e);
      }
    }
  }

  return NextResponse.json({ task: updated });
}

/**
 * Artist dragged a clip on the Console timeline → vocal file sample 0 maps to startMs.
 * Zero the capture offset so resolvePlacementStartMs returns the new song position.
 */
async function syncRecordingPlacementForTask(
  service: ReturnType<typeof createServiceClient>,
  taskId: string,
  startMs: number,
  endMs: number
) {
  type RecRow = { id: string; metadata?: unknown; is_selected?: boolean | null };
  const selects = [
    "id, metadata, is_selected",
    "id, metadata",
    "id",
  ];
  let recs: RecRow[] = [];
  for (const cols of selects) {
    const { data, error } = await service
      .from("recordings")
      .select(cols)
      .eq("task_id", taskId)
      .order("take_number", { ascending: false });
    if (!error && Array.isArray(data) && data.length) {
      const parsed: RecRow[] = [];
      for (const row of data as unknown[]) {
        if (!row || typeof row !== "object") continue;
        const r = row as Record<string, unknown>;
        const id = typeof r.id === "string" ? r.id : null;
        if (!id) continue;
        parsed.push({
          id,
          metadata: r.metadata,
          is_selected: typeof r.is_selected === "boolean" ? r.is_selected : null,
        });
      }
      if (parsed.length) {
        recs = parsed;
        break;
      }
    }
  }
  if (!recs.length) return;

  const target =
    recs.find((r) => r.is_selected === true) ||
    recs[0];
  if (!target?.id) return;

  const prevMeta =
    target.metadata && typeof target.metadata === "object" && !Array.isArray(target.metadata)
      ? { ...(target.metadata as Record<string, unknown>) }
      : {};
  prevMeta.placement_start_ms = startMs;
  prevMeta.recording_offset_ms = 0;
  prevMeta.console_placed = true;
  prevMeta.console_placed_at = new Date().toISOString();

  const attempts: Record<string, unknown>[] = [
    {
      timeline_start_ms: startMs,
      timeline_end_ms: endMs,
      recording_offset_ms: 0,
      metadata: prevMeta,
    },
    {
      timeline_start_ms: startMs,
      timeline_end_ms: endMs,
      metadata: prevMeta,
    },
    { metadata: prevMeta },
  ];
  for (const patch of attempts) {
    const { error } = await service.from("recordings").update(patch).eq("id", target.id);
    if (!error) return;
  }
}
