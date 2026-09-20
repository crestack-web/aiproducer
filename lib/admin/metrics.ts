/**
 * Aggregate metrics for the internal admin dashboard.
 * Best-effort over existing tables — no new schema required.
 */

import { createServiceClient } from "@/lib/supabase/service";
import { SESSION_PRICE_USD, PLANS } from "@/lib/plans";

export type AdminMetrics = {
  generatedAt: string;
  users: {
    total: number;
    last7d: number;
    last30d: number;
    onboarded: number;
    paidPlans: { creator: number; pro: number; unknown: number };
  };
  activity: {
    projectsTotal: number;
    projectsLast7d: number;
    projectsLast30d: number;
    withBeat: number;
    recording: number;
    produced: number;
    beatsGeneratedCompleted: number;
    beatsGeneratedLast7d: number;
    songsReady: number;
  };
  revenue: {
    currencyNote: string;
    estimatedUsd: number;
    unlockedProjects: number;
    paidDownloadsLast30d: number;
    byPlan: Record<string, number>;
    recentPayments: Array<{
      projectId: string;
      plan: string;
      amountUsd: number | null;
      paidAt: string | null;
      reference: string | null;
    }>;
  };
  churn: {
    /** Users with any project, last activity > 30d ago */
    inactive30d: number;
    /** Users who signed up > 14d ago, never finished onboarding */
    neverOnboarded: number;
    /** Users with projects but no produce/complete in 30d */
    stalledProducers: number;
    note: string;
  };
};

function daysAgoIso(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}

function planPriceUsd(plan: string): number {
  const p = plan.toLowerCase();
  if (p === "session") return SESSION_PRICE_USD;
  const def = PLANS.find((x) => x.id === p);
  return def?.priceUsd ?? SESSION_PRICE_USD;
}

