import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import {
  createSignedDownloadUrl,
  createSignedUploadUrl,
  customBeatPath,
  downloadStorageObject,
  uploadBuffer,
} from "@/lib/storage";
import { createServiceClient } from "@/lib/supabase/server";
import { analyzeWavArrayBuffer } from "@/lib/audio/beat-detect";

type Ctx = { params: Promise<{ id: string }> };

function audioExt(type: string, name: string): string {
  const n = name.toLowerCase();
  if (n.endsWith(".wav") || type.includes("wav")) return "wav";
  if (n.endsWith(".mp3") || type.includes("mpeg") || type.includes("mp3")) return "mp3";
  if (n.endsWith(".m4a") || type.includes("mp4") || type.includes("m4a") || type.includes("aac"))
    return "m4a";
  if (n.endsWith(".ogg") || type.includes("ogg")) return "ogg";
  if (n.endsWith(".webm") || type.includes("webm")) return "webm";
  if (n.endsWith(".flac") || type.includes("flac")) return "flac";
  return "wav";
}

/** GET /api/projects/:id/beat */
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

  const { data: projMeta } = await supabase
    .from("projects")
    .select("metadata")
    .eq("id", projectId)
    .maybeSingle();
  const activeBeatId =
    projMeta?.metadata &&
    typeof projMeta.metadata === "object" &&
    typeof (projMeta.metadata as Record<string, unknown>).active_beat_id === "string"
      ? String((projMeta.metadata as Record<string, unknown>).active_beat_id)
      : null;

  let beat: Record<string, unknown> | null = null;
  let bErr: { message?: string } | null = null;
  if (activeBeatId) {
    const res = await supabase
      .from("beats")
      .select("*")
      .eq("id", activeBeatId)
      .eq("project_id", projectId)
      .maybeSingle();
    beat = res.data as Record<string, unknown> | null;
    bErr = res.error;
  }
  if (!beat) {
    const res = await supabase
      .from("beats")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    beat = res.data as Record<string, unknown> | null;
    bErr = res.error;
  }

  if (bErr) {
    console.error("get beat", bErr);
    return NextResponse.json({ error: "Could not load beat" }, { status: 500 });
  }
  if (!beat) {
    return NextResponse.json({ error: "No beat yet" }, { status: 404 });
  }

  let audio_url: string | null = null;
  const path = typeof beat.audio_path === "string" ? beat.audio_path : null;
  if (path) {
    try {
      audio_url = await createSignedDownloadUrl(path, 3600);
    } catch (e) {
      console.error("signed url", e);
    }
  }

  return NextResponse.json({ beat, audio_url });
}

/**
 * POST /api/projects/:id/beat
 * JSON mode sign | complete (preferred) or multipart file (small files only).
 */
