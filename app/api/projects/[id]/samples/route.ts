import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import {
  createSignedDownloadUrl,
  samplePath,
  getStorageBucket,
} from "@/lib/storage";
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
  if (n.endsWith(".flac") || type.includes("flac")) return "flac";
  return "wav";
}

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

  const { data: samples, error: sErr } = await supabase
    .from("samples")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  if (sErr) {
    return NextResponse.json({ error: "Could not load samples" }, { status: 500 });
  }

  const withUrls = [];
  for (const s of samples || []) {
    let audio_url: string | null = null;
    if (s.audio_path) {
      try {
        audio_url = await createSignedDownloadUrl(s.audio_path, 3600);
      } catch {
        /* ignore */
      }
    }
    withUrls.push({ ...s, audio_url });
  }

  return NextResponse.json({ samples: withUrls });
}

export async function POST(req: Request, ctx: Ctx) {
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

  const form = await req.formData();
  const file = form.get("file");
  if (!file || !(file instanceof Blob) || file.size === 0) {
    return NextResponse.json({ error: "Missing audio file" }, { status: 400 });
  }

  const kind = String(form.get("kind") || "other");
  if (!KINDS.has(kind)) {
    return NextResponse.json({ error: "Invalid sample kind" }, { status: 400 });
  }

  const durationMs = Number(form.get("duration_ms") || 0) || null;
  const filename = typeof (file as File).name === "string" ? (file as File).name : "sample";
  const sampleId = randomUUID();
  const ext = audioExt(file.type || "", filename);
  const path = samplePath(user.id, projectId, sampleId, ext);

  const service = createServiceClient();
  const buf = Buffer.from(await file.arrayBuffer());
  const { error: upErr } = await service.storage.from(getStorageBucket()).upload(path, buf, {
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
      audio_path: path,
      original_filename: filename,
      duration_ms: durationMs,
      metadata: { content_type: file.type || null, size: file.size },
    })
    .select()
    .single();

  if (insErr || !sample) {
    console.error("sample insert", insErr);
    return NextResponse.json({ error: "Could not save sample" }, { status: 500 });
  }

  let audio_url: string | null = null;
  try {
    audio_url = await createSignedDownloadUrl(path, 3600);
  } catch {
    /* ignore */
  }

  return NextResponse.json({ sample, audio_url }, { status: 201 });
}
