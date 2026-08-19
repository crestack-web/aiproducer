import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { isWavBuffer } from "@/lib/audio/wav";
import { detectAudioFormat } from "@/lib/audio/roex-assets";
import {
  createSignedDownloadUrl,
  createSignedUploadUrl,
  recordingPath,
  getStorageBucket,
} from "@/lib/storage";
import { assessDurationAlignment } from "@/lib/audio/timing";
import { analyzeMetadataOnly } from "@/lib/audio/analysis";
import type { AudioAnalysis } from "@/lib/audio/analysis-types";
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

/** Strip columns that are missing from the live schema (migration not applied yet). */
async function insertRecordingWithFallback(
  service: ReturnType<typeof createServiceClient>,
  row: Record<string, unknown>
): Promise<{ recording: Record<string, unknown> | null; error: { message?: string } | null }> {
  const attempts: Record<string, unknown>[] = [
    { ...row, original_path: row.audio_path, processed_path: row.audio_path, is_selected: true },
    { ...row, is_selected: true },
    { ...row },
  ];

  // Progressive strip of section-aware / pipeline columns if schema cache lacks them
  const optionalKeys = [
    "alignment_status",
    "timeline_start_ms",
    "timeline_end_ms",
    "original_audio_path",
    "role",
    "original_path",
    "processed_path",
    "is_selected",
  ];

  let lastError: { message?: string } | null = null;

  for (const attempt of attempts) {
    const { data, error } = await service.from("recordings").insert(attempt).select().single();
    if (!error && data) {
      if (!(attempt as { is_selected?: boolean }).is_selected && data.id) {
        try {
          await service.from("recordings").update({ is_selected: true }).eq("id", data.id as string);
        } catch {
          /* is_selected column may be missing */
        }
      }
      return { recording: data, error: null };
    }
    lastError = error;
    const msg = (error?.message || "").toLowerCase();
    if (!/column|schema cache|could not find/i.test(msg)) {
      continue;
    }
  }

  // Explicit strip loop for any remaining missing columns
  let working: Record<string, unknown> = {
    project_id: row.project_id,
    task_id: row.task_id,
    audio_path: row.audio_path,
    duration_ms: row.duration_ms,
    take_number: row.take_number,
    status: row.status,
    metadata: row.metadata,
  };

  for (const key of optionalKeys) {
    if (key in row) working[key] = row[key];
  }
  working.is_selected = true;

  for (let i = 0; i < optionalKeys.length + 2; i++) {
    const { data, error } = await service.from("recordings").insert(working).select().single();
    if (!error && data) return { recording: data, error: null };
    lastError = error;
    const msg = error?.message || "";
    const match = msg.match(/'([^']+)' column/i) || msg.match(/column "([^"]+)"/i);
    if (match?.[1] && match[1] in working) {
      const copy = { ...working };
      delete copy[match[1]];
      // Also stash missing field into metadata so data is not lost
      const meta =
        copy.metadata && typeof copy.metadata === "object"
          ? { ...(copy.metadata as object) }
          : {};
      (meta as Record<string, unknown>)[`_missing_col_${match[1]}`] = row[match[1]];
      copy.metadata = meta;
      working = copy;
      continue;
    }
    // Strip next optional key
    for (const k of optionalKeys) {
      if (k in working) {
        const copy = { ...working };
        delete copy[k];
        working = copy;
        break;
      }
    }
  }

  // Absolute minimum
  const minimal = {
    project_id: row.project_id,
    task_id: row.task_id,
    audio_path: row.audio_path,
    duration_ms: row.duration_ms ?? null,
    take_number: row.take_number,
    status: row.status || "uploaded",
    metadata: row.metadata || {},
  };
  const { data, error } = await service.from("recordings").insert(minimal).select().single();
  if (!error && data) return { recording: data, error: null };
  return { recording: null, error: error || lastError };
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

    const source = String(form.get("source") || "record");
    const buf = Buffer.from(await file.arrayBuffer());
    if (!buf.length) {
      return NextResponse.json({ error: "Empty audio file" }, { status: 400 });
    }

    // Prefer magic-byte format over browser MIME (iOS often sends empty/wrong type).
    const detected = detectAudioFormat(buf, (file as File).name || file.type || "");
    const ext =
      detected.format === "wav"
        ? "wav"
        : detected.format === "mp3"
          ? "mp3"
          : detected.format === "m4a"
            ? "m4a"
            : detected.format === "webm"
              ? "webm"
              : (file.type || "").includes("wav")
                ? "wav"
                : "webm";
    const contentType =
      detected.format !== "unknown"
        ? detected.contentType
        : file.type || "application/octet-stream";

    // Produce requires WAV stems — soft-warn in logs when client conversion missed
    if (source === "record" && !isWavBuffer(buf)) {
      console.warn("[recordings] non-WAV upload for record source", {
        taskId,
        format: detected.format,
        bytes: buf.length,
        clientType: file.type,
      });
    }

    const path = recordingPath(user.id, task.project_id, taskId, takeNumber, ext);

    const { error: upErr } = await service.storage.from(getStorageBucket()).upload(path, buf, {
      contentType,
      upsert: true,
    });
    if (upErr) {
      console.error("upload", upErr);
      return NextResponse.json({ error: `Upload failed: ${upErr.message}` }, { status: 500 });
    }

    const durationMs = Number(form.get("duration_ms") || 0) || null;
    const recordingOffsetMs = Number(form.get("recording_offset_ms") || 0) || 0;
    const clientPlacement = Number(form.get("placement_start_ms") || NaN);
    const placementStartMs = Number.isFinite(clientPlacement)
      ? Math.max(0, Math.round(clientPlacement))
      : Math.max(0, Math.round(ctxData.timeline_start_ms + recordingOffsetMs));
    // timeline_start_ms column remains canonical SECTION start (task.start_ms).
    // placement_start_ms / recording_offset_ms live in metadata for produce/review.
    const alignment = assessDurationAlignment(durationMs, ctxData.expected_ms);

    let clientAnalysis: AudioAnalysis | null = null;
    const analysisRaw = form.get("analysis");
    if (typeof analysisRaw === "string" && analysisRaw.trim()) {
      try {
        clientAnalysis = JSON.parse(analysisRaw) as AudioAnalysis;
      } catch {
        clientAnalysis = null;
      }
    }
    const analysis: AudioAnalysis =
      clientAnalysis ||
      analyzeMetadataOnly({
        durationMs,
        expectedDurationMs: ctxData.expected_ms,
        timelineStartMs: ctxData.timeline_start_ms,
        timelineEndMs: ctxData.timeline_end_ms,
        projectId: task.project_id,
        sectionId: (ctxData.section?.id || task.section_id || null) as string | null,
        role: ctxData.role,
      });

    const sessionTimelineRaw = form.get("session_timeline");
    let sessionTimelineMeta: unknown = null;
    if (typeof sessionTimelineRaw === "string" && sessionTimelineRaw.trim()) {
      try {
        sessionTimelineMeta = JSON.parse(sessionTimelineRaw);
      } catch {
        sessionTimelineMeta = null;
      }
    }

    const sectionMeta = {
      source,
      task_id: taskId,
      section_id: ctxData.section?.id || task.section_id || null,
      section_type: ctxData.section?.type || ctxData.meta.section_type || null,
      section_label: ctxData.section_label,
      start_bar: ctxData.start_bar,
      end_bar: ctxData.end_bar,
      // Canonical musical section (never rewritten by plan selection)
      timeline_start_ms: ctxData.timeline_start_ms,
      timeline_end_ms: ctxData.timeline_end_ms,
      section_start_ms: ctxData.timeline_start_ms,
      section_end_ms: ctxData.timeline_end_ms,
      recording_offset_ms: recordingOffsetMs,
      placement_start_ms: placementStartMs,
      expected_duration_ms: ctxData.expected_ms,
      actual_duration_ms: durationMs,
      recorded_duration_ms: durationMs,
      alignment,
      alignment_status: alignment.status,
      role: ctxData.role,
      analysis,
      analyzer_version: analysis.analyzerVersion,
      session_timeline: sessionTimelineMeta,
    };

    try {
      await service.from("recordings").update({ is_selected: false }).eq("task_id", taskId);
    } catch {
      /* is_selected column may be missing */
    }

    const baseRow: Record<string, unknown> = {
      project_id: task.project_id,
      task_id: taskId,
      audio_path: path,
      duration_ms: durationMs,
      take_number: takeNumber,
      status: "uploaded",
      timeline_start_ms: ctxData.timeline_start_ms,
      timeline_end_ms: ctxData.timeline_end_ms,
      original_audio_path: path,
      alignment_status: alignment.status,
      role: ctxData.role,
      metadata: sectionMeta,
    };

    const { recording, error: insErr } = await insertRecordingWithFallback(service, baseRow);

    if (!recording) {
      console.error("insert recording", insErr);
      return NextResponse.json(
        {
          error: `Could not save recording: ${insErr?.message || "unknown"}. Apply migration 20260816100000_section_aware_recordings if alignment_status is missing.`,
        },
        { status: 500 }
      );
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
        analysis,
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
  const analysis = analyzeMetadataOnly({
    durationMs: duration_ms ?? null,
    expectedDurationMs: ctxData.expected_ms,
    timelineStartMs: ctxData.timeline_start_ms,
    timelineEndMs: ctxData.timeline_end_ms,
    projectId: task.project_id,
    sectionId: (ctxData.section?.id || task.section_id || null) as string | null,
    role: ctxData.role,
  });
  const ext = content_type.includes("wav") ? "wav" : content_type.includes("mp3") ? "mp3" : "webm";
  const path = recordingPath(user.id, task.project_id, taskId, takeNumber, ext);

  let signed;
  try {
    signed = await createSignedUploadUrl(path);
  } catch (e) {
    console.error("signed upload", e);
    return NextResponse.json({ error: "Could not create upload URL" }, { status: 500 });
  }

  const signedRow: Record<string, unknown> = {
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
      alignment_status: alignment.status,
      analysis,
      analyzer_version: analysis.analyzerVersion,
    },
  };

  const { recording, error: insErr } = await insertRecordingWithFallback(service, signedRow);

  if (!recording) {
    console.error("insert recording", insErr);
    return NextResponse.json(
      {
        error: `Could not save recording row: ${insErr?.message || "unknown"}`,
      },
      { status: 500 }
    );
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
      analysis,
    },
    { status: 201 }
  );
}
