import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { downloadStorageObject } from "@/lib/storage";
import { createServiceClient } from "@/lib/supabase/server";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/recording-tasks/:id/audio
 * Same-origin stream of the selected take for Console waveform decode + playback fallback.
 * Avoids browser CORS failures on signed R2 URLs (beats already use /beat/download).
 */
export async function GET(_req: Request, ctx: Ctx) {
  const { id: taskId } = await ctx.params;
  const { user, supabase, error } = await requireUser();
  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const service = createServiceClient();
  const { data: task } = await service
    .from("recording_tasks")
    .select("id, project_id")
    .eq("id", taskId)
    .maybeSingle();

  if (!task?.project_id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", task.project_id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Prefer selected take, else latest
  let rec: {
    audio_path: string | null;
    original_audio_path?: string | null;
  } | null = null;

  {
    const { data } = await service
      .from("recordings")
      .select("audio_path, original_audio_path, is_selected, take_number")
      .eq("task_id", taskId)
      .eq("is_selected", true)
      .order("take_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    rec = data;
  }
  if (!rec?.audio_path) {
    const { data } = await service
      .from("recordings")
      .select("audio_path, original_audio_path, take_number")
      .eq("task_id", taskId)
      .order("take_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    rec = data;
  }

  const path =
    rec?.audio_path ||
    (rec as { original_audio_path?: string | null } | null)?.original_audio_path ||
    null;
  if (!path) {
    return NextResponse.json({ error: "No audio on this track" }, { status: 404 });
  }

  let buf: Buffer;
  try {
    buf = await downloadStorageObject(path);
  } catch (e) {
    console.error("[task-audio]", taskId, e);
    return NextResponse.json({ error: "Could not read audio" }, { status: 502 });
  }

  const lower = path.toLowerCase();
  const contentType = lower.endsWith(".wav")
    ? "audio/wav"
    : lower.endsWith(".mp3")
      ? "audio/mpeg"
      : lower.endsWith(".m4a") || lower.endsWith(".mp4")
        ? "audio/mp4"
        : lower.endsWith(".webm")
          ? "audio/webm"
          : lower.endsWith(".ogg")
            ? "audio/ogg"
            : "application/octet-stream";

  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(buf.byteLength),
      "Cache-Control": "private, max-age=120",
      // Inline so Web Audio fetchDecode can use it (not forced download)
      "Content-Disposition": `inline; filename="take-${taskId.slice(0, 8)}"`,
    },
  });
}
