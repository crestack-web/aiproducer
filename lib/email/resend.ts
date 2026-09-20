import { STUDIO_LOGO_URL, STUDIO_NAME } from "@/lib/brand";

const RESEND_API = "https://api.resend.com/emails";

/** Brand tokens aligned with Console / app aesthetic */
const BRAND = {
  bg: "#0a0a0c",
  card: "#121218",
  border: "rgba(231,169,97,0.22)",
  brass: "#E7A961",
  brassSoft: "#F0BC80",
  text: "#F5F0E8",
  muted: "#A39E96",
  faint: "#6F6A64",
  white: "#FFFFFF",
};

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

/** Shared branded shell — dark studio floor + brass accents (matches app) */
export function shellEmail(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <meta name="color-scheme" content="dark"/>
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.bg};font-family:Georgia,'Times New Roman',serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.bg};padding:40px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" style="max-width:560px;background:${BRAND.card};border-radius:20px;border:1px solid ${BRAND.border};overflow:hidden;">
        <tr>
          <td style="height:3px;background:linear-gradient(90deg,${BRAND.brass},transparent 70%);font-size:0;line-height:0;">&nbsp;</td>
        </tr>
        <tr>
          <td style="padding:32px 32px 8px;text-align:center;">
            <img src="${STUDIO_LOGO_URL}" alt="${STUDIO_NAME}" width="56" height="56" style="border-radius:14px;display:inline-block;border:1px solid ${BRAND.border};"/>
            <div style="margin-top:14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:13px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:${BRAND.brass};">${STUDIO_NAME}</div>
          </td>
        </tr>
        <tr>
          <td style="padding:12px 32px 8px;">
            <div style="font-family:Georgia,'Times New Roman',serif;font-size:26px;font-weight:500;line-height:1.25;color:${BRAND.text};text-align:center;">${title}</div>
          </td>
        </tr>
        <tr>
          <td style="padding:8px 32px 32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:15px;line-height:1.65;color:${BRAND.muted};">
            ${bodyHtml}
          </td>
        </tr>
        <tr>
          <td style="padding:18px 32px 28px;border-top:1px solid rgba(255,255,255,0.06);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:12px;line-height:1.5;color:${BRAND.faint};text-align:center;">
            You’re receiving this because you joined ${STUDIO_NAME}.
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function p(text: string, extra = ""): string {
  return `<p style="margin:0 0 16px;color:${BRAND.muted};${extra}">${text}</p>`;
}

function emphasis(text: string): string {
  return `<p style="margin:0 0 16px;color:${BRAND.text};font-size:16px;line-height:1.6;">${text}</p>`;
}

function quote(text: string): string {
  return `<p style="margin:20px 0;padding:16px 18px;border-left:3px solid ${BRAND.brass};background:rgba(231,169,97,0.08);border-radius:0 12px 12px 0;color:${BRAND.text};font-style:italic;font-size:15px;line-height:1.55;">${text}</p>`;
}

function cta(href: string, label: string): string {
  return `<p style="margin:28px 0 8px;text-align:center;">
    <a href="${href}" style="display:inline-block;background:linear-gradient(180deg,${BRAND.brassSoft},${BRAND.brass});color:#1A1208;text-decoration:none;padding:14px 28px;border-radius:999px;font-weight:800;font-size:14px;letter-spacing:0.02em;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">${label}</a>
  </p>`;
}

