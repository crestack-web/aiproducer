import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import {
  getMusicGenerationJob,
  MusicGenerationError,
  publicErrorMessage,
  tickMusicGenerationJob,
} from "@/lib/music-generation/service";

type Ctx = { params: Promise<{ jobId: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { jobId } = await ctx.params;
  const { user, error } = await requireUser();
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const job = await getMusicGenerationJob(jobId, user.id);
    return NextResponse.json(job);
  } catch (e) {
    if (e instanceof MusicGenerationError) {
      return NextResponse.json(
        { error: publicErrorMessage(e.errorType), errorType: e.errorType },
        { status: e.errorType === "NOT_FOUND" ? 404 : 400 }
      );
    }
    return NextResponse.json({ error: "Failed to load job" }, { status: 500 });
  }
}

export async function POST(_req: Request, ctx: Ctx) {
  const { jobId } = await ctx.params;
  const { user, error } = await requireUser();
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    await getMusicGenerationJob(jobId, user.id);
    await tickMusicGenerationJob(jobId);
    const job = await getMusicGenerationJob(jobId, user.id);
    return NextResponse.json(job);
  } catch (e) {
    if (e instanceof MusicGenerationError) {
      const status = e.errorType === "BILLING_REQUIRED" ? 503 : e.errorType === "NOT_FOUND" ? 404 : 500;
      return NextResponse.json(
        { error: publicErrorMessage(e.errorType), errorType: e.errorType },
        { status }
      );
    }
    return NextResponse.json({ error: "Tick failed" }, { status: 500 });
  }
}
