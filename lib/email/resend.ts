import { STUDIO_LOGO_URL, STUDIO_NAME } from "@/lib/brand";

const RESEND_API = "https://api.resend.com/emails";

export function getResendFrom(): string {
  return (
    process.env.RESEND_FROM_EMAIL?.trim() ||
    process.env.EMAIL_FROM?.trim() ||
    "AP Studio <onboarding@resend.dev>"
  );
}

export function getAppOrigin(req?: Request): string {
  const fromEnv =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  if (req) {
    const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
    const proto = req.headers.get("x-forwarded-proto") || "https";
    if (host) return `${proto}://${host}`.replace(/\/$/, "");
  }
  return "http://localhost:3000";
}

type SendArgs = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};

export async function sendResendEmail(args: SendArgs): Promise<{ id?: string; error?: string }> {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) {
    return { error: "RESEND_API_KEY is not configured" };
  }

  const res = await fetch(RESEND_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: getResendFrom(),
      to: [args.to],
      subject: args.subject,
      html: args.html,
      text: args.text,
    }),
  });

  const data = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
  if (!res.ok) {
    return { error: data.message || `Resend error ${res.status}` };
  }
  return { id: data.id };
}

function shell(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#0a0a0c;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0c;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:480px;background:#141418;border-radius:16px;border:1px solid #2a2a32;overflow:hidden;">
        <tr><td style="padding:28px 28px 12px;text-align:center;">
          <img src="${STUDIO_LOGO_URL}" alt="${STUDIO_NAME}" width="48" height="48" style="border-radius:12px;display:inline-block;"/>
          <div style="margin-top:12px;font-size:18px;font-weight:700;color:#f5f5f7;">${STUDIO_NAME}</div>
        </td></tr>
        <tr><td style="padding:8px 28px 28px;color:#c8c8d0;font-size:15px;line-height:1.55;">
          <div style="font-size:17px;font-weight:600;color:#fff;margin-bottom:12px;">${title}</div>
          ${bodyHtml}
        </td></tr>
        <tr><td style="padding:16px 28px 24px;border-top:1px solid #2a2a32;font-size:12px;color:#6b6b76;text-align:center;">
          You’re receiving this because you use ${STUDIO_NAME}.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export function welcomeEmailHtml(opts: { name?: string; appUrl: string }): { subject: string; html: string; text: string } {
  const greet = opts.name ? `Hey ${opts.name}` : "Hey";
  const subject = `Welcome to ${STUDIO_NAME}`;
  const html = shell(
    "Welcome to AP",
    `<p style="margin:0 0 14px;">${greet} — you’re in. Record with your real voice, follow a clear plan, and let AP mix and master a finished track.</p>
     <p style="margin:0 0 20px;"><a href="${opts.appUrl}/app" style="display:inline-block;background:#7c5cff;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600;">Open studio</a></p>
     <p style="margin:0;font-size:13px;color:#8a8a96;">If you didn’t create this account, you can ignore this email.</p>`
  );
  const text = `${greet} — welcome to ${STUDIO_NAME}. Open your studio: ${opts.appUrl}/app`;
  return { subject, html, text };
}

export function passwordResetEmailHtml(opts: { resetUrl: string }): { subject: string; html: string; text: string } {
  const subject = `Reset your ${STUDIO_NAME} password`;
  const html = shell(
    "Reset your password",
    `<p style="margin:0 0 14px;">We received a request to reset your password. Use the button below — it expires soon.</p>
     <p style="margin:0 0 20px;"><a href="${opts.resetUrl}" style="display:inline-block;background:#7c5cff;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600;">Choose new password</a></p>
     <p style="margin:0;font-size:13px;color:#8a8a96;">If you didn’t ask for this, you can ignore this email. Your password won’t change.</p>`
  );
  const text = `Reset your ${STUDIO_NAME} password: ${opts.resetUrl}`;
  return { subject, html, text };
}
