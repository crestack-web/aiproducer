import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/auth";
import {
  sendResendEmail,
  confirmationEmailHtml,
  getAppOrigin,
} from "@/lib/email/resend";
import { STUDIO_NAME } from "@/lib/brand";

export const dynamic = "force-dynamic";

/** Send a sample verification-style email to the admin via Resend. */
export async function POST() {
  const gate = await requireAdmin();
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  if (!process.env.RESEND_API_KEY?.trim()) {
    return NextResponse.json(
      { error: "RESEND_API_KEY is not set on this deployment" },
      { status: 503 }
    );
  }

  const origin = getAppOrigin();
  const sampleLink = `${origin}/auth?mode=login&confirmed=1`;
  const sent = await sendResendEmail({
    to: gate.email,
    subject: `[Admin test] Confirm your ${STUDIO_NAME} account`,
    html: confirmationEmailHtml({ confirmUrl: sampleLink, email: gate.email }),
    text: `Admin Resend test for ${STUDIO_NAME}. Sample link: ${sampleLink}`,
  });

  if (sent.error) {
    return NextResponse.json({ error: sent.error }, { status: 502 });
  }
  return NextResponse.json({ ok: true, id: sent.id, to: gate.email });
}
