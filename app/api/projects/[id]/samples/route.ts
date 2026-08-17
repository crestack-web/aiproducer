import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import {
  createSignedDownloadUrl,
  createSignedUploadUrl,
  samplePath,
  getStorageBucket,
} from "@/lib/storage";
import { createServiceClient } from "@/lib/supabase/server";
import { randomUUID } from "crypto";

type Ctx = { params: Promise<{ id: string }> };
const KINDS = new Set(["loop", "one_shot", "vocal_sample", "reference", "other"]);
const MAX_DIRECT_BYTES = 4.5 * 1024 * 1024;

function audioExt(type: string, name: string): string {
  const n = name.toLowerCase();
  if (n.endsWith(".wav") || type.includes("wav")) return "wav";
  if (n.endsWith(".mp3") || type.includes("mpeg") || type.includes("mp3")) return "mp3";
  if (n.endsWith(".m4a") || type.includes("mp4") || type.includes("m4a")) return "m4a";
  if (n.endsWith(".ogg") || type.includes("ogg")) return "ogg";
  if (n.endsWith(".webm") || type.includes("webm")) return "webm";
  if (n.endsWith(".flac") || type.includes("flac")) return "flac";
  if (n.endsWith(".aac") || type.includes("aac")) return "aac";
  return "wav";
}

async function assertProjectOwner(
  supabase: Awaited<ReturnType<typeof requireUser>>["supabase"],
  projectId: string,
  userId: string
) {
  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("user_id", userId)
    .maybeSingle();
  return project;
}

