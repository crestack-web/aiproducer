import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { PLANS, type PlanId, type BillingInterval } from "@/lib/plans";
import { whopKey, resolveChargeCurrency, usdToChargeMajor, whopCreateCheckout, planChargeUsd } from "@/lib/whop";
import { getActiveBeatInfo } from "@/lib/beats/active-beat";

type Body = { plan?: string; interval?: string };

/**
 * Start Whop checkout after the produce aha moment.
 * Session = one-time unlock for this project.
 * Creator/Pro = paid plan charge (recurring can be added via Whop subscriptions later).
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await ctx.params;
  const { user, error: authErr } = await requireUser();
  if (authErr || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as Body;
  const plan = (body.plan || "session") as PlanId;
  const interval = (body.interval === "year" ? "year" : "month") as BillingInterval;

  if (!PLANS.some((p) => p.id === plan)) {
    return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
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
  if (meta.download_unlocked === true || meta.subscription_plan) {
    return NextResponse.json({ unlocked: true, already: true });
  }

  if (!whopKey()) {
    if (process.env.AP_ALLOW_DEV_UNLOCK === "1" && plan === "session") {
      meta.download_unlocked = true;
      meta.download_unlocked_at = new Date().toISOString();
      meta.download_plan = "session";
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

  const currency = resolveChargeCurrency(req);
  let usd = planChargeUsd(plan, interval);
  // After free beats are used, AP-generated beat cost is added to session download price
  // Only when the song actually uses an AP-generated beat — never for the user's own upload
  // (meta.beat_generation_billable can be left over from an earlier generated beat).
  let beatCostAddedUsd = 0;
  if (plan === "session") {
    const beatCost = Number(meta.beat_cost_usd) || 0;
    if (meta.beat_generation_billable === true && beatCost > 0) {
      const activeBeat = await getActiveBeatInfo(service, projectId, meta);
      if (!activeBeat.isUserUpload) {
        beatCostAddedUsd = beatCost;
        usd = Math.round((usd + beatCost) * 100) / 100;
      }
    }
  }
  const major = usdToChargeMajor(usd, currency);

  const origin =
    req.headers.get("origin") ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "https://apstudio.site";

  // Unique reference Whop will echo on verify
  const reference = `ap_${plan}_${projectId.replace(/-/g, "").slice(0, 12)}_${Date.now()}`;

  try {
    const checkout = await whopCreateCheckout({
      amountUsd: usd,
      title: String(project.title || "AP Studio song"),
      redirectUrl: `${origin}/api/whop/callback?project_id=${encodeURIComponent(projectId)}`,
      metadata: {
        project_id: projectId,
        user_id: user.id,
        plan,
        interval,
        amount_usd: usd,
        reference,
      },
    });

    meta.whop_pending = {
      checkout_id: checkout.id,
      variant_id: checkout.variantId,
      reference,
      plan,
      interval,
      amount_usd: usd,
      currency,
      at: new Date().toISOString(),
    };
    await service.from("projects").update({ metadata: meta }).eq("id", projectId);

    return NextResponse.json({
      amountUsd: usd,
      currency,
      chargeMajor: major,
      beatCostUsd: beatCostAddedUsd,
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
