import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/projects/:id/recording-tasks — ordered list for Producer Session */
export async function GET(_req: Request, ctx: Ctx) {
  const { id: projectId } = await ctx.params;
  const { user, supabase, error } = await requireUser();
  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const url = new URL(_req.url);
  const includeInactive = url.searchParams.get("all") === "1";

  let q = supabase
    .from("recording_tasks")
    .select("*, song_sections(id, type, label, order_index, start_ms, end_ms, start_bar, end_bar)")
    .eq("project_id", projectId)
    .order("start_ms", { ascending: true });

  // Session/recording UI: only active + selected plan tasks
  if (!includeInactive) {
    q = q.or("active.is.null,active.eq.true");
  }

  const { data: tasks, error: tErr } = await q;

  if (tErr) {
    console.error(tErr);
    return NextResponse.json({ error: "Could not load tasks" }, { status: 500 });
  }

  let list = tasks ?? [];
  if (!includeInactive) {
    list = list.filter((t) => t.selected_in_plan !== false);
  }

  const ordered = [...list].sort((a, b) => {
    const ts = (a.start_ms ?? 0) - (b.start_ms ?? 0);
    if (ts !== 0) return ts;
    // AI-recommended first (legacy required or recommendation field)
    const ar = a.recommendation === "recommended" || a.required ? 0 : 1;
    const br = b.recommendation === "recommended" || b.required ? 0 : 1;
    if (ar !== br) return ar - br;
    return (b.priority ?? 0) - (a.priority ?? 0);
  });

  return NextResponse.json({ tasks: ordered });
}

const CreateTrackSchema = z.object({
  type: z
    .enum([
      "lead",
      "double",
      "harmony",
      "harmony_high",
      "harmony_mid",
      "harmony_low",
      "adlib",
      "background",
      "custom",
    ])
    .default("custom"),
  title: z.string().min(1).max(80).optional(),
  start_ms: z.number().min(0).default(0),
  end_ms: z.number().min(0).optional(),
  instruction: z.string().max(500).optional(),
});

/**
 * POST /api/projects/:id/recording-tasks
 * Phase 3 — artist-created track (upload / extra layer).
 * Same recording_tasks table as AI plan / booth.
 */
export async function POST(req: Request, ctx: Ctx) {
  const { id: projectId } = await ctx.params;
  const { user, supabase, error } = await requireUser();
  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: project } = await supabase
    .from("projects")
    .select("id, user_id")
    .eq("id", projectId)
    .maybeSingle();
  if (!project || project.user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = CreateTrackSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const start = Math.round(parsed.data.start_ms);
  const end = Math.round(parsed.data.end_ms ?? start + 8000);
  if (end <= start) {
    return NextResponse.json({ error: "end_ms must be after start_ms" }, { status: 400 });
  }

  const type = parsed.data.type;
  const title =
    parsed.data.title ||
    (type === "custom" ? "Custom track" : type.replace(/_/g, " "));

  const row: Record<string, unknown> = {
    project_id: projectId,
    type,
    title,
    instruction:
      parsed.data.instruction ||
      "Artist-added track from Console. Upload or record a take for this layer.",
    status: "pending",
    required: false,
    recommendation: "optional",
    selected_in_plan: true,
    active: false,
    start_ms: start,
    end_ms: end,
    priority: 0,
  };

  // Schema-resilient insert
  let data: Record<string, unknown> | null = null;
  let dbError: { message?: string } | null = null;
  {
    const res = await supabase.from("recording_tasks").insert(row).select("*").single();
    data = res.data as Record<string, unknown> | null;
    dbError = res.error;
  }
  if (dbError) {
    // Retry without optional columns some schemas lack
    const slim = {
      project_id: projectId,
      type,
      title,
      instruction: row.instruction,
      status: "pending",
      required: false,
      start_ms: start,
      end_ms: end,
    };
    const res2 = await supabase.from("recording_tasks").insert(slim).select("*").single();
    data = res2.data as Record<string, unknown> | null;
    dbError = res2.error;
  }
  if (dbError || !data) {
    console.error("[custom-track create]", dbError);
    return NextResponse.json({ error: "Could not create track" }, { status: 500 });
  }

  return NextResponse.json({ task: data }, { status: 201 });
}
