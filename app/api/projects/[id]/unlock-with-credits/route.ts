import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { SONG_PATH_CREDITS } from "@/lib/credits/catalog";
import { spendCredits } from "@/lib/credits/wallet";

/**
 * Redeem AP Credits for song-path unlock (cheaper than $4.99 session).
 * Idempotent per project — already unlocked → no second charge.
 */
export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { user, error: authErr } = await requireUser();
  if (authErr || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id: projectId } = await ctx.params;
  const service = createServiceClient();

  const { data: project, error } = await service
    .from("projects")
    .select("id, user_id, metadata")
    .eq("id", projectId)
    .maybeSingle();

  if (error || !project || project.user_id !== user.id) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const meta = { ...((project.metadata || {}) as Record<string, unknown>) };
  if (meta.download_unlocked === true || meta.session_paid === true) {
    return NextResponse.json({
      ok: true,
      alreadyUnlocked: true,
      message: "This song is already unlocked.",
    });
  }

  const spent = await spendCredits({
    userId: user.id,
    amount: SONG_PATH_CREDITS,
    idempotencyKey: `song_path:${projectId}`,
    entryType: "song_path",
    projectId,
    note: `Song path unlock (${SONG_PATH_CREDITS} credits)`,
    metadata: { project_id: projectId },
  });

  if (!spent.ok) {
    return NextResponse.json(
      {
        error: spent.error,
        balance: spent.balance,
        required: SONG_PATH_CREDITS,
      },
      { status: spent.error === "insufficient_credits" ? 402 : 400 }
    );
  }

  meta.download_unlocked = true;
  meta.download_unlocked_at = new Date().toISOString();
  meta.download_plan = "credits_song_path";
  meta.credits_song_path = SONG_PATH_CREDITS;
  await service.from("projects").update({ metadata: meta }).eq("id", projectId);

  return NextResponse.json({
    ok: true,
    alreadyUnlocked: false,
    balance: spent.balance,
    spent: SONG_PATH_CREDITS,
  });
}
