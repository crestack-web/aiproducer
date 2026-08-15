import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import {
  createSignedDownloadUrl,
  createSignedUploadUrl,
  customBeatPath,
  getStorageBucket,
} from "@/lib/storage";
import { createServiceClient } from "@/lib/supabase/server";

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
        const signed = await createSignedUploadUrl(path);
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
                : "Could not create upload URL. Check STORAGE_BUCKET / studio storage bucket (case-sensitive).",
          },
          { status: 500 }
        );
      }
    }

    if (mode === "complete") {
      const path = String(body.path || "");
      if (!path.startsWith(`users/${user.id}/projects/${projectId}/`)) {
        return NextResponse.json({ error: "Invalid path" }, { status: 400 });
      }
      return registerBeat({
        userId: user.id,
        projectId,
        path,
        filename: String(body.filename || "custom-beat"),
        contentType: String(body.contentType || "audio/wav"),
        size: Number(body.size) || null,
        bpm: Number(body.tempo || body.bpm || project.tempo || 90) || 90,
        genre: String(body.genre || project.genre || "R&B"),
        mood: String(body.mood || project.mood || "Emotional"),
        durationMs: Number(body.duration_ms) || null,
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
  const ext = audioExt(file.type || "", filename);
  const path = customBeatPath(user.id, projectId, ext);

  const service = createServiceClient();
  const buf = Buffer.from(await file.arrayBuffer());
  const { error: upErr } = await service.storage.from(getStorageBucket()).upload(path, buf, {
    contentType: file.type || `audio/${ext === "mp3" ? "mpeg" : ext}`,
    upsert: true,
  });
  if (upErr) {
    console.error("custom beat upload", upErr);
    return NextResponse.json(
      {
        error: `Upload failed: ${upErr.message || "storage error"}. Ensure the storage bucket exists (default name: studio). Set STORAGE_BUCKET if your bucket name differs (names are case-sensitive).`,
      },
      { status: 500 }
    );
  }

  return registerBeat({
    userId: user.id,
    projectId,
    path,
    filename,
    contentType: file.type || `audio/${ext}`,
    size: file.size,
    bpm: Number(form.get("tempo") || form.get("bpm") || project.tempo || 90) || 90,
    genre: String(form.get("genre") || project.genre || "R&B"),
    mood: String(form.get("mood") || project.mood || "Emotional"),
    durationMs: Number(form.get("duration_ms") || 0) || null,
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
}) {
  const service = createServiceClient();

  const beatRow: Record<string, unknown> = {
    project_id: input.projectId,
    audio_path: input.path,
    status: "ready",
    bpm: input.bpm,
    duration_ms: input.durationMs,
    source: "upload",
    original_filename: input.filename,
    metadata: {
      source: "upload",
      original_filename: input.filename,
      content_type: input.contentType,
      size: input.size,
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
      bpm: input.bpm,
      duration_ms: input.durationMs,
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
      tempo: input.bpm,
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
      message: "Custom beat uploaded. Run analyze to build the producer plan.",
    },
    { status: 201 }
  );
}
