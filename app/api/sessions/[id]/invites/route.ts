import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { createInvite } from "@/lib/sessions/service";
import type { ApSessionRole } from "@/lib/sessions/types";
import { getAppOrigin, sendResendEmail, sessionInviteEmailHtml } from "@/lib/email/resend";

type Ctx = { params: Promise<{ id: string }> };

const CreateInviteSchema = z.object({
  role: z.enum(["producer", "artist", "listener"]).default("artist"),
  expiresInHours: z.number().min(1).max(24 * 30).optional(),
  maxUses: z.number().min(1).max(100).optional(),
  invitedEmail: z.string().email().optional(),
  sendEmail: z.boolean().optional(),
});

/** POST — create invite link (owner / producer); optionally email collaborator */
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

  const origin = getAppOrigin(req) || (
    req.headers.get("origin") ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "https://apstudio.site"
  ).replace(/\/$/, "");
  const joinUrl = `${origin.replace(/\/$/, "")}${result.joinPath}`;

  let emailSent = false;
  let emailError: string | undefined;

  const shouldEmail =
    Boolean(parsed.data.sendEmail) && Boolean(parsed.data.invitedEmail?.trim());

  if (shouldEmail && parsed.data.invitedEmail) {
    // Resolve inviter display name + project title
    let inviterName = user.email?.split("@")[0] || "A producer";
    try {
      const { data: profile } = await supabase
        .from("profiles")
        .select("display_name")
        .eq("id", user.id)
        .maybeSingle();
      if (profile?.display_name) inviterName = String(profile.display_name);
    } catch {
      /* ignore */
    }

    let projectTitle = "a project";
    try {
      const { data: session } = await supabase
        .from("ap_sessions")
        .select("project_id")
        .eq("id", sessionId)
        .maybeSingle();
      if (session?.project_id) {
        const { data: proj } = await supabase
          .from("projects")
          .select("title")
          .eq("id", session.project_id)
          .maybeSingle();
        if (proj?.title) projectTitle = String(proj.title);
      }
    } catch {
      /* ignore */
    }

    const mail = sessionInviteEmailHtml({
      inviterName,
      projectTitle,
      role: parsed.data.role,
      joinUrl,
      appUrl: origin,
    });
    const sent = await sendResendEmail({
      to: parsed.data.invitedEmail.trim(),
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
    });
    if (sent.error) {
      emailError = sent.error;
      console.error("session invite email", sent.error);
    } else {
      emailSent = true;
    }
  }

  return NextResponse.json({
    invite: result.invite,
    joinPath: result.joinPath,
    joinUrl,
    emailSent,
    emailError,
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
    // Schema without max_uses — retry minimal columns
    if (/max_uses|schema cache/i.test(qErr.message || "")) {
      const { data: d2, error: e2 } = await supabase
        .from("ap_session_invites")
        .select("id, session_id, token, role, expires_at, revoked_at, created_at, invited_email")
        .eq("session_id", sessionId)
        .order("created_at", { ascending: false });
      if (e2) return NextResponse.json({ error: e2.message }, { status: 500 });
      return NextResponse.json({ invites: d2 || [] });
    }
    return NextResponse.json({ error: qErr.message }, { status: 500 });
  }

  return NextResponse.json({ invites: data || [] });
}
