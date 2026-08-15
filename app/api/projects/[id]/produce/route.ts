import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { enqueueProduceSong, tickProduceJob, getPipelineMode } from "@/lib/audio/pipeline";
import { createServiceClient } from "@/lib/supabase/server";
import { createSignedDownloadUrl } from "@/lib/storage";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, ctx: Ctx) {
  const { id: projectId } = await ctx.params;
  const { user, error } = await requireUser();
  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await enqueueProduceSong(projectId, user.id);

    if (getPipelineMode() === "mock" && result.status === "queued") {
      try {
        await tickProduceJob(result.job_id);
      } catch (e) {
        console.error("mock tick", e);
      }
    }

    return NextResponse.json(
      {
        job_id: result.job_id,
        status: result.status,
        deduped: result.deduped,
        mode: getPipelineMode(),
      },
      { status: result.deduped ? 200 : 202 }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not start produce";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

export async function GET(_req: Request, ctx: Ctx) {
  const { id: projectId } = await ctx.params;
  const { user, supabase, error } = await requireUser();
  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: project } = await supabase
    .from("projects")
    .select("id, status")
    .eq("id", projectId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const service = createServiceClient();
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
    .eq("kind", "master")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  let master_url: string | null = null;
  if (master?.audio_path && !String(master.audio_path).startsWith("mock://")) {
    try {
      master_url = await createSignedDownloadUrl(master.audio_path, 3600);
    } catch {
      master_url = null;
    }
  }

  return NextResponse.json({
    project_status: project.status,
    job,
    master,
    master_url,
    mode: getPipelineMode(),
  });
}
