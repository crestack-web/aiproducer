import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createSignedDownloadUrl } from "@/lib/storage";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/projects/:id/beat — latest ready beat + signed play URL */
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

  const { data: beat, error: bErr } = await supabase
    .from("beats")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (bErr) {
    console.error("get beat", bErr);
    return NextResponse.json({ error: "Could not load beat" }, { status: 500 });
  }
  if (!beat) {
    return NextResponse.json({ error: "No beat yet" }, { status: 404 });
  }

  let audio_url: string | null = null;
  if (beat.audio_path) {
    try {
      audio_url = await createSignedDownloadUrl(beat.audio_path, 3600);
    } catch (e) {
      console.error("signed url", e);
    }
  }

  return NextResponse.json({ beat, audio_url });
}