export function welcomeEmailHtml(opts: {
  name?: string;
  appUrl: string;
}): { subject: string; html: string; text: string } {
  const subject = `Welcome to APstudio — you're part of the beginning`;
  const openUrl = `${opts.appUrl.replace(/\/$/, "")}/app`;

  const body = `
    ${p("You didn’t just sign up for another music tool.")}
    ${emphasis("You joined at the beginning of something we believe can become much bigger than a tool.")}
    ${p("APstudio was built around a simple idea:")}
    ${quote("What if artists could bring the music in their heads — and the voices in their phones — into the world without needing a studio, a producer, or a complicated setup?")}
    ${p("That idea is why we’re building APstudio.")}
    ${p("But the bigger idea is the movement around it.")}
    ${p("We want to create a new generation of artists who can experiment more, record more, finish more songs, and sound like themselves — wherever they are.")}
    ${emphasis("Your voice matters here.")}
    ${p("That’s why we wanted you to understand the idea behind APstudio before you start using it. We’re not trying to replace artists or turn music into a button.")}
    ${emphasis("We’re building technology around the artist.")}
    ${p("You bring the voice.<br/>You bring the emotion.<br/>You bring the idea.")}
    ${p("<strong style=\"color:" + BRAND.text + "\">AP helps you turn it into a record.</strong>")}
    ${p("And because you joined early, you’re not simply using something that is already finished.")}
    ${emphasis("You’re part of the beginning.")}
    ${p("We’ll be learning from what you create, what you love, what feels wrong, what you wish existed, and what you think music should become.")}
    ${p("So record something.")}
    ${p("Try something strange.")}
    ${p("Make something beautiful.")}
    ${p("Make something terrible.")}
    ${p("Then make it again.")}
    ${emphasis("This is APstudio.")}
    ${emphasis("Let’s make something.")}
    ${cta(openUrl, "Open APstudio")}
    <p style="margin:24px 0 0;color:${BRAND.faint};font-size:13px;text-align:center;">— The APstudio Team</p>
  `;

  const html = shellEmail("Welcome to APstudio", body);

  const text = `Welcome to APstudio.

You didn’t just sign up for another music tool.

You joined at the beginning of something we believe can become much bigger than a tool.

APstudio was built around a simple idea:

What if artists could bring the music in their heads — and the voices in their phones — into the world without needing a studio, a producer, or a complicated setup?

That idea is why we’re building APstudio.

But the bigger idea is the movement around it.

We want to create a new generation of artists who can experiment more, record more, finish more songs, and sound like themselves — wherever they are.

Your voice matters here.

That’s why we wanted you to understand the idea behind APstudio before you start using it. We’re not trying to replace artists or turn music into a button.

We’re building technology around the artist.

You bring the voice.
You bring the emotion.
You bring the idea.

AP helps you turn it into a record.

And because you joined early, you’re not simply using something that is already finished.

You’re part of the beginning.

We’ll be learning from what you create, what you love, what feels wrong, what you wish existed, and what you think music should become.

So record something.

Try something strange.

Make something beautiful.

Make something terrible.

Then make it again.

This is APstudio.

Let’s make something.

Open APstudio: ${openUrl}

— The APstudio Team`;

  return { subject, html, text };
}


export function confirmationEmailHtml(opts: {
  confirmUrl: string;
  email?: string;
}): string {
  const safeUrl = opts.confirmUrl.replace(/"/g, "&quot;");
  const body = `
    <p style="margin:0 0 12px;font-size:16px;color:#f4f0ea;">Welcome to ${STUDIO_NAME}.</p>
    <p style="margin:0 0 20px;font-size:14px;color:#a8a29e;line-height:1.55;">
      Confirm your email to unlock Studio — record with your real voice, produce, and download.
    </p>
    <p style="margin:0 0 28px;text-align:center;">
      <a href="${safeUrl}" style="display:inline-block;padding:14px 28px;border-radius:12px;background:linear-gradient(135deg,#E7A961,#c4893f);color:#0a0a0c;font-weight:800;font-size:15px;text-decoration:none;">
        Confirm email
      </a>
    </p>
    <p style="margin:0;font-size:12px;color:#78716c;line-height:1.5;word-break:break-all;">
      Or paste this link into your browser:<br/>
      <a href="${safeUrl}" style="color:#E7A961;">${safeUrl}</a>
    </p>
  `;
  return shellEmail("Confirm your email", body);
}

export function passwordResetEmailHtml(opts: {
  resetUrl: string;
}): { subject: string; html: string; text: string } {
  const subject = `Reset your ${STUDIO_NAME} password`;
  const html = shellEmail(
    "Reset your password",
    `${p("We received a request to reset your password. Use the button below — it expires soon.")}
     ${cta(opts.resetUrl, "Choose new password")}
     <p style="margin:16px 0 0;font-size:13px;color:${BRAND.faint};">If you didn’t ask for this, you can ignore this email. Your password won’t change.</p>`
  );
  const text = `Reset your ${STUDIO_NAME} password: ${opts.resetUrl}`;
  return { subject, html, text };
}
