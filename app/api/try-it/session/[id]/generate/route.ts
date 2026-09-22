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

export const maxDuration = 120;

const Body = z.object({
  genre: z.string().max(40).optional(),
  tempo: z.number().int().min(60).max(200).optional(),
  lyrics: z.string().max(400).optional(),
  section: z.enum(["chorus", "verse"]).optional(),
  duration_sec: z.number().optional(),
});

/**
 * POST — produce a short demo from the artist's real sung take:
 * matched instrumental + light choir + mix (no voice clone).
 * Optional multipart field `file` = client-decoded WAV of the take.
 */
export async function POST(req: Request, ctx: Ctx) {
  if (!isTryItEnabled()) {
    return NextResponse.json({ error: "Try It is not available" }, { status: 503 });
  }
  const { user, error } = await requireUser();
  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;
  let genre: string | undefined;
  let tempo: number | undefined;
  let lyrics: string | undefined;
  let section: "chorus" | "verse" | undefined;
  let duration_sec: number | undefined;
  let clientWav: Buffer | null = null;

  const ct = (req.headers.get("content-type") || "").toLowerCase();
  try {
    if (ct.includes("multipart/form-data")) {
      const form = await req.formData();
      genre = typeof form.get("genre") === "string" ? String(form.get("genre")) : undefined;
      lyrics = typeof form.get("lyrics") === "string" ? String(form.get("lyrics")) : undefined;
      const tempoRaw = form.get("tempo");
      if (typeof tempoRaw === "string" && tempoRaw) tempo = Number(tempoRaw);
      const sec = form.get("section");
      if (sec === "chorus" || sec === "verse") section = sec;
      const file = form.get("file");
      if (file && typeof file === "object" && "arrayBuffer" in file) {
        const ab = await (file as File).arrayBuffer();
        if (ab.byteLength > 44) clientWav = Buffer.from(ab);
      }
    } else {
      const json = await req.json().catch(() => ({}));
      const parsed = Body.safeParse(json);
      if (!parsed.success) {
        return NextResponse.json({ error: "Invalid body" }, { status: 400 });
      }
      genre = parsed.data.genre;
      tempo = parsed.data.tempo;
      lyrics = parsed.data.lyrics;
      section = parsed.data.section;
      duration_sec = parsed.data.duration_sec;
    }
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  try {
    const session = await generateTryItPreview({
      sessionId: id,
      userId: user.id,
      genre,
      tempo,
      lyrics,
      section,
      requestedDurationSec: duration_sec,
      clientWav,
    });
    const urls = await signedPreviewUrls(session);
    const quota = await getTryItQuota(user.id);
    return NextResponse.json({
      id: session.id,
      status: session.status,
      genre: session.genre,
      tempo: session.tempo,
      quota,
      preview: {
        mix_url: urls.mixUrl,
        beat_url: urls.beatUrl,
        vocal_url: urls.vocalUrl,
        source: "try_it_preview",
        download_blocked: true,
        share_blocked: true,
        pipeline: "from_vocal_take",
        max_duration_sec: TRY_IT_PREVIEW_MAX_SEC,
      },
    });
  } catch (e) {
    if (e instanceof TryItQuotaError) {
      const quota = await getTryItQuota(user.id).catch(() => ({
        used: TRY_IT_PREVIEW_MAX_SEC,
        remaining: 0,
        limit: 2,
      }));
      return NextResponse.json({ error: e.message, code: "QUOTA", quota }, { status: 429 });
    }
    const msg = e instanceof Error ? e.message : "Generate failed";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
