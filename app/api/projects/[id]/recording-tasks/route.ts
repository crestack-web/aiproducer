import { NextResponse } from "next/server";
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
