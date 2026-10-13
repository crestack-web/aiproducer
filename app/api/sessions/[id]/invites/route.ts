import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { createInvite } from "@/lib/sessions/service";
import type { ApSessionRole } from "@/lib/sessions/types";

type Ctx = { params: Promise<{ id: string }> };

const CreateInviteSchema = z.object({
  role: z.enum(["producer", "artist", "listener"]).default("artist"),
  expiresInHours: z.number().min(1).max(24 * 30).optional(),
  maxUses: z.number().min(1).max(100).optional(),
  invitedEmail: z.string().email().optional(),
});

/** POST — create invite link (owner / producer) */
export async function POST(req: Request, ctx: Ctx) {
  const { user, supabase, error } = await requireUser();
  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: sessionId } = await ctx.params;
  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    /* empty body ok */
  }

  const parsed = CreateInviteSchema.safeParse(body || {});
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const result = await createInvite(supabase, {
    sessionId,
    userId: user.id,
    role: parsed.data.role as ApSessionRole,
    expiresInHours: parsed.data.expiresInHours ?? 72,
    maxUses: parsed.data.maxUses ?? 20,
    invitedEmail: parsed.data.invitedEmail,
  });

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const origin = req.headers.get("origin") || process.env.NEXT_PUBLIC_APP_URL || "";
  const joinUrl = origin
    ? `${origin.replace(/\/$/, "")}${result.joinPath}`
    : result.joinPath;

  return NextResponse.json({
    invite: result.invite,
    joinPath: result.joinPath,
    joinUrl,
  });
}

/** GET — list invites for session */
export async function GET(_req: Request, ctx: Ctx) {
  const { user, supabase, error } = await requireUser();
  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: sessionId } = await ctx.params;

  const { data, error: qErr } = await supabase
    .from("ap_session_invites")
    .select(
      "id, session_id, token, role, expires_at, revoked_at, max_uses, use_count, created_at, invited_email"
    )
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false });

  if (qErr) {
    return NextResponse.json({ error: qErr.message }, { status: 500 });
  }

  return NextResponse.json({ invites: data || [] });
}
