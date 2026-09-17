import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/server";
import {
  getAppOrigin,
  passwordResetEmailHtml,
  sendResendEmail,
} from "@/lib/email/resend";

const Body = z.object({
  email: z.string().email().max(320),
});

/**
 * POST /api/auth/forgot-password
 * Generates a recovery link (service role) and emails it via Resend with AP branding.
 * Always returns a generic success message to avoid email enumeration.
 */
export async function POST(req: Request) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter a valid email" }, { status: 400 });
  }

  const email = parsed.data.email.trim().toLowerCase();
  const origin = getAppOrigin(req);
  const redirectTo = `${origin}/auth?mode=update-password`;

  if (!process.env.RESEND_API_KEY?.trim()) {
    console.error("[forgot-password] RESEND_API_KEY missing");
    return NextResponse.json({
      ok: true,
      message: "If that email is registered, you’ll get a reset link shortly.",
    });
  }

  try {
    const service = createServiceClient();
    const { data, error } = await service.auth.admin.generateLink({
      type: "recovery",
      email,
      options: { redirectTo },
    });

    if (error) {
      console.error("[forgot-password] generateLink", error.message);
      // Generic response — don't reveal whether the user exists
      return NextResponse.json({
        ok: true,
        message: "If that email is registered, you’ll get a reset link shortly.",
      });
    }

    const actionLink =
      data?.properties?.action_link ||
      (data as { action_link?: string })?.action_link ||
      null;

    if (actionLink) {
      const mail = passwordResetEmailHtml({ resetUrl: actionLink });
      const sent = await sendResendEmail({
        to: email,
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
      });
      if (sent.error) {
        console.error("[forgot-password] resend", sent.error);
        // Do not fall back to Supabase Auth email — Resend is the only mail path
      } else if (!actionLink) {
        console.error("[forgot-password] missing action link");
      }
    }

    return NextResponse.json({
      ok: true,
      message: "If that email is registered, you’ll get a reset link shortly.",
    });
  } catch (e) {
    console.error("[forgot-password]", e);
    return NextResponse.json({
      ok: true,
      message: "If that email is registered, you’ll get a reset link shortly.",
    });
  }
}
