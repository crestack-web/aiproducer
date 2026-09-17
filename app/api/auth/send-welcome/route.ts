import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import {
  getAppOrigin,
  sendResendEmail,
  welcomeEmailHtml,
} from "@/lib/email/resend";

const Body = z.object({
  email: z.string().email().max(320).optional(),
  name: z.string().max(120).optional(),
});

/**
 * POST /api/auth/send-welcome
 * Branded welcome via Resend. Uses session email when present; otherwise body.email.
 */
export async function POST(req: Request) {
  let json: unknown = {};
  try {
    json = await req.json();
  } catch {
    /* empty ok */
  }

  const parsed = Body.safeParse(json ?? {});
  const name = parsed.success ? parsed.data.name : undefined;
  let email = parsed.success ? parsed.data.email?.trim().toLowerCase() : undefined;

  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    if (data.user?.email) email = data.user.email;
  } catch {
    /* continue with body email */
  }

  if (!email) {
    return NextResponse.json({ error: "Email required" }, { status: 400 });
  }

  const origin = getAppOrigin(req);
  const mail = welcomeEmailHtml({ name, appUrl: origin });
  const sent = await sendResendEmail({
    to: email,
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
  });

  if (sent.error) {
    console.error("[send-welcome]", sent.error);
    return NextResponse.json({ error: sent.error }, { status: 502 });
  }

  return NextResponse.json({ ok: true, id: sent.id });
}
