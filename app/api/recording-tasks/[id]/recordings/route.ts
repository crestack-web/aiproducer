import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createSignedDownloadUrl, createSignedUploadUrl, recordingPath } from "@/lib/storage";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id: taskId } = await ctx.params;
  const { user, supabase, error } = await requireUser();
  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: task } = await supabase
    .from("recording_tasks")
    .select("id, project_id")
    .eq("id", taskId)
    .maybeSingle();

  if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", task.project_id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: recordings, error: rErr } = await supabase
    .from("recordings")
    .select("*")
    .eq("task_id", taskId)
    .order("take_number", { ascending: true });

  if (rErr) return NextResponse.json({ error: "Could not list recordings" }, { status: 500 });

  const withUrls = await Promise.all(
    (recordings ?? []).map(async (r) => {
      let audio_url: string | null = null;
      try {
        audio_url = await createSignedDownloadUrl(r.audio_path, 3600);
      } catch {
        /* ignore */
      }
      return { ...r, audio_url };
    })
  );

  return NextResponse.json({ recordings: withUrls });
}

export async function POST(req: Request, ctx: Ctx) {
  const { id: taskId } = await ctx.params;
  const { user, supabase, error } = await requireUser();
  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: task } = await supabase
    .from("recording_tasks")
    .select("id, project_id, status")
    .eq("id", taskId)
    .maybeSingle();

  if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: project } = await supabase
    .from("projects")
    .select("id, user_id")
    .eq("id", task.project_id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { count } = await supabase
    .from("recordings")
    .select("*", { count: "exact", head: true })
    .eq("task_id", taskId);

  const takeNumber = (count ?? 0) + 1;
  const contentTypeHeader = req.headers.get("content-type") || "";

  if (contentTypeHeader.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file");
    if (!file || !(file instanceof Blob)) {
      return NextResponse.json({ error: "Missing file field" }, { status: 400 });
    }

    const ext = (file.type || "").includes("wav")
      ? "wav"
      : (file.type || "").includes("mpeg") || (file.type || "").includes("mp3")
        ? "mp3"
        : (file.type || "").includes("mp4")
          ? "mp4"
          : "webm";

    const path = recordingPath(user.id, task.project_id, taskId, takeNumber, ext);
    const { createServiceClient } = await import("@/lib/supabase/server");
    const service = createServiceClient();
    const buf = Buffer.from(await file.arrayBuffer());
    const { error: upErr } = await service.storage.from("studio").upload(path, buf, {
      contentType: file.type || "audio/webm",
      upsert: true,
    });
    if (upErr) {
      console.error("upload", upErr);
      return NextResponse.json({ error: "Upload failed" }, { status: 500 });
    }

    const durationMs = Number(form.get("duration_ms") || 0) || null;

    await supabase.from("recordings").update({ is_selected: false }).eq("task_id", taskId);

    const { data: recording, error: insErr } = await supabase
      .from("recordings")
      .insert({
        project_id: task.project_id,
        task_id: taskId,
        audio_path: path,
        original_path: path,
        duration_ms: durationMs,
        take_number: takeNumber,
        status: "uploaded",
        is_selected: true,
      })
      .select()
      .single();

    if (insErr) {
      const { data: fallback, error: fbErr } = await supabase
        .from("recordings")
        .insert({
          project_id: task.project_id,
          task_id: taskId,
          audio_path: path,
          duration_ms: durationMs,
          take_number: takeNumber,
          status: "uploaded",
        })
        .select()
        .single();
      if (fbErr || !fallback) {
        return NextResponse.json({ error: "Could not save recording" }, { status: 500 });
      }
      await supabase.from("recording_tasks").update({ status: "completed" }).eq("id", taskId);
      let audio_url: string | null = null;
      try {
        audio_url = await createSignedDownloadUrl(path, 3600);
      } catch {
        /* ignore */
      }
      return NextResponse.json({ recording: { ...fallback, audio_url } }, { status: 201 });
    }

    await supabase.from("recording_tasks").update({ status: "completed" }).eq("id", taskId);

    let audio_url: string | null = null;
    try {
      audio_url = await createSignedDownloadUrl(path, 3600);
    } catch {
      /* ignore */
    }

    return NextResponse.json({ recording: { ...recording, audio_url } }, { status: 201 });
  }

  let duration_ms: number | undefined;
  let content_type = "audio/webm";
  try {
    const json = await req.json();
    duration_ms = typeof json.duration_ms === "number" ? json.duration_ms : undefined;
    if (typeof json.content_type === "string") content_type = json.content_type;
  } catch {
    /* empty body ok */
  }

  const ext = content_type.includes("wav") ? "wav" : content_type.includes("mp3") ? "mp3" : "webm";
  const path = recordingPath(user.id, task.project_id, taskId, takeNumber, ext);

  let signed;
  try {
    signed = await createSignedUploadUrl(path);
  } catch (e) {
    console.error("signed upload", e);
    return NextResponse.json({ error: "Could not create upload URL" }, { status: 500 });
  }

  const { data: recording, error: insErr } = await supabase
    .from("recordings")
    .insert({
      project_id: task.project_id,
      task_id: taskId,
      audio_path: path,
      duration_ms: duration_ms ?? null,
      take_number: takeNumber,
      status: "uploaded",
      metadata: { pending_client_upload: true },
    })
    .select()
    .single();

  if (insErr) {
    console.error("insert recording", insErr);
    return NextResponse.json({ error: "Could not save recording row" }, { status: 500 });
  }

  return NextResponse.json(
    {
      recording,
      upload: {
        signedUrl: signed.signedUrl,
        path: signed.path,
        method: "PUT",
        headers: { "Content-Type": content_type },
      },
    },
    { status: 201 }
  );
}
