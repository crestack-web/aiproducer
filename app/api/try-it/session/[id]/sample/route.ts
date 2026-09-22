import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { TRY_IT_MAX_SAMPLE_MS, TRY_IT_MIN_SAMPLE_MS } from "@/lib/try-it/config";
import { ingestSample, isTryItEnabled } from "@/lib/try-it/service";

type Ctx = { params: Promise<{ id: string }> };

export const maxDuration = 60;

/** POST multipart: file + duration_ms */
export async function POST(req: Request, ctx: Ctx) {
  const { user, error } = await requireUser();
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isTryItEnabled()) {
    return NextResponse.json({ error: "Try It is not enabled" }, { status: 503 });
  }
  const { id } = await ctx.params;
  try {
    const form = await req.formData();
    const file = form.get("file");
    const durationMs = Number(form.get("duration_ms") || 0);
    if (!file || typeof file !== "object" || !("arrayBuffer" in file)) {
      return NextResponse.json({ error: "Missing audio file" }, { status: 400 });
    }
    if (!Number.isFinite(durationMs) || durationMs < TRY_IT_MIN_SAMPLE_MS) {
      return NextResponse.json(
        { error: `Sample must be at least ${TRY_IT_MIN_SAMPLE_MS / 1000}s` },
        { status: 400 }
      );
    }
    if (durationMs > TRY_IT_MAX_SAMPLE_MS) {
      return NextResponse.json(
        { error: `Sample must be under ${TRY_IT_MAX_SAMPLE_MS / 1000}s` },
        { status: 400 }
      );
    }
    const ab = await (file as File).arrayBuffer();
    const buffer = Buffer.from(ab);
    const session = await ingestSample({
      sessionId: id,
      userId: user.id,
      buffer,
      filename: (file as File).name || "sample.webm",
      contentType: (file as File).type || "audio/webm",
      durationMs,
      removeNoise: form.get("remove_noise") !== "0",
    });
    return NextResponse.json({
      id: session.id,
      status: session.status,
      has_voice: Boolean(session.eleven_voice_id),
      sample_duration_ms: session.sample_duration_ms,
    });
  } catch (e) {
    console.error("[try-it sample]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Sample upload failed" },
      { status: 500 }
    );
  }
}
