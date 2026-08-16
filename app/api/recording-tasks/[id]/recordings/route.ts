import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import {
  createSignedDownloadUrl,
  createSignedUploadUrl,
  recordingPath,
  getStorageBucket,
} from "@/lib/storage";
import { assessDurationAlignment } from "@/lib/audio/timing";
import { vocalStemKind } from "@/lib/audio/produce-job";

type Ctx = { params: Promise<{ id: string }> };

async function loadTaskContext(service: ReturnType<typeof createServiceClient>, taskId: string) {
  const { data: task } = await service
    .from("recording_tasks")
    .select("id, project_id, status, type, start_ms, end_ms, section_id, metadata, instruction")
    .eq("id", taskId)
    .maybeSingle();
  if (!task) return null;

  let section: {
    id: string;
    type: string;
    label: string | null;
    start_ms: number;
    end_ms: number;
    start_bar: number | null;
    end_bar: number | null;
  } | null = null;

  if (task.section_id) {
    const { data: sec } = await service
      .from("song_sections")
      .select("id, type, label, start_ms, end_ms, start_bar, end_bar")
      .eq("id", task.section_id)
      .maybeSingle();
    section = sec;
  }

  const meta = (task.metadata && typeof task.metadata === "object" ? task.metadata : {}) as Record<
    string,
    unknown
  >;

  const timeline_start_ms =
    typeof task.start_ms === "number"
      ? task.start_ms
      : typeof section?.start_ms === "number"
        ? section.start_ms
        : 0;
  const timeline_end_ms =
    typeof task.end_ms === "number"
      ? task.end_ms
      : typeof section?.end_ms === "number"
        ? section.end_ms
        : null;

  const expected_ms =
    timeline_end_ms != null && timeline_end_ms > timeline_start_ms
      ? timeline_end_ms - timeline_start_ms
      : null;

  const role = vocalStemKind(task.type || "LEAD");

  return {
    task,
    section,
    meta,
    timeline_start_ms,
    timeline_end_ms,
    expected_ms,
    role,
    section_label: (meta.section_label as string) || section?.label || section?.type || null,
    start_bar: (meta.start_bar as number) || section?.start_bar || null,
    end_bar: (meta.end_bar as number) || section?.end_bar || null,
  };
}

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

  const service = createServiceClient();
  const { data: recordings, error: rErr } = await service
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

  const service = createServiceClient();
  const ctxData = await loadTaskContext(service, taskId);
  if (!ctxData) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { task } = ctxData;

  const { data: project } = await supabase
    .from("projects")
    .select("id, user_id")
    .eq("id", task.project_id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { count } = await service
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

    const source = String(form.get("source") || "record"); // record | upload
    const ext = (file.type || "").includes("wav")
      ? "wav"
      : (file.type || "").includes("mpeg") || (file.type || "").includes("mp3")
        ? "mp3"
        : (file.type || "").includes("mp4")
          ? "mp4"
          : "webm";

    const path = recordingPath(user.id, task.project_id, taskId, takeNumber, ext);
    const buf = Buffer.from(await file.arrayBuffer());
    if (!buf.length) {
      return NextResponse.json({ error: "Empty audio file" }, { status: 400 });
    }

    const { error: upErr } = await service.storage.from(getStorageBucket()).upload(path, buf, {
      contentType: file.type || "audio/webm",
      upsert: true,
    });
    if (upErr) {
      console.error("upload", upErr);
      return NextResponse.json({ error: `Upload failed: ${upErr.message}` }, { status: 500 });
    }

    const durationMs = Number(form.get("duration_ms") || 0) || null;
    const alignment = assessDurationAlignment(durationMs, ctxData.expected_ms);

    const sectionMeta = {
      source,
      section_id: ctxData.section?.id || task.section_id || null,
      section_type: ctxData.section?.type || ctxData.meta.section_type || null,
      section_label: ctxData.section_label,
      start_bar: ctxData.start_bar,
      end_bar: ctxData.end_bar,
      timeline_start_ms: ctxData.timeline_start_ms,
      timeline_end_ms: ctxData.timeline_end_ms,
      expected_duration_ms: ctxData.expected_ms,
      actual_duration_ms: durationMs,
      alignment,
      role: ctxData.role,
    };

    await service.from("recordings").update({ is_selected: false }).eq("task_id", taskId);

    const baseRow = {
      project_id: task.project_id,
      task_id: taskId,
      audio_path: path,
      duration_ms: durationMs,
      take_number: takeNumber,
      status: "uploaded" as const,
      timeline_start_ms: ctxData.timeline_start_ms,
      timeline_end_ms: ctxData.timeline_end_ms,
      original_audio_path: path,
      alignment_status: alignment.status,
      role: ctxData.role,
      metadata: sectionMeta,
    };

    let recording: Record<string, unknown> | null = null;
    let insErr: { message?: string } | null = null;

    {
      const { data, error } = await service
        .from("recordings")
        .insert({
          ...baseRow,
          original_path: path,
          processed_path: path,
          is_selected: true,
        })
        .select()
        .single();
      if (!error && data) recording = data;
      else insErr = error;
    }

    if (!recording) {
      const { data, error } = await service
        .from("recordings")
        .insert({ ...baseRow, is_selected: true })
        .select()
        .single();
      if (!error && data) recording = data;
      else insErr = error;
    }

    if (!recording) {
      const { data, error } = await service.from("recordings").insert(baseRow).select().single();
      if (!error && data) {
        recording = data;
        await service.from("recordings").update({ is_selected: true }).eq("id", data.id);
      } else {
        console.error("insert recording", insErr || error);
        return NextResponse.json(
          { error: `Could not save recording: ${(insErr || error)?.message || "unknown"}` },
          { status: 500 }
        );
      }
    }

    await service.from("recording_tasks").update({ status: "completed" }).eq("id", taskId);

    let audio_url: string | null = null;
    try {
      audio_url = await createSignedDownloadUrl(path, 3600);
    } catch {
      /* ignore */
    }

    return NextResponse.json(
      {
        recording: { ...recording, audio_url },
        saved: true,
        project_id: task.project_id,
        task_id: taskId,
        placement: sectionMeta,
        alignment,
      },
      { status: 201 }
    );
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

  const alignment = assessDurationAlignment(duration_ms ?? null, ctxData.expected_ms);
  const ext = content_type.includes("wav") ? "wav" : content_type.includes("mp3") ? "mp3" : "webm";
  const path = recordingPath(user.id, task.project_id, taskId, takeNumber, ext);

  let signed;
  try {
    signed = await createSignedUploadUrl(path);
  } catch (e) {
    console.error("signed upload", e);
    return NextResponse.json({ error: "Could not create upload URL" }, { status: 500 });
  }

  const { data: recording, error: insErr } = await service
    .from("recordings")
    .insert({
      project_id: task.project_id,
      task_id: taskId,
      audio_path: path,
      duration_ms: duration_ms ?? null,
      take_number: takeNumber,
      status: "uploaded",
      is_selected: true,
      timeline_start_ms: ctxData.timeline_start_ms,
      timeline_end_ms: ctxData.timeline_end_ms,
      original_audio_path: path,
      alignment_status: alignment.status,
      role: ctxData.role,
      metadata: {
        pending_client_upload: true,
        section_id: ctxData.section?.id || task.section_id || null,
        section_label: ctxData.section_label,
        start_bar: ctxData.start_bar,
        end_bar: ctxData.end_bar,
        timeline_start_ms: ctxData.timeline_start_ms,
        timeline_end_ms: ctxData.timeline_end_ms,
        role: ctxData.role,
        alignment,
      },
    })
    .select()
    .single();

  if (insErr || !recording) {
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
      placement: {
        timeline_start_ms: ctxData.timeline_start_ms,
        timeline_end_ms: ctxData.timeline_end_ms,
        role: ctxData.role,
      },
      alignment,
    },
    { status: 201 }
  );
}
