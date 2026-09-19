import type { Metadata } from "next";
import Link from "next/link";
import { STUDIO_LOGO_URL, STUDIO_NAME } from "@/lib/brand";

export const metadata: Metadata = {
  title: `Privacy Policy — ${STUDIO_NAME}`,
  description: `How ${STUDIO_NAME} collects, uses, and protects your information.`,
};

const UPDATED = "September 19, 2026";

export default function PrivacyPage() {
  return (
    <>
      <style>{legalCss}</style>
      <div className="legal-page">
        <header className="legal-header">
          <Link href="/" className="legal-logo">
            <img src={STUDIO_LOGO_URL} alt="" width={28} height={28} />
            <span>{STUDIO_NAME}</span>
          </Link>
          <Link href="/" className="legal-back">
            ← Back to home
          </Link>
        </header>

        <article className="legal-article">
          <p className="legal-kicker">Legal</p>
          <h1>Privacy Policy</h1>
          <p className="legal-meta">Last updated: {UPDATED}</p>

          <p>
            This Privacy Policy explains how <strong>{STUDIO_NAME}</strong> (“we”, “us”, or “our”)
            collects, uses, stores, and shares information when you use our website, apps, and
            related services (the “Service”). By using the Service, you agree to this policy.
          </p>

          <h2>1. Information we collect</h2>
          <h3>Account information</h3>
          <p>
            When you sign up, we may collect your email address, display name or artist name, and
            profile preferences (such as role, genre, and experience level from onboarding).
          </p>
          <h3>Content you create</h3>
          <p>
            We process audio and project data you provide, including beats, vocal recordings, session
            plans, production outputs, and related metadata (for example timing, section labels, and
            device/audio route diagnostics used to improve recording quality).
          </p>
          <h3>Usage and technical data</h3>
          <p>
            We may collect log data such as IP address, browser type, device type, pages viewed,
            approximate location derived from IP, and timestamps. We use cookies or similar storage
            for authentication, theme preferences, and session continuity.
          </p>
          <h3>Payments</h3>
          <p>
            Payments are processed by third-party providers (for example Paystack). We receive
            confirmation of payment status and limited metadata needed to unlock downloads or
            subscriptions. We do not store full card numbers on our servers.
          </p>

          <h2>2. How we use information</h2>
          <ul>
            <li>Provide, operate, and improve the Service (beat generation, recording, production, export)</li>
            <li>Authenticate accounts and secure access</li>
            <li>Process payments and fulfill purchases or subscriptions</li>
            <li>Communicate about your account, sessions, or service changes</li>
            <li>Prevent abuse, debug issues, and maintain reliability</li>
            <li>Comply with legal obligations</li>
          </ul>
          <p>
            AI features may send audio or text prompts to infrastructure and model providers solely
            to generate or process content you requested. We do not sell your personal information.
          </p>

          <h2>3. Sharing of information</h2>
          <p>We may share information with:</p>
          <ul>
            <li>
              <strong>Service providers</strong> that help us host infrastructure, store files,
              process payments, send email, or run AI audio features under contractual obligations
            </li>
            <li>
              <strong>Legal authorities</strong> when required by law or to protect rights, safety,
              and security
            </li>
            <li>
              <strong>Business transfers</strong> in connection with a merger, acquisition, or sale
              of assets, with appropriate safeguards
            </li>
          </ul>

          <h2>4. Data retention</h2>
          <p>
            We retain account, project, and audio data for as long as your account is active or as
            needed to provide the Service. You may request deletion of your account and associated
            content subject to legal retention requirements and residual backups.
          </p>

          <h2>5. Security</h2>
          <p>
            We use industry-standard measures such as encrypted transport (HTTPS), access controls,
            and authenticated APIs. No method of transmission or storage is 100% secure; please use
            a strong password and protect your devices.
          </p>

          <h2>6. Your choices</h2>
          <ul>
            <li>Update profile information in the app where available</li>
            <li>Request access, correction, or deletion of personal data by contacting us</li>
            <li>Control cookies through your browser settings (some features may not work without them)</li>
          </ul>

          <h2>7. Children’s privacy</h2>
          <p>
            The Service is not directed to children under 13 (or the minimum age required in your
            region). We do not knowingly collect personal information from children. If you believe
            a child has provided data, contact us and we will take appropriate steps.
          </p>

          <h2>8. International users</h2>
          <p>
            Your information may be processed in countries other than your own. By using the
            Service, you understand that your data may be transferred to and processed where we or
            our providers operate.
          </p>

          <h2>9. Changes</h2>
          <p>
            We may update this Privacy Policy from time to time. We will post the updated version
            on this page and revise the “Last updated” date. Continued use after changes means you
            accept the updated policy.
          </p>

          <h2>10. Contact</h2>
          <p>
            Questions about privacy: contact us via the channels listed on{" "}
            <Link href="/">apstudio.site</Link> or your support email for {STUDIO_NAME}.
          </p>

          <p className="legal-foot">
            Also see our <Link href="/terms">Terms of Service</Link>.
          </p>
        </article>
      </div>
    </>
  );
}

const legalCss = `
  .legal-page{
    min-height:100vh;margin:0;
    background:#050508;color:#F4F1EC;
    font-family:Inter,system-ui,-apple-system,sans-serif;
  }
  html[data-theme="light"] .legal-page{background:#F3EBE0;color:#1A1208}
  .legal-header{
    display:flex;align-items:center;justify-content:space-between;gap:16px;
    padding:16px 20px;max-width:800px;margin:0 auto;
    border-bottom:1px solid rgba(255,255,255,.08);
  }
  html[data-theme="light"] .legal-header{border-bottom-color:rgba(48,36,22,.12)}
  .legal-logo{
    display:inline-flex;align-items:center;gap:10px;text-decoration:none;
    color:inherit;font-weight:600;font-size:15px;
  }
  .legal-logo img{border-radius:8px}
  .legal-back{
    font-size:13px;font-weight:600;color:#9B96A3;text-decoration:none;
  }
  .legal-back:hover{color:#E7A961}
  .legal-article{
    max-width:720px;margin:0 auto;padding:32px 20px 64px;
    line-height:1.65;font-size:15px;
  }
  .legal-kicker{
    font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;
    color:#E7A961;margin:0 0 8px;
  }
  .legal-article h1{
    font-family:Fraunces,Georgia,serif;font-weight:500;font-size:clamp(1.75rem,4vw,2.25rem);
    margin:0 0 8px;letter-spacing:-.02em;
  }
  .legal-meta{color:#9B96A3;font-size:13px;margin:0 0 28px}
  .legal-article h2{
    font-size:1.15rem;font-weight:700;margin:32px 0 12px;color:inherit;
  }
  .legal-article h3{font-size:15px;font-weight:700;margin:18px 0 8px}
  .legal-article p{margin:0 0 14px;color:#C8C4BC}
  html[data-theme="light"] .legal-article p{color:#4A4035}
  .legal-article ul{margin:0 0 16px;padding-left:1.25rem;color:#C8C4BC}
  html[data-theme="light"] .legal-article ul{color:#4A4035}
  .legal-article li{margin-bottom:8px}
  .legal-article a{color:#E7A961;font-weight:600}
  .legal-foot{margin-top:36px;padding-top:20px;border-top:1px solid rgba(255,255,255,.08);font-size:14px}
`;
