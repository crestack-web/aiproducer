import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createSignedDownloadUrl, samplePath } from "@/lib/storage";
import { createServiceClient } from "@/lib/supabase/server";
import { randomUUID } from "crypto";

type Ctx = { params: Promise<{ id: string }> };
const KINDS = new Set(["loop", "one_shot", "vocal_sample", "reference", "other"]);

function audioExt(type: string, name: string): string {
  const n = name.toLowerCase();
  if (n.endsWith(".wav") || type.includes("wav")) return "wav";
  if (n.endsWith(".mp3") || type.includes("mpeg") || type.includes("mp3")) return "mp3";
  if (n.endsWith(".m4a") || type.includes("mp4") || type.includes("m4a")) return "m4a";
  if (n.endsWith(".ogg") || type.includes("ogg")) return "ogg";
  if (n.endsWith(".webm") || type.includes("webm")) return "webm";
  return "wav";
}

export async function GET(_req: Request, ctx: Ctx) {
  const { id: projectId } = await ctx.params;
  const { user, supabase, error } = await requireUser();
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: samples, error: sErr } = await supabase
    .from("samples")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  if (sErr) {
    if (sErr.message?.includes("samples") || sErr.code === "42P01") {
      return NextResponse.json({ samples: [], warning: "Run samples migration" });
    }
    return NextResponse.json({ error: sErr.message }, { status: 500 });
  }

  const withUrls = await Promise.all(
    (samples || []).map(async (s) => {
      let audio_url: string | null = null;
      try {
        audio_url = await createSignedDownloadUrl(s.audio_path, 3600);
      } catch {
        /* ignore */
      }
      return { ...s, audio_url };
    })
  );
  return NextResponse.json({ samples: withUrls });
}

export async function POST(req: Request, ctx: Ctx) {
  const { id: projectId } = await ctx.params;
  const { user, supabase, error } = await requireUser();
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (!(req.headers.get("content-type") || "").includes("multipart/form-data")) {
    return NextResponse.json({ error: "multipart/form-data required" }, { status: 400 });
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!file || !(file instanceof Blob)) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }
  if (file.size > 25 * 1024 * 1024) {
    return NextResponse.json({ error: "Sample too large (max 25MB)" }, { status: 400 });
  }

  let kind = String(form.get("kind") || "loop");
  if (!KINDS.has(kind)) kind = "other";
  const title = String(form.get("title") || "").slice(0, 120) || null;
  const bpm = Number(form.get("bpm") || 0) || null;
  const durationMs = Number(form.get("duration_ms") || 0) || null;
  const filename = typeof (file as File).name === "string" ? (file as File).name : "sample";
  const sampleId = randomUUID();
  const ext = audioExt(file.type || "", filename);
  const path = samplePath(user.id, projectId, sampleId, ext);

  const service = createServiceClient();
  const buf = Buffer.from(await file.arrayBuffer());
  const { error: upErr } = await service.storage.from("studio").upload(path, buf, {
    contentType: file.type || `audio/${ext}`,
    upsert: true,
  });
  if (upErr) return NextResponse.json({ error: "Upload failed" }, { status: 500 });

  const { data: sample, error: insErr } = await supabase
    .from("samples")
    .insert({
      id: sampleId,
      project_id: projectId,
      user_id: user.id,
      kind,
      title: title || filename,
      audio_path: path,
      original_filename: filename,
      duration_ms: durationMs,
      bpm,
      metadata: { content_type: file.type, size: file.size },
    })
    .select()
    .single();

  if (insErr) {
    return NextResponse.json(
      {
        error: insErr.message?.includes("samples")
          ? "Samples table missing — run migration"
          : "Could not save sample",
      },
      { status: 500 }
    );
  }

  let audio_url: string | null = null;
  try {
    audio_url = await createSignedDownloadUrl(path, 3600);
  } catch {
    /* ignore */
  }
  return NextResponse.json({ sample: { ...sample, audio_url } }, { status: 201 });
}