export async function POST(req: Request, ctx: Ctx) {
  const { id: projectId } = await ctx.params;
  const { user, supabase, error } = await requireUser();
  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: project } = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const contentType = req.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    const body = await req.json().catch(() => ({}));
    const mode = String(body.mode || "");

    if (mode === "sign") {
      const filename = String(body.filename || "custom-beat.wav");
      const fileType = String(body.contentType || "audio/wav");
      const ext = audioExt(fileType, filename);
      const path = customBeatPath(user.id, projectId, ext);
      try {
        const signed = await createSignedUploadUrl(path, { contentType: fileType });
        return NextResponse.json({
          path: signed.path,
          signedUrl: signed.signedUrl,
          token: signed.token,
          contentType: fileType,
        });
      } catch (e) {
        console.error("signed upload url", e);
        return NextResponse.json(
          {
            error:
              e instanceof Error
                ? e.message
                : "Could not create upload URL. Check R2 storage configuration.",
          },
          { status: 500 }
        );
      }
    }

    if (mode === "complete") {
      let path = String(body.path || "");
      if (!path.startsWith(`users/${user.id}/projects/${projectId}/`)) {
        return NextResponse.json({ error: "Invalid path" }, { status: 400 });
      }

      // Convert signed-upload MP3/etc to stereo WAV when possible
      let registeredContentType = String(body.contentType || "audio/wav");
      if (!path.toLowerCase().endsWith(".wav")) {
        try {
          try {
            const { convertBufferToWav } = await import("@/lib/audio/convert-to-wav");
            const { ensureStereoWavForRoex, isWavBuffer } = await import("@/lib/audio/wav");
            let buf = await downloadStorageObject(path);
            if (!isWavBuffer(buf)) {
              const conv = await convertBufferToWav(buf, path);
              buf = Buffer.from(ensureStereoWavForRoex(Buffer.from(conv.buffer)));
            } else {
              buf = Buffer.from(ensureStereoWavForRoex(buf));
            }
            const wavPath = path.replace(/\.[^./]+$/, "") + ".wav";
            await uploadBuffer(wavPath, buf, "audio/wav");
            path = wavPath;
            registeredContentType = "audio/wav";
          } catch (convStorageErr) {
            console.warn("[beat] convert-to-wav skipped", convStorageErr);
          }
        } catch (convErr) {
          console.warn("[beat-complete] WAV convert skipped", convErr);
        }
      }

      // Prefer client-measured analysis; fall back to server WAV parse if needed
      let durationMs: number | null = Number(body.duration_ms) || null;
      let bpm =
        Number(body.bpm || body.tempo || project.tempo || 90) || 90;
      let confidence: number | null = Number(body.bpm_confidence);
      if (!Number.isFinite(confidence)) confidence = null;
      let beatTimes: number[] | null = Array.isArray(body.beat_times_ms)
        ? body.beat_times_ms.map((n: unknown) => Number(n)).filter((n: number) => Number.isFinite(n))
        : null;
      let analysisSource: string | null = body.analysis_source ? String(body.analysis_source) : null;

      if ((!durationMs || !body.bpm) && path.toLowerCase().endsWith(".wav")) {
        try {
          const fileBuf = await downloadStorageObject(path);
          const ab = Uint8Array.from(fileBuf).buffer as ArrayBuffer;
          const wav = analyzeWavArrayBuffer(ab);
          if (wav) {
            if (!durationMs) durationMs = wav.duration_ms;
            if (!body.bpm) {
              bpm = wav.bpm;
              confidence = wav.confidence;
              beatTimes = wav.beat_times_ms;
              analysisSource = "server_wav";
            }
          }
        } catch (e) {
          console.warn("server wav analysis skipped", e);
        }
      }

      return registerBeat({
        userId: user.id,
        projectId,
        path,
        filename: String(body.filename || "custom-beat"),
        contentType: registeredContentType,
        size: Number(body.size) || null,
        bpm,
        genre: String(body.genre || project.genre || "R&B"),
        mood: String(body.mood || project.mood || "Emotional"),
        durationMs,
        bpmConfidence: confidence,
        beatTimesMs: beatTimes,
        analysisSource,
      });
    }

    return NextResponse.json(
      { error: "JSON body must include mode: 'sign' or 'complete'" },
      { status: 400 }
    );
  }

  if (!contentType.includes("multipart/form-data")) {
    return NextResponse.json(
      { error: "Send multipart/form-data with field 'file', or JSON mode sign/complete" },
      { status: 400 }
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch (e) {
    console.error("formData parse", e);
    return NextResponse.json(
      { error: "Could not read upload body (file may be too large). Use signed upload." },
      { status: 400 }
    );
  }

  const file = form.get("file");
  if (!file || !(file instanceof Blob) || file.size === 0) {
    return NextResponse.json({ error: "Missing audio file" }, { status: 400 });
  }

  if (file.size > 4.5 * 1024 * 1024) {
    return NextResponse.json(
      {
        error:
          "File too large for direct server upload (>4.5MB). Refresh and try again (signed upload).",
      },
      { status: 413 }
    );
  }

  const filename =
    typeof (file as File).name === "string" && (file as File).name
      ? (file as File).name
      : "custom-beat.wav";
  let ext = audioExt(file.type || "", filename);
  const service = createServiceClient();
  let buf = Buffer.from(await file.arrayBuffer());
  let uploadContentType = file.type || `audio/${ext === "mp3" ? "mpeg" : ext}`;
  // Prefer stereo WAV in storage so Produce never depends on runtime ffmpeg
  try {
    const { convertBufferToWav } = await import("@/lib/audio/convert-to-wav");
    const { ensureStereoWavForRoex, isWavBuffer } = await import("@/lib/audio/wav");
    if (!isWavBuffer(buf)) {
      const conv = await convertBufferToWav(buf, filename);
      buf = Buffer.from(ensureStereoWavForRoex(Buffer.from(conv.buffer)));
    } else {
      buf = Buffer.from(ensureStereoWavForRoex(buf));
    }
    ext = "wav";
    uploadContentType = "audio/wav";
  } catch (convErr) {
    console.warn("[beat-upload] WAV convert skipped", convErr);
  }
  const path = customBeatPath(user.id, projectId, ext);
  try {
    await uploadBuffer(path, buf, uploadContentType);
  } catch (upErr) {
    console.error("custom beat upload", upErr);
    return NextResponse.json(
      {
        error: `Upload failed: ${upErr instanceof Error ? upErr.message : "storage error"}. Check R2 storage configuration.`,
      },
      { status: 500 }
    );
  }

  let durationMs: number | null = Number(form.get("duration_ms") || 0) || null;
  let bpm = Number(form.get("tempo") || form.get("bpm") || project.tempo || 90) || 90;
  let confidence: number | null = Number(form.get("bpm_confidence"));
  if (!Number.isFinite(confidence as number)) confidence = null;
  let beatTimes: number[] | null = null;
  let analysisSource: string | null = form.get("analysis_source")
    ? String(form.get("analysis_source"))
    : null;

  // Server-side WAV analysis when client didn't measure
  if (ext === "wav") {
    try {
      const wav = analyzeWavArrayBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
      if (wav) {
        if (!durationMs) durationMs = wav.duration_ms;
        if (!form.get("bpm") && !form.get("measured_bpm")) {
          bpm = wav.bpm;
          confidence = wav.confidence;
          beatTimes = wav.beat_times_ms;
          analysisSource = analysisSource || "server_wav";
        }
      }
    } catch (e) {
      console.warn("multipart wav analysis", e);
    }
  }

  return registerBeat({
    userId: user.id,
    projectId,
    path,
    filename,
    contentType: file.type || `audio/${ext}`,
    size: file.size,
    bpm,
    genre: String(form.get("genre") || project.genre || "R&B"),
    mood: String(form.get("mood") || project.mood || "Emotional"),
    durationMs,
    bpmConfidence: confidence,
    beatTimesMs: beatTimes,
    analysisSource,
  });
}

async function registerBeat(input: {
  userId: string;
  projectId: string;
  path: string;
  filename: string;
  contentType: string;
  size: number | null;
  bpm: number;
  genre: string;
  mood: string;
  durationMs: number | null;
  bpmConfidence?: number | null;
  beatTimesMs?: number[] | null;
  analysisSource?: string | null;
}) {
  const service = createServiceClient();

  const bpm = Math.max(40, Math.min(240, Math.round(Number(input.bpm) || 90)));
  const durationMs =
    input.durationMs && input.durationMs > 500 ? Math.round(input.durationMs) : null;

  const beatRow: Record<string, unknown> = {
    project_id: input.projectId,
    audio_path: input.path,
    status: "ready",
    bpm,
    duration_ms: durationMs,
    source: "upload",
    original_filename: input.filename,
    metadata: {
      source: "upload",
      original_filename: input.filename,
      content_type: input.contentType,
      size: input.size,
      analysis: {
        method: input.analysisSource || (durationMs ? "client_or_server" : null),
        bpm_confidence: input.bpmConfidence ?? null,
        beat_times_ms: (input.beatTimesMs || []).slice(0, 400),
      },
    },
  };

  let beat;
  const { data: inserted, error: insErr } = await service
    .from("beats")
    .insert(beatRow)
    .select()
    .single();

  if (insErr || !inserted) {
    const minimal = {
      project_id: input.projectId,
      audio_path: input.path,
      status: "ready" as const,
      bpm,
      duration_ms: durationMs,
      metadata: beatRow.metadata,
    };
    const { data: fallback, error: fbErr } = await service
      .from("beats")
      .insert(minimal)
      .select()
      .single();
    if (fbErr || !fallback) {
      console.error("beat insert", insErr, fbErr);
      return NextResponse.json(
        {
          error: `Could not save beat: ${fbErr?.message || insErr?.message || "database error"}`,
        },
        { status: 500 }
      );
    }
    beat = fallback;
  } else {
    beat = inserted;
  }

  const { error: projErr } = await service
    .from("projects")
    .update({
      status: "beat_ready",
      genre: input.genre,
      mood: input.mood,
      tempo: bpm,
    })
    .eq("id", input.projectId)
    .eq("user_id", input.userId);

  if (projErr) {
    console.error("project status update", projErr);
  }

  let audio_url: string | null = null;
  try {
    audio_url = await createSignedDownloadUrl(input.path, 3600);
  } catch {
    /* ignore */
  }

  return NextResponse.json(
    {
      beat,
      audio_url,
      analysis: {
        bpm,
        duration_ms: durationMs,
        confidence: input.bpmConfidence ?? null,
        beat_count: input.beatTimesMs?.length ?? 0,
        source: input.analysisSource,
      },
      message: "Custom beat uploaded. Run analyze to build the producer plan.",
    },
    { status: 201 }
  );
}
