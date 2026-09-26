import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { enqueueProduceSong, getPipelineMode } from "@/lib/audio/pipeline";
import { createServiceClient } from "@/lib/supabase/server";
import { createSignedDownloadUrl, isStoragePath } from "@/lib/storage";
import { getRoexEnv } from "@/lib/env";

type Ctx = { params: Promise<{ id: string }> };

export const maxDuration = 300;

/**
 * POST /api/projects/:id/produce
 * Authenticates, verifies ownership, enqueues PRODUCE_SONG, returns immediately.
 * Long-running work is owned by workers/production-worker.ts.
 */
export async function POST(req: Request, ctx: Ctx) {
  const { id: projectId } = await ctx.params;
  const { user, error } = await requireUser();
  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const service = createServiceClient();
  const { data: project } = await service
    .from("projects")
    .select("id, user_id, status, title")
    .eq("id", projectId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let force = false;
  try {
    const body = await req.json().catch(() => ({}));
    if (body && (body.force === true || body.force === "1" || body.reproduce === true)) {
      force = true;
    }
  } catch {
    force = false;
  }
  // Re-produce is the common path after a finished/failed mix — always allow a new job
  // when the client asks for force. Also force when project already shows complete.
  if (!force && (project.status === "complete" || project.status === "produced")) {
    force = true;
  }

  try {
    const result = await enqueueProduceSong(projectId, user.id, { force });

    if (!result?.job_id) {
      console.error("[produce] enqueue returned no job_id", { projectId, result });
      return NextResponse.json(
        {
          error: "Could not create a production job. Please try again.",
          canProduce: true,
        },
        { status: 500 }
      );
    }

    console.info(
      "[produce] enqueued",
      JSON.stringify({
        projectId,
        jobId: result.job_id,
        status: result.status,
        deduped: Boolean((result as { deduped?: boolean }).deduped),
        mode: getPipelineMode(),
      })
    );

    return NextResponse.json(
      {
        jobId: result.job_id,
        job_id: result.job_id,
        status: result.status,
        stage: (result as { stage?: string }).stage || result.status || "queued",
        deduped: Boolean((result as { deduped?: boolean }).deduped),
        mode: getPipelineMode(),
        message:
          result.status === "queued" || result.status === "processing"
            ? "Production started — waiting for the studio engine"
            : result.status === "complete"
              ? "Already produced"
              : "Produce enqueued",
        canProduce: true,
      },
      { status: 202 }
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "Produce failed";
    console.error("[produce] enqueue failed", { projectId, message });
    const notReady =
      /record at least one vocal|upload a beat|no vocal|no beat|no recordings|active plan|selected part/i.test(
        message
      );
    const status = notReady ? 400 : 500;
    return NextResponse.json(
      {
        error: message,
        canProduce: notReady ? false : undefined,
      },
      { status }
    );
  }
}

/**
 * GET — read produce job status only (worker advances the job).
 */
export async function GET(_req: Request, ctx: Ctx) {
  const { id: projectId } = await ctx.params;
  const { user, error } = await requireUser();
  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const service = createServiceClient();
  const { data: project } = await service
    .from("projects")
    .select("id, user_id, status")
    .eq("id", projectId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data: job } = await service
    .from("jobs")
    .select("*")
    .eq("project_id", projectId)
    .eq("type", "PRODUCE_SONG")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: master } = await service
    .from("audio_versions")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let master_url: string | null = null;
  const path = master?.audio_path as string | undefined;
  if (path && isStoragePath(path)) {
    try {
      master_url = await createSignedDownloadUrl(path, 3600);
    } catch {
      master_url = null;
    }
  }

  const { data: projNow } = await service
    .from("projects")
    .select("status")
    .eq("id", projectId)
    .maybeSingle();

  return NextResponse.json({
    project_status: projNow?.status || project.status,
    job,
    master,
    master_url,
    mode: getPipelineMode(),
    roex_env: getRoexEnv(),
  });
}
