import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { TRY_IT_PREVIEW_MAX_SEC } from "@/lib/try-it/config";
import {
  TryItQuotaError,
  generateTryItPreview,
  getTryItQuota,
  isTryItEnabled,
  signedPreviewUrls,
} from "@/lib/try-it/service";

type Ctx = { params: Promise<{ id: string }> };

export const maxDuration = 90;

const Body = z.object({
  genre: z.string().max(40).optional(),
  tempo: z.number().int().min(60).max(200).optional(),
  lyrics: z.string().max(400).optional(),
  section: z.enum(["chorus", "verse"]).optional(),
  /** Client may send; server rejects if above hard cap */
  duration_sec: z.number().optional(),
});

/** POST JSON: generate short draft beat + cloned-voice vocal (cost-capped) */
export async function POST(req: Request, ctx: Ctx) {
  const { user, error } = await requireUser();
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isTryItEnabled()) {
    return NextResponse.json({ error: "Try It is not enabled" }, { status: 503 });
  }
  const { id } = await ctx.params;
  try {
    const body = Body.parse(await req.json().catch(() => ({})));
    if (body.duration_sec != null && body.duration_sec > TRY_IT_PREVIEW_MAX_SEC) {
      return NextResponse.json(
        {
          error: `Preview is capped at ${TRY_IT_PREVIEW_MAX_SEC} seconds`,
          code: "DURATION_CAP",
        },
        { status: 400 }
      );
    }
    const session = await generateTryItPreview({
      sessionId: id,
      userId: user.id,
      genre: body.genre,
      tempo: body.tempo,
      lyrics: body.lyrics,
      section: body.section,
      requestedDurationSec: body.duration_sec,
    });
    const urls = await signedPreviewUrls(session);
    const quota = await getTryItQuota(user.id);
    return NextResponse.json({
      id: session.id,
      status: session.status,
      genre: session.genre,
      tempo: session.tempo,
      lyrics: session.lyrics,
      quota,
      preview: {
        mix_url: urls.mixUrl,
        beat_url: urls.beatUrl,
        vocal_url: urls.vocalUrl,
        source: "try_it_preview",
        download_blocked: true,
        share_blocked: true,
        pipeline: "music_composition_plan",
        max_duration_sec: TRY_IT_PREVIEW_MAX_SEC,
        draft_quality: true,
      },
    });
  } catch (e) {
    if (e instanceof TryItQuotaError) {
      const quota = await getTryItQuota(user.id);
      return NextResponse.json(
        {
          error: e.message,
          code: e.code,
          quota,
          route_to_record: true,
        },
        { status: 429 }
      );
    }
    console.error("[try-it generate]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Generate failed" },
      { status: 500 }
    );
  }
}
