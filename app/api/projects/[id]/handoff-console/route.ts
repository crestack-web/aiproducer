import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { isBoothOwned, normalizeEditMode, taskPlanSource } from "@/lib/edit-ownership";

type Ctx = { params: Promise<{ id: string }> };

const BodySchema = z
  .object({
    /** Booth parts to bring over. Defaults to every active Booth part. */
    task_ids: z.array(z.string().min(1)).optional(),
  })
  .optional();

type TaskRow = Record<string, unknown> & {
  id: string;
  status?: string | null;
  active?: boolean | null;
  selected_in_plan?: boolean | null;
  plan_source?: string | null;
  metadata?: unknown;
};

/**
 * POST — one-way hand-off from Booth to Console.
 * Copies the chosen Booth takes to new Console-owned parts and sets
 * projects.edit_mode = 'console'. Booth parts are left untouched (read-only
 * history for "Listen"); the AI plan never edits this song again.
 */
export async function POST(req: Request, ctx: Ctx) {
  const { id: projectId } = await ctx.params;
  const { user, supabase, error } = await requireUser();
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: project } = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (normalizeEditMode((project as { edit_mode?: string | null }).edit_mode) === "console") {
    return NextResponse.json({ edit_mode: "console", already: true, copied: 0 });
  }

  const parsed = BodySchema.safeParse(await req.json().catch(() => undefined));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const chosen = parsed.data?.task_ids?.length ? new Set(parsed.data.task_ids) : null;

  const { data: tasks, error: tErr } = await supabase
    .from("recording_tasks")
    .select("*")
    .eq("project_id", projectId)
    .order("start_ms", { ascending: true });
  if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 });

  const boothParts = ((tasks || []) as TaskRow[]).filter((t) => {
    if (!isBoothOwned(taskPlanSource(t))) return false;
    if (chosen) return chosen.has(t.id);
    const st = String(t.status || "").toLowerCase();
    if (st === "skipped" || st === "cancelled") return false;
    if (t.selected_in_plan === false) return false;
    if (t.active === false && st !== "completed") return false;
    return true;
  });

  const now = new Date().toISOString();
  let copied = 0;
  for (const src of boothParts) {
    const srcMeta =
      src.metadata && typeof src.metadata === "object" && !Array.isArray(src.metadata)
        ? (src.metadata as Record<string, unknown>)
        : {};
    const row: Record<string, unknown> = {
      project_id: projectId,
      section_id: src.section_id ?? null,
      type: src.type || "lead",
      title: src.title || src.type || "Track",
      instruction: src.instruction || "Handed off from Booth.",
      reason: src.reason ?? null,
      status: "pending",
      required: false,
      recommendation: "optional",
      selected_in_plan: true,
      active: true,
      plan_source: "console",
      start_ms: src.start_ms ?? 0,
      end_ms: src.end_ms ?? (Number(src.start_ms) || 0) + 8000,
      priority: src.priority ?? 0,
      track_fx: src.track_fx ?? null,
      track_color: src.track_color ?? null,
      metadata: {
        ...srcMeta,
        plan_source: "console",
        handed_off_from: src.id,
        handed_off_at: now,
      },
    };
    let ins = await supabase.from("recording_tasks").insert(row).select("id").single();
    if (ins.error) {
      // Schema-resilient: older DBs may lack track_fx / track_color columns
      const { track_fx: _f, track_color: _c, ...slim } = row;
      ins = await supabase.from("recording_tasks").insert(slim).select("id").single();
    }
    if (ins.error || !ins.data) {
      console.error("[handoff-console] copy failed", src.id, ins.error?.message);
      return NextResponse.json({ error: "Could not copy Booth parts to Console" }, { status: 500 });
    }
    const newId = (ins.data as { id: string }).id;
    copied += 1;

    // Bring over the chosen take (selected one, else the newest).
    const { data: recs } = await supabase
      .from("recordings")
      .select("*")
      .eq("task_id", src.id)
      .order("created_at", { ascending: false });
    const list = (recs || []) as Record<string, unknown>[];
    const rec = list.find((r) => r.is_selected === true) || list[0];
    if (rec?.audio_path) {
      const copy: Record<string, unknown> = {
        task_id: newId,
        project_id: projectId,
        audio_path: rec.audio_path,
        status: rec.status || "ready",
        is_selected: true,
      };
      if (rec.duration_ms != null) copy.duration_ms = rec.duration_ms;
      if (rec.content_type) copy.content_type = rec.content_type;
      if (rec.metadata) copy.metadata = rec.metadata;
      let recIns = await supabase.from("recordings").insert(copy);
      if (recIns.error) {
        const { is_selected: _s, ...slimRec } = copy;
        recIns = await supabase.from("recordings").insert(slimRec);
      }
      if (!recIns.error) {
        await supabase.from("recording_tasks").update({ status: "completed" }).eq("id", newId);
      } else {
        console.warn("[handoff-console] take copy failed", recIns.error.message);
      }
    }
  }

  const { error: upErr } = await supabase
    .from("projects")
    .update({ edit_mode: "console" })
    .eq("id", projectId);
  if (upErr) {
    return NextResponse.json(
      { error: `Could not switch song to Console: ${upErr.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ edit_mode: "console", copied });
}
