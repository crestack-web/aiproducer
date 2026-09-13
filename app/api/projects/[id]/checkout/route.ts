import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { PLANS, type PlanId, type BillingInterval } from "@/lib/plans";
import {
  paystackSecret,
  paystackCurrency,
  planChargeUsd,
  usdToChargeMajor,
  toPaystackAmount,
  paystackInitialize,
} from "@/lib/paystack";

type Body = { plan?: string; interval?: string };

/**
 * Start Paystack checkout after the produce aha moment.
 * Session = one-time unlock for this project.
 * Creator/Pro = paid plan charge (recurring can be added via Paystack subscriptions later).
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

  if (!paystackSecret()) {
    if (process.env.AP_ALLOW_DEV_UNLOCK === "1" && plan === "session") {
      meta.download_unlocked = true;
      meta.download_unlocked_at = new Date().toISOString();
      meta.download_plan = "session";
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

  const currency = paystackCurrency();
  const usd = planChargeUsd(plan, interval);
  const major = usdToChargeMajor(usd);
  const amountMinor = toPaystackAmount(major, currency);

  const origin =
    req.headers.get("origin") ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "https://apstudio.site";

  // Unique reference Paystack will echo on verify
  const reference = `ap_${plan}_${projectId.replace(/-/g, "").slice(0, 12)}_${Date.now()}`;

  try {
    const init = await paystackInitialize({
      email,
      amountMinor,
      currency,
      callbackUrl: `${origin}/api/paystack/callback?project_id=${encodeURIComponent(projectId)}`,
      reference,
      metadata: {
        project_id: projectId,
        user_id: user.id,
        plan,
        interval,
        song_title: String(project.title || "AP Studio song"),
      },
    });

    // Stash pending checkout on project for verify
    meta.paystack_pending = {
      reference: init.reference,
      plan,
      interval,
      amount: amountMinor,
      currency,
      at: new Date().toISOString(),
    };
    await service.from("projects").update({ metadata: meta }).eq("id", projectId);

    return NextResponse.json({
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
