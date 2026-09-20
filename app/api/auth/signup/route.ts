import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/server";
import {
  getAppOrigin,
  sendResendEmail,
  confirmationEmailHtml,
  welcomeEmailHtml,
} from "@/lib/email/resend";
import { STUDIO_NAME } from "@/lib/brand";

const Body = z.object({
  email: z.string().email().max(320),
  password: z.string().min(8).max(128),
});

/**
 * POST /api/auth/signup
 * Creates the user with the service role (no Supabase Auth email)
 * and sends confirmation + welcome via Resend only.
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
    return NextResponse.json(
      { error: "Valid email and password (8+ characters) required" },
      { status: 400 }
    );
  }

  const email = parsed.data.email.trim().toLowerCase();
  const password = parsed.data.password;
  const origin = getAppOrigin(req);
  const redirectTo = `${origin}/auth/callback?next=/app`;

  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) {
    return NextResponse.json(
      {
        error:
          "Email is not configured (RESEND_API_KEY). Add it in Vercel env so AP can send mail.",
      },
      { status: 503 }
    );
  }

  try {
    const service = createServiceClient();

    const { data: created, error: createErr } = await service.auth.admin.createUser({
      email,
      password,
      email_confirm: false,
      user_metadata: { signup_source: "resend_confirm" },
    });

    if (createErr) {
      const msg = createErr.message || "";
      if (/already|registered|exists/i.test(msg)) {
        return NextResponse.json(
          {
            error:
              "That email already has an account. Log in, or use Forgot password if you need access.",
            code: "already_registered",
          },
          { status: 409 }
        );
      }
      console.error("[signup] createUser", msg);
      return NextResponse.json({ error: msg || "Could not create account" }, { status: 502 });
    }

    // Generate confirmation link — types require password for "signup", not for magiclink
    let actionLink: string | null = null;

    const signupLink = await service.auth.admin.generateLink({
      type: "signup",
      email,
      password,
      options: { redirectTo },
    });
    if (!signupLink.error) {
      actionLink =
        signupLink.data?.properties?.action_link ||
        (signupLink.data as { action_link?: string } | undefined)?.action_link ||
        null;
    } else {
      console.warn("[signup] generateLink signup", signupLink.error.message);
      const magic = await service.auth.admin.generateLink({
        type: "magiclink",
        email,
        options: { redirectTo },
      });
      if (!magic.error) {
        actionLink =
          magic.data?.properties?.action_link ||
          (magic.data as { action_link?: string } | undefined)?.action_link ||
          null;
      } else {
        console.warn("[signup] generateLink magiclink", magic.error.message);
      }
    }

    if (!actionLink) {
      console.error("[signup] no action link after create");
      return NextResponse.json(
        {
          error:
            "Account was created but the confirmation link could not be generated. Contact support.",
        },
        { status: 502 }
      );
    }

    const confirmSubject = `Confirm your ${STUDIO_NAME} account`;
    const confirmHtml = confirmationEmailHtml({ confirmUrl: actionLink, email });color:#1A1208;text-decoration:none;padding:12px 20px;border-radius:999px;font-weight:700;">Confirm email</a></p>
       <p style="margin:0;font-size:13px;color:#8a8a96;">If you didn’t sign up, ignore this email.</p>`
    );

    const confirmSent = await sendResendEmail({
      to: email,
      subject: confirmSubject,
      html: confirmHtml,
      text: `Confirm your ${STUDIO_NAME} account: ${actionLink}`,
    });

    if (confirmSent.error) {
      console.error("[signup] resend confirm", confirmSent.error);
      return NextResponse.json(
        {
          error: `Account created, but confirmation email failed: ${confirmSent.error}`,
          code: "email_failed",
        },
        { status: 502 }
      );
    }

    try {
      const welcome = welcomeEmailHtml({ appUrl: origin });
      await sendResendEmail({
        to: email,
        subject: welcome.subject,
        html: welcome.html,
        text: welcome.text,
      });
    } catch (e) {
      console.warn("[signup] welcome skip", e);
    }

    return NextResponse.json({
      ok: true,
      userId: created.user?.id ?? null,
      message:
        "Account created. Check your email (and spam) for the AP confirmation link, then log in.",
    });
  } catch (e) {
    console.error("[signup]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Signup failed" },
      { status: 500 }
    );
  }
}
