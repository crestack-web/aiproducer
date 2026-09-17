import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/server";
import { getAppOrigin, sendResendEmail, shellEmail } from "@/lib/email/resend";
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
    // Prefer signup confirmation; then magiclink; then invite — always delivered via Resend
    const { data, error } = await service.auth.admin.generateLink({
      type: "signup",
      email,
      options: { redirectTo },
    });
    if (error) {
      const second = await service.auth.admin.generateLink({
        type: "magiclink",
        email,
        options: { redirectTo },
      });
      if (second.error) {
        const third = await service.auth.admin.generateLink({
          type: "invite",
          email,
          options: { redirectTo },
        });
        if (third.error) {
          console.error("[send-confirm]", error.message, second.error.message, third.error.message);
          return NextResponse.json(
            { error: "Could not create confirmation link. Check SUPABASE_SERVICE_ROLE_KEY." },
            { status: 502 }
          );
        }
        const link =
          third.data?.properties?.action_link ||
          (third.data as { action_link?: string } | undefined)?.action_link;
        if (!link) {
          return NextResponse.json({ error: "No link returned" }, { status: 502 });
        }
        return await sendConfirm(email, link);
      }
      const link =
        second.data?.properties?.action_link ||
        (second.data as { action_link?: string } | undefined)?.action_link;
      if (!link) {
        return NextResponse.json({ error: "No link returned" }, { status: 502 });
      }
      return await sendConfirm(email, link);
    }

    const actionLink =
      data?.properties?.action_link ||
      (data as { action_link?: string } | undefined)?.action_link;
    if (!actionLink) {
      return NextResponse.json({ error: "No confirmation link returned" }, { status: 502 });
    }
    return await sendConfirm(email, actionLink);
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
     <p style="margin:0 0 20px;"><a href="${actionLink}" style="display:inline-block;background:#7c5cff;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600;">Confirm email</a></p>
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
