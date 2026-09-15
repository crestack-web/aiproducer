import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";

type Ctx = { params: Promise<{ id: string }> };

const PatchSchema = z.object({
  start_ms: z.number().min(0).optional(),
  end_ms: z.number().min(0).optional(),
  /** Soft-delete: mark task skipped/cancelled so guided flow drops it */
  status: z.enum(["completed", "pending", "skipped", "cancelled"]).optional(),
});

/**
 * PATCH recording task timing / status.
 * Producer View Phase 2 — writes back to the same recording_tasks row
 * the guided booth uses (single source of truth).
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
    .select("id, project_id, start_ms, end_ms, status, type")
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

  if (patch.start_ms != null && patch.end_ms != null && (patch.end_ms as number) <= (patch.start_ms as number)) {
    return NextResponse.json({ error: "end_ms must be after start_ms" }, { status: 400 });
  }
  // If only one bound sent, validate against existing
  const nextStart = (patch.start_ms as number | undefined) ?? task.start_ms ?? 0;
  const nextEnd = (patch.end_ms as number | undefined) ?? task.end_ms ?? nextStart + 1000;
  if (nextEnd <= nextStart) {
    return NextResponse.json({ error: "end_ms must be after start_ms" }, { status: 400 });
  }

  const { data: updated, error: upErr } = await service
    .from("recording_tasks")
    .update(patch)
    .eq("id", id)
    .select("id, start_ms, end_ms, status, type, title")
    .single();

  if (upErr) {
    console.error("[recording-tasks PATCH]", upErr);
    return NextResponse.json({ error: "Could not update task" }, { status: 500 });
  }

  return NextResponse.json({ task: updated });
}
