import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { generateTryItPreview, isTryItEnabled, signedPreviewUrls } from "@/lib/try-it/service";

type Ctx = { params: Promise<{ id: string }> };

export const maxDuration = 120;

const Body = z.object({
  genre: z.string().max(40).optional(),
  tempo: z.number().int().min(60).max(200).optional(),
  lyrics: z.string().max(400).optional(),
});

/** POST JSON: generate beat + cloned-voice vocal preview */
export async function POST(req: Request, ctx: Ctx) {
  const { user, error } = await requireUser();
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isTryItEnabled()) {
    return NextResponse.json({ error: "Try It is not enabled" }, { status: 503 });
  }
  const { id } = await ctx.params;
  try {
    const body = Body.parse(await req.json().catch(() => ({})));
    const session = await generateTryItPreview({
      sessionId: id,
      userId: user.id,
      genre: body.genre,
      tempo: body.tempo,
      lyrics: body.lyrics,
    });
    const urls = await signedPreviewUrls(session);
    return NextResponse.json({
      id: session.id,
      status: session.status,
      genre: session.genre,
      tempo: session.tempo,
      lyrics: session.lyrics,
      preview: {
        beat_url: urls.beatUrl,
        vocal_url: urls.vocalUrl,
        source: "try_it_preview",
        download_blocked: true,
        share_blocked: true,
      },
    });
  } catch (e) {
    console.error("[try-it generate]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Generate failed" },
      { status: 500 }
    );
  }
}
