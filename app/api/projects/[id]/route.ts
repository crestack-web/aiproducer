import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/projects/:id */
export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const { user, supabase, error } = await requireUser();
  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error: dbError } = await supabase
    .from("projects")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (dbError) {
    console.error("get project", dbError);
    return NextResponse.json({ error: "Could not load project" }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ project: data });
}
