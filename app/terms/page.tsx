import type { Metadata } from "next";
import Link from "next/link";
import { STUDIO_LOGO_URL, STUDIO_NAME } from "@/lib/brand";

export const metadata: Metadata = {
  title: `Terms of Service — ${STUDIO_NAME}`,
  description: `Terms governing use of ${STUDIO_NAME}.`,
};

const UPDATED = "September 19, 2026";

export default function TermsPage() {
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
          <h1>Terms of Service</h1>
          <p className="legal-meta">Last updated: {UPDATED}</p>

          <p>
            These Terms of Service (“Terms”) govern your access to and use of{" "}
            <strong>{STUDIO_NAME}</strong> (“we”, “us”, or “our”) websites, applications, and
            related services (the “Service”). By creating an account or using the Service, you
            agree to these Terms.
          </p>

          <h2>1. The Service</h2>
          <p>
            {STUDIO_NAME} helps artists create instrumentals, record vocals, organize production
            layers, and produce finished song exports. Features may include AI beat generation,
            guided recording, arrangement, mixing/mastering-style processing, and downloads.
            Features may change as we improve the product.
          </p>

          <h2>2. Eligibility</h2>
          <p>
            You must be at least 13 years old (or the minimum age of digital consent in your
            region) and able to form a binding contract. If you use the Service on behalf of an
            organization, you represent that you have authority to bind that organization.
          </p>

          <h2>3. Accounts</h2>
          <p>
            You are responsible for your account credentials and for activity under your account.
            Provide accurate information and notify us of unauthorized use. We may suspend or
            terminate accounts that violate these Terms or pose risk to the Service or other users.
          </p>

          <h2>4. Your content</h2>
          <p>
            You retain ownership of original vocals, lyrics, and other materials you upload or
            record (“User Content”). You grant us a worldwide, non-exclusive license to host,
            process, transmit, and display User Content solely to operate and improve the Service
            (including AI processing you request).
          </p>
          <p>
            You represent that you have all rights needed to upload and process User Content and
            that it does not infringe others’ rights or violate law.
          </p>

          <h2>5. AI-generated and produced output</h2>
          <p>
            Beats, arrangements, and production outputs may be generated or processed using
            automated systems. Output quality can vary. Unless otherwise stated in a paid plan, we
            do not guarantee commercial clearance of third-party model training data or
            style-similarity results. You are responsible for how you use and distribute finished
            songs, including clearances for samples or third-party material you introduce.
          </p>

          <h2>6. Free and paid features</h2>
          <p>
            Some features are free with limits (for example a limited number of free AI beats).
            Paid features may include session unlocks, subscriptions, or per-song downloads. Prices
            and limits may change. Paid beat generation may be billed according to length (for
            example a stated rate such as $1 for a 2-minute beat) and charged when you unlock a
            download, as shown in the product at the time of purchase.
          </p>
          <p>
            Fees are generally non-refundable except where required by law or expressly stated at
            checkout.
          </p>

          <h2>7. Acceptable use</h2>
          <p>You agree not to:</p>
          <ul>
            <li>Abuse, reverse engineer, or disrupt the Service or its infrastructure</li>
            <li>Circumvent usage limits, paywalls, or security controls</li>
            <li>Upload unlawful, harmful, or infringing content</li>
            <li>Use the Service to infringe intellectual property or privacy rights</li>
            <li>Resell or misuse API/model access embedded in the product</li>
          </ul>

          <h2>8. Intellectual property</h2>
          <p>
            The Service, branding, software, and design are owned by {STUDIO_NAME} or its
            licensors. These Terms do not grant you rights to our trademarks or source code beyond
            what is needed to use the Service.
          </p>

          <h2>9. Disclaimers</h2>
          <p>
            THE SERVICE IS PROVIDED “AS IS” AND “AS AVAILABLE.” TO THE MAXIMUM EXTENT PERMITTED BY
            LAW, WE DISCLAIM WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND
            NON-INFRINGEMENT. We do not warrant uninterrupted or error-free operation, or that
            outputs will meet your creative or commercial expectations.
          </p>

          <h2>10. Limitation of liability</h2>
          <p>
            TO THE MAXIMUM EXTENT PERMITTED BY LAW, {STUDIO_NAME} AND ITS AFFILIATES WILL NOT BE
            LIABLE FOR INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY
            LOSS OF PROFITS, DATA, OR GOODWILL. OUR TOTAL LIABILITY FOR CLAIMS RELATING TO THE
            SERVICE WILL NOT EXCEED THE AMOUNTS YOU PAID US IN THE TWELVE (12) MONTHS BEFORE THE
            CLAIM (OR $50 IF YOU HAVE NOT PAID).
          </p>

          <h2>11. Indemnity</h2>
          <p>
            You will defend and indemnify {STUDIO_NAME} against claims arising from your User
            Content, your use of the Service, or your violation of these Terms or applicable law.
          </p>

          <h2>12. Termination</h2>
          <p>
            You may stop using the Service at any time. We may suspend or terminate access if you
            breach these Terms or if we discontinue the Service. Provisions that by nature should
            survive (including ownership, disclaimers, and limitations) will survive termination.
          </p>

          <h2>13. Changes</h2>
          <p>
            We may update these Terms by posting a revised version with an updated date. Continued
            use after changes constitutes acceptance of the new Terms.
          </p>

          <h2>14. Contact</h2>
          <p>
            Questions about these Terms: contact us via the channels listed on{" "}
            <Link href="/">apstudio.site</Link> or your support email for {STUDIO_NAME}.
          </p>

          <p className="legal-foot">
            Also see our <Link href="/privacy">Privacy Policy</Link>.
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
