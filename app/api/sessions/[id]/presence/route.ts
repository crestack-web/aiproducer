import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { getMemberRole } from "@/lib/sessions/access";
import { listMembers } from "@/lib/sessions/service";

type Ctx = { params: Promise<{ id: string }> };

const PresenceSchema = z.object({
  isRecording: z.boolean().optional(),
  isPlaying: z.boolean().optional(),
});

/**
 * POST — heartbeat. Updates last_seen_at and optional recording/playing flags.
 * Clients should call every ~8–15s while the Sessions panel is open.
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

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    /* empty */
  }
  const parsed = PresenceSchema.safeParse(body || {});
  const flags = parsed.success ? parsed.data : {};

  const patch: Record<string, unknown> = {
    last_seen_at: new Date().toISOString(),
  };
  if (typeof flags.isRecording === "boolean") patch.is_recording = flags.isRecording;
  if (typeof flags.isPlaying === "boolean") patch.is_playing = flags.isPlaying;

  await supabase
    .from("ap_session_members")
    .update(patch)
    .eq("session_id", sessionId)
    .eq("user_id", user.id)
    .is("left_at", null);

  const members = await listMembers(supabase, sessionId);
  const ONLINE_MS = 45_000;
  const now = Date.now();
  const withPresence = members.map((m) => {
    const seen = new Date(m.last_seen_at).getTime();
    const online = Number.isFinite(seen) && now - seen < ONLINE_MS;
    return {
      ...m,
      presence: online ? "online" : "offline",
    };
  });

  return NextResponse.json({ members: withPresence, myRole: role });
}

/** GET — member list with presence without updating heartbeat */
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

  const members = await listMembers(supabase, sessionId);
  const ONLINE_MS = 45_000;
  const now = Date.now();
  return NextResponse.json({
    members: members.map((m) => {
      const seen = new Date(m.last_seen_at).getTime();
      return {
        ...m,
        presence: Number.isFinite(seen) && now - seen < ONLINE_MS ? "online" : "offline",
      };
    }),
    myRole: role,
  });
}
