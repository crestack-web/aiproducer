import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import {
  paystackSecret,
  paystackCurrency,
  usdToChargeMajor,
  toPaystackAmount,
  paystackInitialize,
} from "@/lib/paystack";

type Ctx = { params: Promise<{ id: string }> };

/** Minimum charge when no beat_cost_usd is stored (free-generation beats still need payment to download). */
const DEFAULT_BEAT_DOWNLOAD_USD = 0.5;

/**
 * POST /api/projects/:id/beat/checkout
 * Starts a Paystack checkout for this beat only (not the full song session).
 * On success the callback/webhook sets beat_download_unlocked so the file can be downloaded.
 */
export async function POST(req: Request, ctx: Ctx) {
  const { id: projectId } = await ctx.params;
  const { user, error: authErr } = await requireUser();
  if (authErr || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const service = createServiceClient();
  const { data: project, error } = await service
    .from("projects")
    .select("id, user_id, title, metadata")
    .eq("id", projectId)
    .maybeSingle();

  if (error || !project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  if (project.user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const meta = { ...((project.metadata || {}) as Record<string, unknown>) };
  if (meta.beat_download_unlocked === true || meta.download_unlocked === true) {
    return NextResponse.json({ unlocked: true, already: true });
  }

  if (!paystackSecret()) {
    if (process.env.AP_ALLOW_DEV_UNLOCK === "1") {
      meta.beat_download_unlocked = true;
      meta.beat_download_unlocked_at = new Date().toISOString();
      meta.beat_download_plan = "beat";
      await service.from("projects").update({ metadata: meta }).eq("id", projectId);
      return NextResponse.json({ unlocked: true, dev: true });
    }
    return NextResponse.json(
      { error: "PAYSTACK_SECRET_KEY is not configured" },
      { status: 503 }
    );
  }

  const email = user.email;
  if (!email) {
    return NextResponse.json(
      { error: "Your account needs an email for checkout" },
      { status: 400 }
    );
  }

  // Prefer stored cost; fall back to a sensible minimum for free-generation beats.
  let usd = Number(meta.beat_cost_usd);
  if (!Number.isFinite(usd) || usd <= 0) {
    const dur = Number(meta.beat_duration_sec || meta.duration_sec);
    if (Number.isFinite(dur) && dur > 0) {
      // Match studio estimator: $1 / 120s, min $0.25
      usd = Math.max(0.25, Math.round((dur / 120) * 100) / 100);
    } else {
      usd = DEFAULT_BEAT_DOWNLOAD_USD;
    }
  }
  usd = Math.round(usd * 100) / 100;

  const currency = paystackCurrency();
  const major = usdToChargeMajor(usd);
  const amountMinor = toPaystackAmount(major, currency);

  const origin =
    req.headers.get("origin") ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "https://apstudio.site";

  const reference = `ap_beat_${projectId.replace(/-/g, "").slice(0, 12)}_${Date.now()}`;

  try {
    const init = await paystackInitialize({
      email,
      amountMinor,
      currency,
      callbackUrl: `${origin}/api/paystack/callback?project_id=${encodeURIComponent(projectId)}&type=beat`,
      reference,
      metadata: {
        project_id: projectId,
        user_id: user.id,
        plan: "beat",
        beat_only: true,
        amount_usd: usd,
        song_title: String(project.title || "AP Studio beat"),
      },
    });

    meta.paystack_pending = {
      reference: init.reference,
      plan: "beat",
      amount: amountMinor,
      currency,
      amount_usd: usd,
      at: new Date().toISOString(),
    };
    await service.from("projects").update({ metadata: meta }).eq("id", projectId);

    return NextResponse.json({
      amountUsd: usd,
      checkoutUrl: init.authorization_url,
      reference: init.reference,
      accessCode: init.access_code,
      publicKey: process.env.PAYSTACK_PUBLIC_KEY || null,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Paystack checkout failed" },
      { status: 502 }
    );
  }
}
