/**
 * Whop payments helpers. Amounts are in USD major units (e.g. 4.99).
 * Env: WHOP_API_KEY (or whop_api_key). Optional: WHOP_ACCOUNT_ID (biz_...), WHOP_API_BASE.
 */
import { PLANS, SESSION_PRICE_USD, type PlanId, type BillingInterval } from "@/lib/plans";
import { createServiceClient } from "@/lib/supabase/server";
import { fulfillCreditPackagePurchase } from "@/lib/credits/wallet";

const API = (process.env.WHOP_API_BASE || "https://api.whop.com/api/v1").replace(/\/$/, "");

export function whopKey(): string | null {
  return (process.env.WHOP_API_KEY || process.env.whop_api_key || "").trim() || null;
}

/** Whop charges in USD for every buyer. */
export function resolveChargeCurrency(_req?: Request): string {
  return "USD";
}

export function usdToChargeMajor(usd: number, _currency?: string): number {
  return Math.round(usd * 100) / 100;
}

export function planChargeUsd(plan: PlanId, interval: BillingInterval): number {
  const def = PLANS.find((p) => p.id === plan);
  if (!def) return SESSION_PRICE_USD;
  if (plan === "session") return def.priceUsd;
  if (interval === "year" && def.priceUsdYear) return def.priceUsdYear;
  return def.priceUsd;
}

async function whop<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const key = whopKey();
  if (!key) throw new Error("WHOP_API_KEY is not set");
  const res = await fetch(`${API}${path}`, {
    method: init.method || "GET",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`[whop] ${path} failed [${res.status}]: ${text.slice(0, 500)}`);
    throw new Error(`Whop request failed (${res.status})`);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

export async function whopCreateCheckout(opts: {
  amountUsd: number;
  title: string;
  redirectUrl: string;
  metadata: Record<string, unknown>;
}): Promise<{ id: string; purchaseUrl: string; variantId: string | null }> {
  const accountId = process.env.WHOP_ACCOUNT_ID?.trim() || undefined;
  const cfg = await whop<{
    id: string;
    purchase_url?: string | null;
    variant?: { id?: string } | null;
    plan?: { id?: string } | null;
    variant_id?: string | null;
  }>("/checkout_configurations", {
    method: "POST",
    body: {
      ...(accountId ? { account_id: accountId } : {}),
      mode: "payment",
      redirect_url: opts.redirectUrl,
      metadata: opts.metadata,
      variant: {
        ...(accountId ? { account_id: accountId } : {}),
        billing_type: "one_time",
        currency: "usd",
        initial_price: Math.round(opts.amountUsd * 100) / 100,
        title: opts.title.slice(0, 60),
        visibility: "hidden",
        force_create_new_plan: true,
      },
    },
  });
  if (!cfg.purchase_url) throw new Error("Whop did not return a checkout link");
  return {
    id: cfg.id,
    purchaseUrl: cfg.purchase_url,
    variantId: cfg.variant?.id || cfg.plan?.id || cfg.variant_id || null,
  };
}

export type WhopPayment = {
  id: string;
  status: string;
  paid_at?: string | null;
  metadata?: Record<string, unknown> | null;
  checkout_configuration_id?: string | null;
  total?: { amount?: string } | null;
};

export async function whopGetPayment(id: string): Promise<WhopPayment> {
  return whop<WhopPayment>(`/payments/${encodeURIComponent(id)}`);
}

/** Find a paid payment for a checkout we created (used when the redirect has no payment id). */
export async function whopFindPaidPayment(variantId: string): Promise<WhopPayment | null> {
  const q = new URLSearchParams({ variant_id: variantId, status: "paid", first: "5" });
  const accountId = process.env.WHOP_ACCOUNT_ID?.trim();
  if (accountId) q.set("account_id", accountId);
  const res = await whop<{ data?: WhopPayment[] }>(`/payments?${q}`);
  return res.data?.find((p) => p.status === "paid") || null;
}

/**
 * Apply a payment that was read back from Whop (never from a webhook body).
 * Returns where to send the buyer.
 */
export async function fulfillWhopPayment(
  payment: WhopPayment,
  hint: { projectId?: string | null } = {}
): Promise<{ ok: boolean; projectId?: string; beat?: boolean; reason?: string }> {
  const metaIn = (payment.metadata || {}) as Record<string, unknown>;
  const projectId = String(metaIn.project_id || hint.projectId || "");
  if (!projectId) return { ok: false, reason: "no_project" };
  if (payment.status !== "paid") return { ok: false, projectId, reason: "not_paid" };

  const service = createServiceClient();
  const { data: project } = await service
    .from("projects")
    .select("id, user_id, metadata")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) return { ok: false, projectId, reason: "project_missing" };

  const meta = { ...((project.metadata || {}) as Record<string, unknown>) };
  const pending = (meta.whop_pending || {}) as Record<string, unknown>;
  // The payment must belong to the checkout we opened for this project
  if (
    pending.checkout_id &&
    payment.checkout_configuration_id &&
    pending.checkout_id !== payment.checkout_configuration_id &&
    metaIn.project_id !== projectId
  ) {
    return { ok: false, projectId, reason: "mismatch" };
  }
  const expected = Number(pending.amount_usd);
  const paidTotal = Number(payment.total?.amount);
  if (Number.isFinite(expected) && expected > 0 && Number.isFinite(paidTotal) && paidTotal + 0.001 < expected) {
    return { ok: false, projectId, reason: "underpaid" };
  }

  const plan = String(metaIn.plan || pending.plan || "session");
  const interval = String(metaIn.interval || pending.interval || "month");
  const beat = plan === "beat" || metaIn.beat_only === true || metaIn.beat_only === "true";

  if (meta.whop_payment_id === payment.id) return { ok: true, projectId, beat };

  meta.whop_payment_id = payment.id;
  meta.payment_reference = payment.id;
  meta.paid_at = payment.paid_at || new Date().toISOString();
  if (Number.isFinite(paidTotal)) meta.amount_usd = paidTotal;

  if (beat) {
    meta.beat_download_unlocked = true;
    meta.beat_download_unlocked_at = new Date().toISOString();
    meta.beat_download_plan = "beat";
    delete meta.whop_pending;
    await service.from("projects").update({ metadata: meta }).eq("id", projectId);
    return { ok: true, projectId, beat: true };
  }

  meta.download_unlocked = true;
  meta.download_unlocked_at = new Date().toISOString();
  meta.download_plan = plan;
  if (plan === "creator" || plan === "band" || plan === "pro") {
    meta.subscription_plan = plan;
    meta.subscription_interval = interval;
    try {
      const { data: prof } = await service.from("profiles").select("metadata").eq("id", project.user_id).maybeSingle();
      const pm = { ...((prof?.metadata as Record<string, unknown>) || {}) };
      pm.subscription_plan = plan;
      pm.subscription_interval = interval;
      pm.subscription_updated_at = new Date().toISOString();
      await service.from("profiles").update({ metadata: pm }).eq("id", project.user_id);
    } catch (e) {
      console.warn("[whop] profile subscription stamp failed", e);
    }
    try {
      const granted = await fulfillCreditPackagePurchase({
        userId: String(project.user_id),
        planId: plan,
        reference: payment.id,
      });
      if (!granted.ok) console.warn("[whop] credit grant failed", granted.error);
    } catch (e) {
      console.warn("[whop] credit grant error", e);
    }
  }
  delete meta.whop_pending;
  await service.from("projects").update({ metadata: meta }).eq("id", projectId);
  return { ok: true, projectId, beat: false };
}
