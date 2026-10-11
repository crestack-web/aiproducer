/**
 * Server-side AP Credits wallet — grant / spend with idempotency.
 */
import { createServiceClient } from "@/lib/supabase/service";
import { creditsForPackage, isCreditPackagePlan } from "@/lib/credits/catalog";

export type LedgerType =
  | "purchase"
  | "song_path"
  | "download_redeem"
  | "beat"
  | "produce"
  | "refund"
  | "promo"
  | "admin";

export type WalletSnapshot = {
  balance: number;
  lifetimePurchased: number;
  lifetimeSpent: number;
};

async function ensureWallet(
  service: ReturnType<typeof createServiceClient>,
  userId: string
): Promise<WalletSnapshot> {
  const { data } = await service
    .from("credit_wallets")
    .select("balance, lifetime_purchased, lifetime_spent")
    .eq("user_id", userId)
    .maybeSingle();

  if (data) {
    return {
      balance: Number(data.balance) || 0,
      lifetimePurchased: Number(data.lifetime_purchased) || 0,
      lifetimeSpent: Number(data.lifetime_spent) || 0,
    };
  }

  const { error } = await service.from("credit_wallets").insert({
    user_id: userId,
    balance: 0,
    lifetime_purchased: 0,
    lifetime_spent: 0,
  });
  if (error && !/duplicate|unique/i.test(error.message)) {
    console.warn("[credits] ensureWallet", error.message);
  }
  return { balance: 0, lifetimePurchased: 0, lifetimeSpent: 0 };
}

export async function getCreditWallet(userId: string): Promise<WalletSnapshot> {
  const service = createServiceClient();
  return ensureWallet(service, userId);
}

export async function listCreditLedger(
  userId: string,
  limit = 30
): Promise<
  Array<{
    id: string;
    amount: number;
    balanceAfter: number;
    entryType: string;
    reference: string | null;
    note: string | null;
    createdAt: string;
  }>
> {
  const service = createServiceClient();
  const { data, error } = await service
    .from("credit_ledger")
    .select("id, amount, balance_after, entry_type, reference, note, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.warn("[credits] listLedger", error.message);
    return [];
  }
  return (data || []).map((row) => ({
    id: String(row.id),
    amount: Number(row.amount) || 0,
    balanceAfter: Number(row.balance_after) || 0,
    entryType: String(row.entry_type),
    reference: row.reference ? String(row.reference) : null,
    note: row.note ? String(row.note) : null,
    createdAt: String(row.created_at),
  }));
}

/**
 * Credit a purchase once per idempotency key (Paystack reference).
 */
export async function grantCredits(opts: {
  userId: string;
  amount: number;
  idempotencyKey: string;
  entryType?: LedgerType;
  reference?: string;
  note?: string;
  metadata?: Record<string, unknown>;
}): Promise<{ ok: true; balance: number; alreadyApplied: boolean } | { ok: false; error: string }> {
  const amount = Math.floor(opts.amount);
  if (!opts.userId || amount <= 0) return { ok: false, error: "invalid_grant" };

  const service = createServiceClient();
  await ensureWallet(service, opts.userId);

  const { data: existing } = await service
    .from("credit_ledger")
    .select("id, balance_after")
    .eq("idempotency_key", opts.idempotencyKey)
    .maybeSingle();
  if (existing) {
    const w = await ensureWallet(service, opts.userId);
    return { ok: true, balance: w.balance, alreadyApplied: true };
  }

  const current = await ensureWallet(service, opts.userId);
  const nextBal = current.balance + amount;

  const { error: ledErr } = await service.from("credit_ledger").insert({
    user_id: opts.userId,
    amount,
    balance_after: nextBal,
    entry_type: opts.entryType || "purchase",
    idempotency_key: opts.idempotencyKey,
    reference: opts.reference || null,
    note: opts.note || null,
    metadata: opts.metadata || {},
  });
  if (ledErr) {
    if (/unique|duplicate/i.test(ledErr.message)) {
      const w = await ensureWallet(service, opts.userId);
      return { ok: true, balance: w.balance, alreadyApplied: true };
    }
    return { ok: false, error: ledErr.message };
  }

  const { error: upErr } = await service
    .from("credit_wallets")
    .update({
      balance: nextBal,
      lifetime_purchased: current.lifetimePurchased + amount,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", opts.userId);

  if (upErr) return { ok: false, error: upErr.message };
  return { ok: true, balance: nextBal, alreadyApplied: false };
}

/**
 * Spend credits once per idempotency key. Fails if insufficient balance.
 */
export async function spendCredits(opts: {
  userId: string;
  amount: number;
  idempotencyKey: string;
  entryType: LedgerType;
  reference?: string;
  projectId?: string;
  jobId?: string;
  note?: string;
  metadata?: Record<string, unknown>;
}): Promise<
  | { ok: true; balance: number; alreadyApplied: boolean }
  | { ok: false; error: string; balance?: number }
> {
  const amount = Math.floor(opts.amount);
  if (!opts.userId || amount <= 0) return { ok: false, error: "invalid_spend" };

  const service = createServiceClient();
  await ensureWallet(service, opts.userId);

  const { data: existing } = await service
    .from("credit_ledger")
    .select("id, balance_after")
    .eq("idempotency_key", opts.idempotencyKey)
    .maybeSingle();
  if (existing) {
    const w = await ensureWallet(service, opts.userId);
    return { ok: true, balance: w.balance, alreadyApplied: true };
  }

  const current = await ensureWallet(service, opts.userId);
  if (current.balance < amount) {
    return { ok: false, error: "insufficient_credits", balance: current.balance };
  }
  const nextBal = current.balance - amount;

  const { error: ledErr } = await service.from("credit_ledger").insert({
    user_id: opts.userId,
    amount: -amount,
    balance_after: nextBal,
    entry_type: opts.entryType,
    idempotency_key: opts.idempotencyKey,
    reference: opts.reference || null,
    project_id: opts.projectId || null,
    job_id: opts.jobId || null,
    note: opts.note || null,
    metadata: opts.metadata || {},
  });
  if (ledErr) {
    if (/unique|duplicate/i.test(ledErr.message)) {
      const w = await ensureWallet(service, opts.userId);
      return { ok: true, balance: w.balance, alreadyApplied: true };
    }
    return { ok: false, error: ledErr.message };
  }

  const { error: upErr } = await service
    .from("credit_wallets")
    .update({
      balance: nextBal,
      lifetime_spent: current.lifetimeSpent + amount,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", opts.userId)
    .gte("balance", amount);

  if (upErr) return { ok: false, error: upErr.message };
  return { ok: true, balance: nextBal, alreadyApplied: false };
}

/** After verified Paystack payment for a package plan */
export async function fulfillCreditPackagePurchase(opts: {
  userId: string;
  planId: string;
  paystackReference: string;
}): Promise<{ ok: boolean; credits?: number; balance?: number; error?: string }> {
  if (!isCreditPackagePlan(opts.planId)) {
    return { ok: false, error: "not_a_credit_package" };
  }
  const credits = creditsForPackage(opts.planId);
  if (credits <= 0) return { ok: false, error: "zero_credits" };

  const result = await grantCredits({
    userId: opts.userId,
    amount: credits,
    idempotencyKey: `paystack:${opts.paystackReference}`,
    entryType: "purchase",
    reference: opts.paystackReference,
    note: `Credit package ${opts.planId}`,
    metadata: { plan_id: opts.planId, credits },
  });
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, credits, balance: result.balance };
}
