import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { downloadStorageObject } from "@/lib/storage";
import { createServiceClient } from "@/lib/supabase/server";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/projects/:id/beat/download
 * Streams the beat as an attachment so mobile browsers download instead of opening a player.
 */
export async function GET(_req: Request, ctx: Ctx) {
  const { id: projectId } = await ctx.params;
  const { user, supabase, error } = await requireUser();
  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: project } = await supabase
    .from("projects")
    .select("id, title")
    .eq("id", projectId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const service = createServiceClient();
  const { data: beat } = await service
    .from("beats")
    .select("audio_path, metadata, source")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!beat?.audio_path) {
    return NextResponse.json({ error: "No beat file" }, { status: 404 });
  }

  let buf: Buffer;
  try {
    buf = await downloadStorageObject(beat.audio_path);
  } catch (e) {
    console.error("[beat-download]", e);
    return NextResponse.json({ error: "Could not read beat file" }, { status: 500 });
  }

  const path = String(beat.audio_path);
  const extMatch = path.match(/\.([a-z0-9]+)$/i);
  const ext = (extMatch?.[1] || "mp3").toLowerCase();
  const contentType =
    ext === "wav"
      ? "audio/wav"
      : ext === "m4a"
        ? "audio/mp4"
        : ext === "ogg"
          ? "audio/ogg"
          : "audio/mpeg";

  const safeTitle = String(project.title || "beat")
    .replace(/[^\w\-]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 48)
    .replace(/^-|-$/g, "") || "beat";
  const filename = `${safeTitle}.${ext === "mpeg" ? "mp3" : ext}`;

  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(buf.length),
      "Cache-Control": "private, no-store",
    },
  });
}