export async function collectAdminMetrics(): Promise<AdminMetrics> {
  const supabase = createServiceClient();
  const t7 = daysAgoIso(7);
  const t14 = daysAgoIso(14);
  const t30 = daysAgoIso(30);

  // --- Profiles / users ---
  const { data: profiles, count: profileCount } = await supabase
    .from("profiles")
    .select("id, created_at, onboarding_completed_at, subscription_plan, plan, metadata", {
      count: "exact",
    })
    .limit(2000);

  const profileRows = profiles || [];
  let usersTotal = profileCount ?? profileRows.length;

  // Prefer auth user count when available (service role)
  try {
    const { data: list } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1 });
    if (typeof list?.total === "number" && list.total > usersTotal) {
      usersTotal = list.total;
    }
  } catch {
    /* profiles only */
  }

  let last7 = 0;
  let last30 = 0;
  let onboarded = 0;
  const paidPlans = { creator: 0, pro: 0, unknown: 0 };
  for (const p of profileRows) {
    const created = (p as { created_at?: string }).created_at || "";
    if (created >= t7) last7 += 1;
    if (created >= t30) last30 += 1;
    if ((p as { onboarding_completed_at?: string | null }).onboarding_completed_at) onboarded += 1;
    const plan = String(
      (p as { subscription_plan?: string }).subscription_plan ||
        (p as { plan?: string }).plan ||
        ((p as { metadata?: Record<string, unknown> }).metadata || {}).subscription_plan ||
        ""
    ).toLowerCase();
    if (plan === "creator") paidPlans.creator += 1;
    else if (plan === "pro") paidPlans.pro += 1;
    else if (plan && plan !== "free" && plan !== "session") paidPlans.unknown += 1;
  }

  // --- Projects ---
  const { data: projects, count: projectCount } = await supabase
    .from("projects")
    .select("id, user_id, status, created_at, metadata, updated_at", { count: "exact" })
    .limit(3000);

  const projectRows = projects || [];
  let projectsLast7 = 0;
  let projectsLast30 = 0;
  let withBeat = 0;
  let recording = 0;
  let produced = 0;
  let unlocked = 0;
  let paidDownloads30 = 0;
  let estimatedUsd = 0;
  const byPlan: Record<string, number> = {};
  const recentPayments: AdminMetrics["revenue"]["recentPayments"] = [];

  const userLastActivity = new Map<string, string>();

  for (const row of projectRows) {
    const r = row as {
      id: string;
      user_id?: string;
      status?: string;
      created_at?: string;
      updated_at?: string;
      metadata?: Record<string, unknown>;
    };
    if (r.created_at && r.created_at >= t7) projectsLast7 += 1;
    if (r.created_at && r.created_at >= t30) projectsLast30 += 1;
    const st = String(r.status || "").toLowerCase();
    if (
      st === "beat_ready" ||
      st === "recording" ||
      st === "analyzing" ||
      st === "blueprint_ready" ||
      st === "complete" ||
      st === "completed" ||
      st === "produced" ||
      st === "mastering"
    ) {
      withBeat += 1;
    }
    if (st === "recording" || st === "blueprint_ready" || st === "analyzing") recording += 1;
    if (st === "complete" || st === "completed" || st === "produced" || st === "mastering") {
      produced += 1;
    }

    const uid = r.user_id || "";
    const act = r.updated_at || r.created_at || "";
    if (uid && act) {
      const prev = userLastActivity.get(uid);
      if (!prev || act > prev) userLastActivity.set(uid, act);
    }

    const meta = r.metadata || {};
    if (meta.download_unlocked === true) {
      unlocked += 1;
      const plan = String(meta.download_plan || meta.subscription_plan || "session");
      byPlan[plan] = (byPlan[plan] || 0) + 1;
      const paidAt = String(meta.paystack_paid_at || meta.download_unlocked_at || "") || null;
      if (paidAt && paidAt >= t30) paidDownloads30 += 1;

      let amountUsd: number | null = null;
      if (typeof meta.amount_usd === "number") amountUsd = meta.amount_usd;
      else if (typeof meta.paystack_amount_usd === "number") amountUsd = meta.paystack_amount_usd;
      else amountUsd = planPriceUsd(plan);

      estimatedUsd += amountUsd || 0;
      recentPayments.push({
        projectId: r.id,
        plan,
        amountUsd,
        paidAt,
        reference: meta.paystack_reference ? String(meta.paystack_reference) : null,
      });
    }
  }

  recentPayments.sort((a, b) => String(b.paidAt || "").localeCompare(String(a.paidAt || "")));
  const recentTop = recentPayments.slice(0, 15);

  // --- Music gen jobs ---
  let beatsCompleted = 0;
  let beatsLast7 = 0;
  try {
    const { count: bc } = await supabase
      .from("music_generation_jobs")
      .select("id", { count: "exact", head: true })
      .eq("status", "COMPLETED")
      .not("audio_path", "is", null);
    beatsCompleted = bc || 0;
    const { count: b7 } = await supabase
      .from("music_generation_jobs")
      .select("id", { count: "exact", head: true })
      .eq("status", "COMPLETED")
      .not("audio_path", "is", null)
      .gte("created_at", t7);
    beatsLast7 = b7 || 0;
  } catch {
    /* table may differ */
  }

  // --- Songs ---
  let songsReady = 0;
  try {
    const { count: sc } = await supabase
      .from("songs")
      .select("id", { count: "exact", head: true })
      .eq("status", "ready");
    songsReady = sc || 0;
  } catch {
    try {
      const { count: sc2 } = await supabase.from("songs").select("id", { count: "exact", head: true });
      songsReady = sc2 || 0;
    } catch {
      songsReady = 0;
    }
  }

  // --- Churn proxies ---
  let inactive30 = 0;
  for (const [, last] of userLastActivity) {
    if (last < t30) inactive30 += 1;
  }
  let neverOnboarded = 0;
  for (const p of profileRows) {
    const created = (p as { created_at?: string }).created_at || "";
    const onb = (p as { onboarding_completed_at?: string | null }).onboarding_completed_at;
    if (created && created < t14 && !onb) neverOnboarded += 1;
  }
  let stalled = 0;
  const usersWithProjects = new Set(
    projectRows.map((r) => (r as { user_id?: string }).user_id).filter(Boolean) as string[]
  );
  for (const uid of usersWithProjects) {
    const last = userLastActivity.get(uid);
    if (last && last < t30) stalled += 1;
  }

  return {
    generatedAt: new Date().toISOString(),
    users: {
      total: usersTotal,
      last7d: last7,
      last30d: last30,
      onboarded,
      paidPlans,
    },
    activity: {
      projectsTotal: projectCount ?? projectRows.length,
      projectsLast7d: projectsLast7,
      projectsLast30d: projectsLast30,
      withBeat,
      recording,
      produced,
      beatsGeneratedCompleted: beatsCompleted,
      beatsGeneratedLast7d: beatsLast7,
      songsReady,
    },
    revenue: {
      currencyNote:
        "Estimated USD from unlocked projects (plan list prices when Paystack amount not stored).",
      estimatedUsd: Math.round(estimatedUsd * 100) / 100,
      unlockedProjects: unlocked,
      paidDownloadsLast30d: paidDownloads30,
      byPlan,
      recentPayments: recentTop,
    },
    churn: {
      inactive30d: inactive30,
      neverOnboarded,
      stalledProducers: stalled,
      note: "Proxy metrics — not subscription-cancel churn. Based on project activity and onboarding.",
    },
  };
}
