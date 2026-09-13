/**
 * Paystack helpers — amounts are in the currency's smallest unit (kobo / cents).
 */

import { PLANS, SESSION_PRICE_USD, type PlanId, type BillingInterval } from "@/lib/plans";

export function paystackSecret(): string | null {
  return process.env.PAYSTACK_SECRET_KEY?.trim() || null;
}

export function paystackPublic(): string | null {
  return process.env.PAYSTACK_PUBLIC_KEY?.trim() || null;
}

/** ISO currency — default NGN (Paystack primary). Override with PAYSTACK_CURRENCY=USD if enabled on account. */
export function paystackCurrency(): string {
  return (process.env.PAYSTACK_CURRENCY || "NGN").trim().toUpperCase();
}

/**
 * USD → charge currency major units.
 * NGN rate from PAYSTACK_USD_NGN_RATE (default 1600).
 */
export function usdToChargeMajor(usd: number): number {
  const currency = paystackCurrency();
  if (currency === "USD") return usd;
  const rate = Number(process.env.PAYSTACK_USD_NGN_RATE || "1600");
  return Math.round(usd * rate * 100) / 100;
}

/** Amount in smallest unit for Paystack `amount` field. */
export function toPaystackAmount(major: number, currency: string): number {
  // Most Paystack currencies use 2 decimal subunits
  return Math.round(major * 100);
}

export function planChargeUsd(plan: PlanId, interval: BillingInterval): number {
  const def = PLANS.find((p) => p.id === plan);
  if (!def) return SESSION_PRICE_USD;
  if (plan === "session") return def.priceUsd;
  if (interval === "year" && def.priceUsdYear) return def.priceUsdYear;
  return def.priceUsd;
}

export async function paystackInitialize(opts: {
  email: string;
  amountMinor: number;
  currency: string;
  callbackUrl: string;
  reference: string;
  metadata: Record<string, unknown>;
}): Promise<{ authorization_url: string; access_code: string; reference: string }> {
  const secret = paystackSecret();
  if (!secret) throw new Error("PAYSTACK_SECRET_KEY is not set");

  const res = await fetch("https://api.paystack.co/transaction/initialize", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: opts.email,
      amount: opts.amountMinor,
      currency: opts.currency,
      callback_url: opts.callbackUrl,
      reference: opts.reference,
      metadata: opts.metadata,
    }),
  });

  const json = (await res.json()) as {
    status?: boolean;
    message?: string;
    data?: { authorization_url: string; access_code: string; reference: string };
  };

  if (!res.ok || !json.status || !json.data?.authorization_url) {
    throw new Error(json.message || "Paystack initialize failed");
  }

  return json.data;
}

export async function paystackVerify(reference: string): Promise<{
  status: string;
  amount: number;
  currency: string;
  metadata: Record<string, unknown>;
  paid_at?: string;
}> {
  const secret = paystackSecret();
  if (!secret) throw new Error("PAYSTACK_SECRET_KEY is not set");

  const res = await fetch(
    `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
    {
      headers: { Authorization: `Bearer ${secret}` },
    }
  );

  const json = (await res.json()) as {
    status?: boolean;
    message?: string;
    data?: {
      status: string;
      amount: number;
      currency: string;
      metadata?: Record<string, unknown>;
      paid_at?: string;
    };
  };

  if (!res.ok || !json.status || !json.data) {
    throw new Error(json.message || "Paystack verify failed");
  }

  return {
    status: json.data.status,
    amount: json.data.amount,
    currency: json.data.currency,
    metadata: (json.data.metadata || {}) as Record<string, unknown>,
    paid_at: json.data.paid_at,
  };
}
