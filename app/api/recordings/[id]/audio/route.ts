import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { downloadStorageObject } from "@/lib/storage";
import { createServiceClient } from "@/lib/supabase/server";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/recordings/:id/audio
 * Same-origin stream for a specific take (split clips, non-selected halves).
 * Console waveforms + playback must not depend on short-lived signed R2 URLs alone.
 */
export async function GET(_req: Request, ctx: Ctx) {
  const { id: recordingId } = await ctx.params;
  const { user, supabase, error } = await requireUser();
  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const service = createServiceClient();
  const { data: rec } = await service
    .from("recordings")
    .select("id, task_id, audio_path, original_audio_path, project_id")
    .eq("id", recordingId)
    .maybeSingle();

  if (!rec) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let projectId = (rec as { project_id?: string | null }).project_id || null;
  if (!projectId && rec.task_id) {
    const { data: task } = await service
      .from("recording_tasks")
      .select("project_id")
      .eq("id", rec.task_id)
      .maybeSingle();
    projectId = task?.project_id || null;
  }
  if (!projectId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
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

  const path =
    rec.audio_path ||
    (rec as { original_audio_path?: string | null }).original_audio_path ||
    null;
  if (!path) {
    return NextResponse.json({ error: "No audio on this recording" }, { status: 404 });
  }

  let buf: Buffer;
  try {
    buf = await downloadStorageObject(path);
  } catch (e) {
    console.error("[recordings/audio]", recordingId, e);
    return NextResponse.json({ error: "Could not load audio" }, { status: 502 });
  }

  const lower = path.toLowerCase();
  const type = lower.endsWith(".wav")
    ? "audio/wav"
    : lower.endsWith(".mp3")
      ? "audio/mpeg"
      : lower.endsWith(".m4a") || lower.endsWith(".mp4")
        ? "audio/mp4"
        : "application/octet-stream";

  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": type,
      "Cache-Control": "private, max-age=120",
      "Content-Length": String(buf.byteLength),
    },
  });
}