function parseOptionalMs(v: FormDataEntryValue | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

export async function GET(_req: Request, ctx: Ctx) {
  const { id: projectId } = await ctx.params;
  const { user, supabase, error } = await requireUser();
  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!(await assertProjectOwner(supabase, projectId, user.id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data: samples, error: sErr } = await supabase
    .from("samples")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  if (sErr) {
    console.error("samples list", sErr);
    return NextResponse.json(
      { error: sErr.message || "Could not load samples" },
      { status: 500 }
    );
  }

  const withUrls = [];
  for (const s of samples || []) {
    let audio_url: string | null = null;
    if (s.audio_path) {
      try {
        audio_url = await createSignedDownloadUrl(s.audio_path, 3600);
      } catch (e) {
        console.warn("sample signed url", s.id, e);
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

  if (!(await assertProjectOwner(supabase, projectId, user.id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const contentType = req.headers.get("content-type") || "";

  // --- Signed upload (large files / Vercel body limit) ---
  if (contentType.includes("application/json")) {
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const mode = String(body.mode || "");

    if (mode === "sign") {
      const filename = String(body.filename || "sample.wav");
      const fileType = String(body.contentType || "audio/wav");
      const sampleId = randomUUID();
      const ext = audioExt(fileType, filename);
      const path = samplePath(user.id, projectId, sampleId, ext);
      try {
        const signed = await createSignedUploadUrl(path, { upsert: true });
        return NextResponse.json({
          sample_id: sampleId,
          path: signed.path,
          signedUrl: signed.signedUrl,
          token: signed.token,
          contentType: fileType,
        });
      } catch (e) {
        console.error("sample signed upload url", e);
        const msg = e instanceof Error ? e.message : String(e);
        return NextResponse.json(
          {
            error:
              msg.includes("Bucket") || msg.includes("bucket") || msg.includes("not found")
                ? `Storage bucket error: ${msg}. Check STORAGE_BUCKET (default "Studio", case-sensitive) and bucket policies for signed uploads.`
                : msg ||
                  "Could not create upload URL. Check STORAGE_BUCKET (case-sensitive) and that the samples path is allowed.",
          },
          { status: 500 }
        );
      }
    }

    if (mode === "complete") {
      const sampleId = String(body.sample_id || randomUUID());
      const path = String(body.path || "");
      if (!path.startsWith(`users/${user.id}/projects/${projectId}/samples/`)) {
        return NextResponse.json({ error: "Invalid sample path" }, { status: 400 });
      }
      const kind = String(body.kind || "loop");
      if (!KINDS.has(kind)) {
        return NextResponse.json({ error: "Invalid sample kind" }, { status: 400 });
      }
      const title = body.title ? String(body.title) : null;
      const filename = body.filename ? String(body.filename) : "sample";
      const durationMs = Number(body.duration_ms) || null;
      const startMs =
        body.start_ms != null && Number.isFinite(Number(body.start_ms))
          ? Math.round(Number(body.start_ms))
          : null;
      const endMs =
        body.end_ms != null && Number.isFinite(Number(body.end_ms))
          ? Math.round(Number(body.end_ms))
          : null;
      const includeInProduce = body.include_in_produce !== false;

      const service = createServiceClient();
      const bucket = getStorageBucket();

      // Verify object actually landed in storage (catches policy / CORS / failed PUT)
      try {
        const folder = path.split("/").slice(0, -1).join("/");
        const name = path.split("/").pop() || "";
        const { data: listed, error: listErr } = await service.storage
          .from(bucket)
          .list(folder, { search: name, limit: 5 });
        if (listErr) {
          console.error("sample complete list", listErr);
        }
        const found = (listed || []).some((f) => f.name === name);
        if (!found) {
          // One more try: download head via createSignedUrl + HEAD
          try {
            const probe = await service.storage.from(bucket).createSignedUrl(path, 60);
            if (probe.error || !probe.data?.signedUrl) {
              return NextResponse.json(
                {
                  error:
                    "File did not arrive in storage after upload. Check bucket policies (allow signed uploads + upsert) for path users/*/projects/*/samples/*.",
                  code: "STORAGE_OBJECT_MISSING",
                },
                { status: 400 }
              );
            }
          } catch {
            return NextResponse.json(
              {
                error:
                  "File did not arrive in storage after upload. Check bucket policies (allow signed uploads + upsert) for path users/*/projects/*/samples/*.",
                code: "STORAGE_OBJECT_MISSING",
              },
              { status: 400 }
            );
          }
        }
      } catch (verifyErr) {
        console.warn("sample complete verify", verifyErr);
      }

      const row = {
        id: sampleId,
        project_id: projectId,
        user_id: user.id,
        kind,
        title,
        audio_path: path,
        original_filename: filename,
        duration_ms: durationMs,
        start_ms: startMs,
        end_ms: endMs,
        include_in_produce: includeInProduce,
        metadata: {
          content_type: body.contentType || null,
          size: body.size != null ? Number(body.size) : null,
          upload: "signed",
        },
      };

      // Prefer service insert after ownership check (avoids RLS edge cases)
      const { data: sample, error: insErr } = await service
        .from("samples")
        .insert(row)
        .select()
        .single();

      if (insErr || !sample) {
        console.error("sample complete insert", insErr);
        // Retry without placement columns if migration not applied yet
        const { data: sample2, error: insErr2 } = await service
          .from("samples")
          .insert({
            id: sampleId,
            project_id: projectId,
            user_id: user.id,
            kind,
            title,
            audio_path: path,
            original_filename: filename,
            duration_ms: durationMs,
            metadata: {
              content_type: body.contentType || null,
              size: body.size != null ? Number(body.size) : null,
              upload: "signed",
              start_ms: startMs,
              end_ms: endMs,
              include_in_produce: includeInProduce,
            },
          })
          .select()
          .single();
        if (insErr2 || !sample2) {
          return NextResponse.json(
            {
              error:
                insErr2?.message ||
                insErr?.message ||
                "Could not save sample record. Confirm samples table exists, migration 20260816220000_sample_placement is applied, and RLS allows insert.",
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
        return NextResponse.json({ sample: sample2, audio_url }, { status: 201 });
      }

      let audio_url: string | null = null;
      try {
        audio_url = await createSignedDownloadUrl(path, 3600);
      } catch {
        /* ignore */
      }
      return NextResponse.json({ sample, audio_url }, { status: 201 });
    }

    return NextResponse.json(
      { error: "JSON body must include mode: 'sign' or 'complete'" },
      { status: 400 }
    );
  }

  // --- Direct multipart upload (small files) ---
  if (!contentType.includes("multipart/form-data")) {
    return NextResponse.json(
      {
        error:
          "Send multipart/form-data with field 'file', or JSON mode sign/complete for larger files.",
      },
      { status: 400 }
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch (e) {
    console.error("sample formData", e);
    return NextResponse.json(
      {
        error:
          "Could not read upload body (file may be too large for this server). The app will retry with signed upload.",
        code: "BODY_TOO_LARGE",
      },
      { status: 400 }
    );
  }

  const file = form.get("file");
  if (!file || !(file instanceof Blob) || file.size === 0) {
    return NextResponse.json({ error: "Missing audio file" }, { status: 400 });
  }

  if (file.size > MAX_DIRECT_BYTES) {
    return NextResponse.json(
      {
        error: "File too large for direct upload (>4.5MB). Use signed upload.",
        code: "FILE_TOO_LARGE",
      },
      { status: 413 }
    );
  }

  const kind = String(form.get("kind") || "loop");
  if (!KINDS.has(kind)) {
    return NextResponse.json({ error: "Invalid sample kind" }, { status: 400 });
  }

  const durationMs = Number(form.get("duration_ms") || 0) || null;
  const startMs = parseOptionalMs(form.get("start_ms"));
  const endMs = parseOptionalMs(form.get("end_ms"));
  const titleRaw = form.get("title");
  const title = typeof titleRaw === "string" && titleRaw.trim() ? titleRaw.trim() : null;
  const filename =
    typeof (file as File).name === "string" && (file as File).name
      ? (file as File).name
      : "sample";
  const sampleId = randomUUID();
  const ext = audioExt(file.type || "", filename);
  const path = samplePath(user.id, projectId, sampleId, ext);

  const service = createServiceClient();
  const buf = Buffer.from(await file.arrayBuffer());
  const { error: upErr } = await service.storage.from(getStorageBucket()).upload(path, buf, {
    contentType: file.type || `audio/${ext === "mp3" ? "mpeg" : ext}`,
    upsert: true,
  });
  if (upErr) {
    console.error("sample storage upload", upErr);
    return NextResponse.json(
      {
        error: `Upload failed: ${upErr.message || "storage error"}. Check STORAGE_BUCKET (default Studio, case-sensitive) and that the service role can write to samples/.`,
      },
      { status: 500 }
    );
  }

  const baseRow = {
    id: sampleId,
    project_id: projectId,
    user_id: user.id,
    kind,
    title,
    audio_path: path,
    original_filename: filename,
    duration_ms: durationMs,
    metadata: {
      content_type: file.type || null,
      size: file.size,
      upload: "direct",
      start_ms: startMs,
      end_ms: endMs,
    },
  };

  let sample: Record<string, unknown> | null = null;
  let insErr: { message?: string } | null = null;

  {
    const r = await service
      .from("samples")
      .insert({
        ...baseRow,
        start_ms: startMs,
        end_ms: endMs,
        include_in_produce: true,
      })
      .select()
      .single();
    sample = r.data;
    insErr = r.error;
  }

  if (insErr || !sample) {
    console.error("sample insert", insErr);
    const r2 = await service.from("samples").insert(baseRow).select().single();
    if (r2.error || !r2.data) {
      return NextResponse.json(
        {
          error:
            r2.error?.message ||
            insErr?.message ||
            "Could not save sample. Confirm the samples table exists and RLS allows your user.",
        },
        { status: 500 }
      );
    }
    sample = r2.data;
  }

  let audio_url: string | null = null;
  try {
    audio_url = await createSignedDownloadUrl(path, 3600);
  } catch {
    /* ignore */
  }

  return NextResponse.json({ sample, audio_url }, { status: 201 });
}

export async function PATCH(req: Request, ctx: Ctx) {
  const { id: projectId } = await ctx.params;
  const { user, supabase, error } = await requireUser();
  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await assertProjectOwner(supabase, projectId, user.id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const sampleId = String(body.sample_id || "");
  if (!sampleId) {
    return NextResponse.json({ error: "sample_id required" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if (body.title !== undefined) patch.title = body.title ? String(body.title) : null;
  if (body.kind !== undefined) {
    const k = String(body.kind);
    if (!KINDS.has(k)) return NextResponse.json({ error: "Invalid kind" }, { status: 400 });
    patch.kind = k;
  }
  if (body.start_ms !== undefined) {
    patch.start_ms =
      body.start_ms == null || body.start_ms === ""
        ? null
        : Math.round(Number(body.start_ms));
  }
  if (body.end_ms !== undefined) {
    patch.end_ms =
      body.end_ms == null || body.end_ms === ""
        ? null
        : Math.round(Number(body.end_ms));
  }
  if (body.include_in_produce !== undefined) {
    patch.include_in_produce = Boolean(body.include_in_produce);
  }
  if (body.gain_db !== undefined) {
    patch.gain_db = Number(body.gain_db) || 0;
  }

  const { data, error: uErr } = await supabase
    .from("samples")
    .update(patch)
    .eq("id", sampleId)
    .eq("project_id", projectId)
    .select()
    .single();

  if (uErr || !data) {
    // Fallback: store placement in metadata if columns missing
    const { data: existing } = await supabase
      .from("samples")
      .select("*")
      .eq("id", sampleId)
      .eq("project_id", projectId)
      .maybeSingle();
    if (!existing) {
      return NextResponse.json({ error: "Sample not found" }, { status: 404 });
    }
    const meta = {
      ...((existing.metadata as object) || {}),
      ...patch,
    };
    const { data: data2, error: u2 } = await supabase
      .from("samples")
      .update({ metadata: meta, title: patch.title ?? existing.title })
      .eq("id", sampleId)
      .select()
      .single();
    if (u2 || !data2) {
      return NextResponse.json(
        { error: uErr?.message || u2?.message || "Could not update sample" },
        { status: 500 }
      );
    }
    return NextResponse.json({ sample: data2 });
  }

  return NextResponse.json({ sample: data });
}

export async function DELETE(req: Request, ctx: Ctx) {
  const { id: projectId } = await ctx.params;
  const { user, supabase, error } = await requireUser();
  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await assertProjectOwner(supabase, projectId, user.id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const url = new URL(req.url);
  const sampleId = url.searchParams.get("sample_id");
  if (!sampleId) {
    return NextResponse.json({ error: "sample_id required" }, { status: 400 });
  }

  const { data: existing } = await supabase
    .from("samples")
    .select("id, audio_path")
    .eq("id", sampleId)
    .eq("project_id", projectId)
    .maybeSingle();

  if (!existing) {
    return NextResponse.json({ error: "Sample not found" }, { status: 404 });
  }

  const service = createServiceClient();
  if (existing.audio_path) {
    await service.storage.from(getStorageBucket()).remove([existing.audio_path]);
  }

  const { error: dErr } = await supabase
    .from("samples")
    .delete()
    .eq("id", sampleId)
    .eq("project_id", projectId);

  if (dErr) {
    return NextResponse.json({ error: dErr.message || "Delete failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
