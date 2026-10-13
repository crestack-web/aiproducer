import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { getMemberRole } from "@/lib/sessions/access";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Shared transport state for best-effort sync.
 * Clients interpolate locally; do not spam this endpoint every frame.
 */
const TransportSchema = z.object({
  playing: z.boolean(),
  positionMs: z.number().min(0).max(24 * 60 * 60 * 1000),
  /** Client clock when this state was authored (ms epoch) */
  clientTs: z.number().optional(),
  tempoBpm: z.number().min(40).max(240).optional(),
  revision: z.number().int().min(0).optional(),
});

/** GET — current transport snapshot */
export async function GET(_req: Request, ctx: Ctx) {
  const { user, supabase, error } = await requireUser();
  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: sessionId } = await ctx.params;
  const role = await getMemberRole(supabase, sessionId, user.id);
  if (!role) {
    return NextResponse.json({ error: "Not a session member" }, { status: 403 });
  }

  const { data: session } = await supabase
    .from("ap_sessions")
    .select("transport, updated_at")
    .eq("id", sessionId)
    .maybeSingle();

  if (!session) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({
    transport: session.transport || {},
    serverTs: Date.now(),
    updatedAt: session.updated_at,
  });
}

/**
 * POST — publish transport update (any member who can play).
 * Not sample-accurate across devices; best-effort shared playhead.
 */
export async function POST(req: Request, ctx: Ctx) {
  const { user, supabase, error } = await requireUser();
  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: sessionId } = await ctx.params;
  const role = await getMemberRole(supabase, sessionId, user.id);
  if (!role) {
    return NextResponse.json({ error: "Not a session member" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = TransportSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { data: current } = await supabase
    .from("ap_sessions")
    .select("transport")
    .eq("id", sessionId)
    .maybeSingle();

  const prev = (current?.transport || {}) as Record<string, unknown>;
  const prevRev = typeof prev.revision === "number" ? prev.revision : 0;
  const nextRev =
    typeof parsed.data.revision === "number"
      ? Math.max(parsed.data.revision, prevRev + 1)
      : prevRev + 1;

  const transport = {
    playing: parsed.data.playing,
    positionMs: parsed.data.positionMs,
    clientTs: parsed.data.clientTs ?? Date.now(),
    serverTs: Date.now(),
    tempoBpm: parsed.data.tempoBpm ?? prev.tempoBpm ?? null,
    revision: nextRev,
    updatedBy: user.id,
  };

  const { error: uErr } = await supabase
    .from("ap_sessions")
    .update({ transport })
    .eq("id", sessionId);

  if (uErr) {
    return NextResponse.json({ error: uErr.message }, { status: 500 });
  }

  // Mark this member as playing when transport is playing
  await supabase
    .from("ap_session_members")
    .update({
      is_playing: parsed.data.playing,
      last_seen_at: new Date().toISOString(),
    })
    .eq("session_id", sessionId)
    .eq("user_id", user.id);

  return NextResponse.json({ transport, serverTs: Date.now() });
}
