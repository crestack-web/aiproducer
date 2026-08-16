import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import type { PlanMode } from "@/lib/plan";

type Ctx = { params: Promise<{ id: string }> };

async function assertOwned(
  supabase: Awaited<ReturnType<typeof requireUser>>["supabase"],
  projectId: string,
  userId: string
) {
  const { data } = await supabase
    .from("projects")
    .select("id, metadata, status")
    .eq("id", projectId)
    .eq("user_id", userId)
    .maybeSingle();
  return data;
}

/** GET — AI plan snapshot + artist plan (all tasks including inactive). */
export async function GET(_req: Request, ctx: Ctx) {
  const { id: projectId } = await ctx.params;
  const { user, supabase, error } = await requireUser();
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const project = await assertOwned(supabase, projectId, user.id);
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: tasks } = await supabase
    .from("recording_tasks")
    .select("*, song_sections(id, type, label, order_index, start_ms, end_ms, start_bar, end_bar)")
    .eq("project_id", projectId)
    .order("start_ms", { ascending: true });

  const meta = (project.metadata || {}) as Record<string, unknown>;
  return NextResponse.json({
    plan_mode: (meta.plan_mode as PlanMode) || "ai",
    ai_plan: meta.ai_plan || null,
    tasks: tasks || [],
    project_status: project.status,
  });
}

/**
 * PATCH — plan operations:
 * { action: "set_mode", mode: "ai"|"customize"|"scratch" }
 * { action: "select", task_id, selected: boolean }
 * { action: "remove", task_id }  // soft: active=false, selected_in_plan=false
 * { action: "restore", task_id }
 * { action: "update", task_id, patch: { type, title, instruction, start_ms, end_ms, section_id, recommendation } }
 * { action: "add", task: { type, title, instruction, start_ms, end_ms, section_id } }
 * { action: "restore_ai_plan" }  // re-select all tasks from ai snapshot ids still present
 * { action: "clear_to_scratch" } // deselect all; artist builds from scratch
 */
