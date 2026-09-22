import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import {
  getTryItQuota,
  getTryItSession,
  isTryItEnabled,
  signedPreviewUrls,
} from "@/lib/try-it/service";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/try-it/session/:id */
export async function GET(_req: Request, ctx: Ctx) {
  const { user, error } = await requireUser();
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isTryItEnabled()) {
    return NextResponse.json({ error: "Try It is not enabled" }, { status: 503 });
  }
  const { id } = await ctx.params;
  const session = await getTryItSession(id, user.id);
  if (!session) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const urls = await signedPreviewUrls(session);
  const quota = await getTryItQuota(user.id);
  return NextResponse.json({
    id: session.id,
    status: session.status,
    expires_at: session.expires_at,
    scope: session.scope,
    genre: session.genre,
    tempo: session.tempo,
    lyrics: session.lyrics,
    error: session.error,
    sample_duration_ms: session.sample_duration_ms,
    has_voice: Boolean(session.eleven_voice_id),
    quota,
    preview: {
      beat_url: urls.beatUrl,
      vocal_url: urls.vocalUrl,
      source: "try_it_preview",
      download_blocked: true,
      share_blocked: true,
      max_duration_sec: 20,
    },
  });
}
