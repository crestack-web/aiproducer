import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export async function POST(req: Request) {
  const secret = process.env.ROEX_WEBHOOK_SECRET;
  if (secret) {
    const hdr = req.headers.get("x-roex-secret") || req.headers.get("authorization");
    if (hdr !== secret && hdr !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const providerTaskId =
    (body.multitrack_task_id as string) ||
    (body.mastering_task_id as string) ||
    (body.task_id as string) ||
    ((body.multitrackData as { multitrackTaskId?: string })?.multitrackTaskId);

  if (!providerTaskId) return NextResponse.json({ error: "Missing task id" }, { status: 400 });

  const supabase = createServiceClient();
  const { data: job } = await supabase
    .from("jobs")
    .select("*")
    .eq("provider_task_id", providerTaskId)
    .maybeSingle();

  if (!job) {
    console.warn("roex webhook: unknown task", providerTaskId);
    return NextResponse.json({ ok: true, matched: false });
  }
  if (job.status === "complete" || job.status === "failed") {
    return NextResponse.json({
      ok: true,
      matched: true,
      already_terminal: true,
      status: job.status,
    });
  }

  // Advisory only: attach payload. Never overwrite stage — tickProduceJob / poller owns lifecycle.
  await supabase
    .from("jobs")
    .update({
      output_data: {
        ...(typeof job.output_data === "object" && job.output_data ? job.output_data : {}),
        webhook: body,
        webhook_received_at: new Date().toISOString(),
        webhook_observed_stage: job.stage,
      },
    })
    .eq("id", job.id);

  return NextResponse.json({
    ok: true,
    matched: true,
    job_id: job.id,
    stage_unchanged: job.stage || null,
  });
}