export async function PATCH(req: Request, ctx: Ctx) {
  const { id: projectId } = await ctx.params;
  const { user, supabase, error } = await requireUser();
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const project = await assertOwned(supabase, projectId, user.id);
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action || "");

  const meta = (project.metadata || {}) as Record<string, unknown>;

  if (action === "set_mode") {
    const mode = String(body.mode || "ai") as PlanMode;
    if (!["ai", "customize", "scratch"].includes(mode)) {
      return NextResponse.json({ error: "Invalid mode" }, { status: 400 });
    }
    await supabase
      .from("projects")
      .update({ metadata: { ...meta, plan_mode: mode } })
      .eq("id", projectId);
    return NextResponse.json({ plan_mode: mode });
  }

  if (action === "select") {
    const taskId = String(body.task_id || "");
    const selected = Boolean(body.selected);
    const { data, error: upErr } = await supabase
      .from("recording_tasks")
      .update({
        selected_in_plan: selected,
        active: selected ? true : undefined,
        // re-selecting a removed task reactivates it
        ...(selected ? { active: true } : {}),
      })
      .eq("id", taskId)
      .eq("project_id", projectId)
      .select()
      .maybeSingle();
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: "Task not found" }, { status: 404 });
    return NextResponse.json({ task: data });
  }

  if (action === "remove") {
    const taskId = String(body.task_id || "");
    // Soft-remove: keep row + recordings; drop from active plan
    const { data, error: upErr } = await supabase
      .from("recording_tasks")
      .update({ active: false, selected_in_plan: false })
      .eq("id", taskId)
      .eq("project_id", projectId)
      .select()
      .maybeSingle();
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: "Task not found" }, { status: 404 });
    await supabase
      .from("projects")
      .update({ metadata: { ...meta, plan_mode: meta.plan_mode || "customize" } })
      .eq("id", projectId);
    return NextResponse.json({ task: data });
  }

  if (action === "restore") {
    const taskId = String(body.task_id || "");
    const { data, error: upErr } = await supabase
      .from("recording_tasks")
      .update({ active: true, selected_in_plan: true, plan_source: "restored_ai" })
      .eq("id", taskId)
      .eq("project_id", projectId)
      .select()
      .maybeSingle();
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: "Task not found" }, { status: 404 });
    return NextResponse.json({ task: data });
  }

  if (action === "update") {
    const taskId = String(body.task_id || "");
    const patch = (body.patch || {}) as Record<string, unknown>;
    const allowed: Record<string, unknown> = {};
    for (const key of [
      "type",
      "title",
      "instruction",
      "reason",
      "start_ms",
      "end_ms",
      "section_id",
      "priority",
      "recommendation",
    ]) {
      if (key in patch) allowed[key] = patch[key];
    }
    if (Object.keys(allowed).length === 0) {
      return NextResponse.json({ error: "Empty patch" }, { status: 400 });
    }
    // Merge timeline into metadata
    const { data: existing } = await supabase
      .from("recording_tasks")
      .select("metadata")
      .eq("id", taskId)
      .eq("project_id", projectId)
      .maybeSingle();
    if (existing) {
      const m = (existing.metadata || {}) as Record<string, unknown>;
      if ("start_ms" in allowed) m.timeline_start_ms = allowed.start_ms;
      if ("end_ms" in allowed) m.timeline_end_ms = allowed.end_ms;
      allowed.metadata = m;
    }
    const { data, error: upErr } = await supabase
      .from("recording_tasks")
      .update(allowed)
      .eq("id", taskId)
      .eq("project_id", projectId)
      .select()
      .maybeSingle();
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: "Task not found" }, { status: 404 });
    return NextResponse.json({ task: data });
  }

  if (action === "add") {
    const task = (body.task || {}) as Record<string, unknown>;
    const type = String(task.type || "LEAD");
    const start_ms = typeof task.start_ms === "number" ? task.start_ms : 0;
    const end_ms = typeof task.end_ms === "number" ? task.end_ms : start_ms + 8000;
    const row = {
      project_id: projectId,
      section_id: (task.section_id as string) || null,
      type,
      title: (task.title as string) || type,
      instruction: (task.instruction as string) || `Record your ${type.toLowerCase()} for this section.`,
      reason: (task.reason as string) || "Custom part",
      start_ms,
      end_ms,
      required: false,
      priority: typeof task.priority === "number" ? task.priority : 50,
      status: "pending",
      active: true,
      selected_in_plan: true,
      plan_source: "artist",
      recommendation: "optional",
      metadata: {
        section_label: task.section_label || null,
        production_type: type,
        timeline_start_ms: start_ms,
        timeline_end_ms: end_ms,
        custom: true,
      },
    };
    const { data, error: insErr } = await supabase.from("recording_tasks").insert(row).select().single();
    if (insErr) {
      // Fallback without plan columns
      const { active: _a, selected_in_plan: _s, plan_source: _p, recommendation: _r, ...minimal } = row;
      const retry = await supabase.from("recording_tasks").insert(minimal).select().single();
      if (retry.error) return NextResponse.json({ error: retry.error.message }, { status: 500 });
      return NextResponse.json({ task: retry.data }, { status: 201 });
    }
    await supabase
      .from("projects")
      .update({ metadata: { ...meta, plan_mode: meta.plan_mode === "ai" ? "customize" : meta.plan_mode } })
      .eq("id", projectId);
    return NextResponse.json({ task: data }, { status: 201 });
  }

  if (action === "restore_ai_plan") {
    const ai = meta.ai_plan as { tasks?: { id?: string }[] } | undefined;
    const ids = (ai?.tasks || []).map((t) => t.id).filter(Boolean) as string[];
    if (ids.length) {
      await supabase
        .from("recording_tasks")
        .update({ active: true, selected_in_plan: true, plan_source: "restored_ai" })
        .eq("project_id", projectId)
        .in("id", ids);
    } else {
      // No snapshot: re-select all AI-sourced tasks
      await supabase
        .from("recording_tasks")
        .update({ active: true, selected_in_plan: true })
        .eq("project_id", projectId)
        .in("plan_source", ["ai", "restored_ai"]);
    }
    await supabase
      .from("projects")
      .update({ metadata: { ...meta, plan_mode: "ai" } })
      .eq("id", projectId);
    const { data: tasks } = await supabase
      .from("recording_tasks")
      .select("*")
      .eq("project_id", projectId)
      .order("start_ms", { ascending: true });
    return NextResponse.json({ plan_mode: "ai", tasks: tasks || [] });
  }

  if (action === "clear_to_scratch") {
    await supabase
      .from("recording_tasks")
      .update({ selected_in_plan: false, active: false })
      .eq("project_id", projectId);
    await supabase
      .from("projects")
      .update({ metadata: { ...meta, plan_mode: "scratch" } })
      .eq("id", projectId);
    const { data: tasks } = await supabase
      .from("recording_tasks")
      .select("*")
      .eq("project_id", projectId);
    return NextResponse.json({ plan_mode: "scratch", tasks: tasks || [] });
  }

  return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
}
