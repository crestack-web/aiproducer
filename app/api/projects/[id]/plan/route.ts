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


/** Update recording_tasks with schema-resilient plan flags.
 * Production DBs may lack active / selected_in_plan / plan_source columns.
 */
async function updateTaskPlanFlags(
  supabase: Awaited<ReturnType<typeof requireUser>>["supabase"],
  projectId: string,
  taskId: string,
  flags: {
    selected?: boolean;
    active?: boolean;
    plan_source?: string;
  }
) {
  const attempts: Record<string, unknown>[] = [];

  // Preferred: full plan columns
  const full: Record<string, unknown> = {};
  if (flags.selected !== undefined) full.selected_in_plan = flags.selected;
  if (flags.active !== undefined) full.active = flags.active;
  if (flags.plan_source) full.plan_source = flags.plan_source;
  if (Object.keys(full).length) attempts.push(full);

  // No `active` column
  if (flags.selected !== undefined) {
    attempts.push({ selected_in_plan: flags.selected });
  }

  // No plan columns at all — soft-skip via status + metadata
  if (flags.selected === false) {
    attempts.push({ status: "skipped" });
  } else if (flags.selected === true) {
    attempts.push({ status: "pending" });
  }

  let lastErr: { message: string } | null = null;
  for (const patch of attempts) {
    const { data, error } = await supabase
      .from("recording_tasks")
      .update(patch)
      .eq("id", taskId)
      .eq("project_id", projectId)
      .select()
      .maybeSingle();
    if (!error && data) {
      // Normalize response so UI always sees plan flags
      const row = data as Record<string, unknown>;
      if (flags.selected !== undefined && row.selected_in_plan === undefined) {
        row.selected_in_plan = flags.selected;
      }
      if (flags.active !== undefined && row.active === undefined) {
        row.active = flags.active;
      }
      if (flags.selected === false) {
        row.selected_in_plan = false;
        row.active = false;
      }
      if (flags.selected === true) {
        row.selected_in_plan = true;
        row.active = true;
      }
      return { data: row, error: null };
    }
    lastErr = error;
    const msg = (error?.message || "").toLowerCase();
    // Only retry on missing-column schema errors
    if (!/column|schema cache|does not exist|active|selected_in_plan|plan_source/i.test(msg)) {
      break;
    }
  }

  // Last resort: merge flags into metadata so UI can still filter
  const { data: existing } = await supabase
    .from("recording_tasks")
    .select("id, metadata, status")
    .eq("id", taskId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (existing) {
    const m = { ...((existing.metadata || {}) as Record<string, unknown>) };
    if (flags.selected !== undefined) {
      m.selected_in_plan = flags.selected;
      m.active = flags.selected;
    }
    const statusPatch: Record<string, unknown> = { metadata: m };
    if (flags.selected === false) statusPatch.status = "skipped";
    if (flags.selected === true && existing.status === "skipped") statusPatch.status = "pending";
    const { data, error } = await supabase
      .from("recording_tasks")
      .update(statusPatch)
      .eq("id", taskId)
      .eq("project_id", projectId)
      .select()
      .maybeSingle();
    if (!error && data) {
      const row = data as Record<string, unknown>;
      row.selected_in_plan = flags.selected ?? true;
      row.active = flags.selected ?? true;
      return { data: row, error: null };
    }
    lastErr = error || lastErr;
  }

  return { data: null, error: lastErr };
}

async function bulkUpdatePlanFlags(
  supabase: Awaited<ReturnType<typeof requireUser>>["supabase"],
  projectId: string,
  flags: { selected?: boolean; active?: boolean; plan_source?: string },
  filter?: { ids?: string[]; plan_sources?: string[] }
) {
  const patches: Record<string, unknown>[] = [];
  const full: Record<string, unknown> = {};
  if (flags.selected !== undefined) full.selected_in_plan = flags.selected;
  if (flags.active !== undefined) full.active = flags.active;
  if (flags.plan_source) full.plan_source = flags.plan_source;
  patches.push(full);
  if (flags.selected !== undefined) patches.push({ selected_in_plan: flags.selected });
  if (flags.selected === false) patches.push({ status: "skipped" });
  if (flags.selected === true) patches.push({ status: "pending" });

  for (const patch of patches) {
    let q = supabase.from("recording_tasks").update(patch).eq("project_id", projectId);
    if (filter?.ids?.length) q = q.in("id", filter.ids);
    if (filter?.plan_sources?.length) q = q.in("plan_source", filter.plan_sources);
    const { error } = await q;
    if (!error) return null;
    const msg = (error.message || "").toLowerCase();
    if (!/column|schema cache|does not exist|active|selected_in_plan|plan_source/i.test(msg)) {
      return error;
    }
  }
  return null;
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
    const { data, error: upErr } = await updateTaskPlanFlags(supabase, projectId, taskId, {
      selected,
      active: selected,
    });
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: "Task not found" }, { status: 404 });
    return NextResponse.json({ task: data });
  }

  if (action === "remove") {
    const taskId = String(body.task_id || "");
    // Soft-remove: keep row + recordings; drop from active plan
    const { data, error: upErr } = await updateTaskPlanFlags(supabase, projectId, taskId, {
      selected: false,
      active: false,
    });
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
    const { data, error: upErr } = await updateTaskPlanFlags(supabase, projectId, taskId, {
      selected: true,
      active: true,
      plan_source: "restored_ai",
    });
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
    // Coerce timeline fields to integers (ms)
    if ("start_ms" in allowed) {
      const n = Number(allowed.start_ms);
      allowed.start_ms = Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
    }
    if ("end_ms" in allowed) {
      const n = Number(allowed.end_ms);
      allowed.end_ms = Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
    }
    if (
      typeof allowed.start_ms === "number" &&
      typeof allowed.end_ms === "number" &&
      (allowed.end_ms as number) <= (allowed.start_ms as number)
    ) {
      allowed.end_ms = (allowed.start_ms as number) + 1000;
    }
    if (Object.keys(allowed).length === 0) {
      return NextResponse.json({ error: "Empty patch" }, { status: 400 });
    }
    // Merge timeline into metadata (always keep a copy for clients that read metadata)
    const { data: existing } = await supabase
      .from("recording_tasks")
      .select("metadata, section_id, type")
      .eq("id", taskId)
      .eq("project_id", projectId)
      .maybeSingle();
    if (existing) {
      const m = { ...((existing.metadata || {}) as Record<string, unknown>) };
      if ("start_ms" in allowed) m.timeline_start_ms = allowed.start_ms;
      if ("end_ms" in allowed) m.timeline_end_ms = allowed.end_ms;
      allowed.metadata = m;
    }
    let data = null as Record<string, unknown> | null;
    let upErr: { message: string } | null = null;
    {
      const res = await supabase
        .from("recording_tasks")
        .update(allowed)
        .eq("id", taskId)
        .eq("project_id", projectId)
        .select()
        .maybeSingle();
      data = res.data as Record<string, unknown> | null;
      upErr = res.error;
    }
    // Fallback: columns may reject metadata merge
    if (upErr) {
      const { metadata: _m, ...core } = allowed;
      const res2 = await supabase
        .from("recording_tasks")
        .update(core)
        .eq("id", taskId)
        .eq("project_id", projectId)
        .select()
        .maybeSingle();
      if (!res2.error && res2.data) {
        data = res2.data as Record<string, unknown>;
        upErr = null;
      } else {
        upErr = res2.error || upErr;
      }
    }
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: "Task not found" }, { status: 404 });

    // Keep sibling layers on the same section on the same window
    if ("start_ms" in allowed || "end_ms" in allowed) {
      const sectionId = (data.section_id as string | null) || (existing?.section_id as string | null);
      const startMs = (allowed.start_ms as number | undefined) ?? (data.start_ms as number | undefined);
      const endMs = (allowed.end_ms as number | undefined) ?? (data.end_ms as number | undefined);
      if (sectionId && startMs != null && endMs != null) {
        await supabase
          .from("recording_tasks")
          .update({
            start_ms: startMs,
            end_ms: endMs,
          })
          .eq("project_id", projectId)
          .eq("section_id", sectionId)
          .neq("id", taskId);
        // Best-effort: keep song_sections aligned so any section-based UI matches
        await supabase
          .from("song_sections")
          .update({ start_ms: startMs, end_ms: endMs })
          .eq("id", sectionId)
          .eq("project_id", projectId);
      }
    }

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
      await bulkUpdatePlanFlags(
        supabase,
        projectId,
        { selected: true, active: true, plan_source: "restored_ai" },
        { ids }
      );
    } else {
      await bulkUpdatePlanFlags(
        supabase,
        projectId,
        { selected: true, active: true },
        { plan_sources: ["ai", "restored_ai"] }
      );
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
    await bulkUpdatePlanFlags(supabase, projectId, { selected: false, active: false });
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
