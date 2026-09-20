import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/server";
import { getAppOrigin, sendResendEmail, confirmationEmailHtml } from "@/lib/email/resend";
import { STUDIO_NAME } from "@/lib/brand";

const Body = z.object({
  email: z.string().email().max(320),
});

export async function POST(req: Request) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Valid email required" }, { status: 400 });
  }
  const email = parsed.data.email.trim().toLowerCase();
  const origin = getAppOrigin(req);
  const redirectTo = `${origin}/auth/callback?next=/app`;

  try {
    const service = createServiceClient();

    // magiclink + invite do not require password (signup type does)
    const first = await service.auth.admin.generateLink({
      type: "magiclink",
      email,
      options: { redirectTo },
    });
    if (!first.error) {
      const actionLink =
        first.data?.properties?.action_link ||
        (first.data as { action_link?: string } | undefined)?.action_link;
      if (actionLink) return await sendConfirm(email, actionLink);
    }

    const second = await service.auth.admin.generateLink({
      type: "invite",
      email,
      options: { redirectTo },
    });
    if (second.error) {
      console.error(
        "[send-confirm]",
        first.error?.message,
        second.error.message
      );
      return NextResponse.json(
        { error: "Could not create confirmation link. Check SUPABASE_SERVICE_ROLE_KEY." },
        { status: 502 }
      );
    }
    const link =
      second.data?.properties?.action_link ||
      (second.data as { action_link?: string } | undefined)?.action_link;
    if (!link) {
      return NextResponse.json({ error: "No link returned" }, { status: 502 });
    }
    return await sendConfirm(email, link);
  } catch (e) {
    console.error("[send-confirm]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Confirm email failed" },
      { status: 500 }
    );
  }
}

async function sendConfirm(email: string, actionLink: string) {
  const subject = `Confirm your ${STUDIO_NAME} account`;
  const html = shellEmail(
    "Confirm your email",
    `<p style="margin:0 0 14px;">Tap the button to confirm your email and open AP Studio.</p>
     <p style="margin:0 0 20px;"><a href="${actionLink}" style="display:inline-block;background:linear-gradient(180deg,#F0BC80,#E7A961);color:#1A1208;text-decoration:none;padding:12px 20px;border-radius:999px;font-weight:700;">Confirm email</a></p>
     <p style="margin:0;font-size:13px;color:#8a8a96;">If you didn’t sign up, ignore this email.</p>`
  );
  const sent = await sendResendEmail({
    to: email,
    subject,
    html,
    text: `Confirm your ${STUDIO_NAME} account: ${actionLink}`,
  });
  if (sent.error) {
    console.error("[send-confirm] resend", sent.error);
    return NextResponse.json({ error: sent.error }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
