import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/projects/:id/status — project + latest job snapshot */
export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const { user, supabase, error } = await requireUser();
  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: project, error: pErr } = await supabase
    .from("projects")
    .select("id, status, title, genre, mood, tempo, prompt, updated_at")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (pErr || !project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data: jobs } = await supabase
    .from("jobs")
    .select("id, type, status, progress, stage, error, created_at, completed_at")
    .eq("project_id", id)
    .order("created_at", { ascending: false })
    .limit(5);

  return NextResponse.json({
    project,
    jobs: jobs ?? [],
  });
}
