import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { getStorageBucket } from "@/lib/storage";

type Ctx = { params: Promise<{ id: string; sampleId: string }> };

export async function DELETE(_req: Request, ctx: Ctx) {
  const { id: projectId, sampleId } = await ctx.params;
  const { user, supabase, error } = await requireUser();
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: sample } = await supabase
    .from("samples")
    .select("*")
    .eq("id", sampleId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (!sample) return NextResponse.json({ error: "Sample not found" }, { status: 404 });

  const service = createServiceClient();
  if (sample.audio_path) {
    await service.storage.from(getStorageBucket()).remove([sample.audio_path]);
  }
  await supabase.from("samples").delete().eq("id", sampleId);
  return NextResponse.json({ ok: true });
}
