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

/** Bump when welcome copy/design changes — returned in API so we can verify deploys */
const WELCOME_TEMPLATE_VERSION = "mission-v2-brass";

/**
 * POST /api/auth/send-welcome
 * Branded welcome via Resend.
 * Explicit body.email always wins (admin/test sends); otherwise session email.
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
  const bodyEmail = parsed.success ? parsed.data.email?.trim().toLowerCase() : undefined;

  let email = bodyEmail;
  if (!email) {
    try {
      const supabase = await createClient();
      const { data } = await supabase.auth.getUser();
      if (data.user?.email) email = data.user.email.trim().toLowerCase();
    } catch {
      /* */
    }
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

  return NextResponse.json({
    ok: true,
    id: sent.id,
    template: WELCOME_TEMPLATE_VERSION,
    to: email,
  });
}
