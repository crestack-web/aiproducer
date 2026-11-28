import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { whopKey, resolveChargeCurrency, usdToChargeMajor, whopCreateCheckout } from "@/lib/whop";

type Ctx = { params: Promise<{ id: string }> };

/** Minimum charge when no beat_cost_usd is stored (free-generation beats still need payment to download). */
const DEFAULT_BEAT_DOWNLOAD_USD = 0.5;

/**
 * POST /api/projects/:id/beat/checkout
 * Starts a Whop checkout for this beat only (not the full song session).
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

  if (!whopKey()) {
    if (process.env.AP_ALLOW_DEV_UNLOCK === "1") {
      meta.beat_download_unlocked = true;
      meta.beat_download_unlocked_at = new Date().toISOString();
      meta.beat_download_plan = "beat";
      await service.from("projects").update({ metadata: meta }).eq("id", projectId);
      return NextResponse.json({ unlocked: true, dev: true });
    }
    return NextResponse.json(
      { error: "Payments are not configured (WHOP_API_KEY missing)" },
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

  const currency = resolveChargeCurrency(req);
  const major = usdToChargeMajor(usd, currency);

  const origin =
    req.headers.get("origin") ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "https://apstudio.site";

  const reference = `ap_beat_${projectId.replace(/-/g, "").slice(0, 12)}_${Date.now()}`;

  try {
    const checkout = await whopCreateCheckout({
      amountUsd: usd,
      title: String(project.title || "AP Studio beat"),
      redirectUrl: `${origin}/api/whop/callback?project_id=${encodeURIComponent(projectId)}&type=beat`,
      metadata: {
        project_id: projectId,
        user_id: user.id,
        plan: "beat",
        beat_only: true,
        amount_usd: usd,
        reference,
      },
    });

    meta.whop_pending = {
      checkout_id: checkout.id,
      variant_id: checkout.variantId,
      reference,
      plan: "beat",
      amount_usd: usd,
      currency,
      at: new Date().toISOString(),
    };
    await service.from("projects").update({ metadata: meta }).eq("id", projectId);

    return NextResponse.json({
      amountUsd: usd,
      currency,
      chargeMajor: major,
      checkoutUrl: checkout.purchaseUrl,
      reference,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Whop checkout failed" },
      { status: 502 }
    );
  }
}
