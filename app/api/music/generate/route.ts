import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import {
  enqueueMusicGeneration,
  MusicGenerationError,
  publicErrorMessage,
} from "@/lib/music-generation/service";

const BodySchema = z.object({
  projectId: z.string().uuid(),
  prompt: z.string().max(4000).optional(),
  genre: z.string().max(60).optional(),
  mood: z.string().max(60).optional(),
  bpm: z.number().int().min(40).max(200).optional(),
  key: z.string().max(20).optional(),
  durationSec: z.number().int().min(5).max(30).optional(),
  kind: z.enum(["preview", "full"]).optional(),
  energy: z.string().max(40).optional(),
  idempotencyKey: z.string().max(200).optional(),
});

export async function POST(req: Request) {
  const { user, error } = await requireUser();
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  try {
    const result = await enqueueMusicGeneration({
      projectId: parsed.data.projectId,
      userId: user.id,
      prompt: parsed.data.prompt,
      genre: parsed.data.genre,
      mood: parsed.data.mood,
      bpm: parsed.data.bpm,
      key: parsed.data.key,
      durationSec: parsed.data.durationSec,
      kind: parsed.data.kind || "preview",
      energy: parsed.data.energy,
      instrumentalOnly: true,
      idempotencyKey: parsed.data.idempotencyKey,
    });
    return NextResponse.json(
      { jobId: result.jobId, status: result.status, deduped: result.deduped || false },
      { status: result.deduped ? 200 : 202 }
    );
  } catch (e) {
    if (e instanceof MusicGenerationError) {
      const status =
        e.errorType === "UNAUTHORIZED"
          ? 403
          : e.errorType === "LIMIT_EXCEEDED"
            ? 429
            : e.errorType === "BILLING_REQUIRED"
              ? 503
              : e.errorType === "INVALID_INPUT"
                ? 400
                : 500;
      return NextResponse.json(
        { error: publicErrorMessage(e.errorType), errorType: e.errorType },
        { status }
      );
    }
    console.error("[api/music/generate]", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Music generation failed" }, { status: 500 });
  }
}
