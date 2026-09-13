"use client";

import React, { useState } from "react";
import {
  PLANS,
  planPriceLabel,
  type BillingInterval,
  type PlanId,
} from "@/lib/plans";

type Props = {
  open: boolean;
  onClose: () => void;
  songTitle?: string | null;
  /** Called after successful unlock / checkout redirect handled */
  onUnlocked?: () => void;
  projectId: string;
  colors: {
    text: string;
    textMuted: string;
    surface: string;
    border: string;
    accent?: string;
    bg?: string;
  };
};

export function ApPaywall({
  open,
  onClose,
  songTitle,
  onUnlocked,
  projectId,
  colors: C,
}: Props) {
  const [interval, setInterval] = useState<BillingInterval>("year");
  const [selected, setSelected] = useState<PlanId>("session");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  async function continuePurchase() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: selected, interval }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "Checkout failed");

      if (j.checkoutUrl) {
        window.location.href = j.checkoutUrl as string;
        return;
      }
      // Session unlock without external redirect (configured server-side)
      if (j.unlocked) {
        onUnlocked?.();
        onClose();
        return;
      }
      throw new Error(j.message || "Unable to start checkout");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Checkout failed");
    } finally {
      setBusy(false);
    }
  }

  const accent = C.accent || "#c17a12";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Unlock your song"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(0,0,0,.72)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        padding: 0,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 440,
          maxHeight: "92vh",
          overflowY: "auto",
          background: C.bg || "#0c0c0e",
          borderRadius: "24px 24px 0 0",
          padding: "20px 20px 28px",
          border: `1px solid ${C.border}`,
          color: C.text,
          boxShadow: "0 -12px 40px rgba(0,0,0,.45)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 13, color: C.textMuted }}>Upgrade to unlock</div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              width: 36,
              height: 36,
              borderRadius: 999,
              border: `1px solid ${C.border}`,
              background: C.surface,
              color: C.text,
              cursor: "pointer",
              fontSize: 18,
            }}
          >
            ×
          </button>
        </div>

        <h2
          style={{
            fontFamily: "Georgia, 'Times New Roman', serif",
            fontSize: "1.75rem",
            fontWeight: 500,
            textAlign: "center",
            margin: "12px 0 6px",
            lineHeight: 1.2,
          }}
        >
          Do more with AP
        </h2>
        <p style={{ textAlign: "center", color: C.textMuted, fontSize: 14, margin: "0 0 16px" }}>
          {songTitle
            ? `You heard it — unlock “${songTitle}” to download.`
            : "You heard the master — unlock download or go unlimited."}
        </p>

        {/* Monthly / Annual toggle — subscriptions only */}
        <div
          style={{
            display: "flex",
            position: "relative",
            background: C.surface,
            borderRadius: 999,
            padding: 4,
            border: `1px solid ${C.border}`,
            marginBottom: 16,
          }}
        >
          {(["month", "year"] as BillingInterval[]).map((iv) => (
            <button
              key={iv}
              type="button"
              onClick={() => setInterval(iv)}
              style={{
                flex: 1,
                border: "none",
                borderRadius: 999,
                padding: "10px 12px",
                cursor: "pointer",
                fontWeight: 600,
                fontSize: 14,
                background: interval === iv ? C.bg || "#1a1a1e" : "transparent",
                color: interval === iv ? C.text : C.textMuted,
                boxShadow: interval === iv ? `0 0 0 1px ${C.border}` : "none",
              }}
            >
              {iv === "month" ? "Monthly" : "Annual"}
            </button>
          ))}
          {interval === "year" && (
            <span
              style={{
                position: "absolute",
                top: -10,
                right: 28,
                background: "#e91e8c",
                color: "#fff",
                fontSize: 10,
                fontWeight: 700,
                padding: "3px 8px",
                borderRadius: 6,
                letterSpacing: 0.3,
              }}
            >
              SAVE 20%
            </span>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {PLANS.map((plan) => {
            const price = planPriceLabel(plan, interval);
            const active = selected === plan.id;
            return (
              <button
                key={plan.id}
                type="button"
                onClick={() => setSelected(plan.id)}
                style={{
                  textAlign: "left",
                  borderRadius: 16,
                  padding: "14px 16px",
                  cursor: "pointer",
                  border: active ? `2px solid ${accent}` : `1px solid ${C.border}`,
                  background: active ? "rgba(193,122,18,0.08)" : C.surface,
                  color: C.text,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 16 }}>{plan.name}</div>
                    {plan.badge && (
                      <div
                        style={{
                          marginTop: 4,
                          fontSize: 12,
                          color: plan.id === "pro" ? "#e8c547" : plan.id === "creator" ? "#3dd68c" : accent,
                          fontWeight: 600,
                        }}
                      >
                        {plan.id === "pro" ? "♔ " : plan.id === "creator" ? "♥ " : "◆ "}
                        {plan.badge}
                      </div>
                    )}
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>{price.primary}</div>
                    {price.secondary && (
                      <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>{price.secondary}</div>
                    )}
                  </div>
                </div>
                <ul
                  style={{
                    listStyle: "none",
                    padding: 0,
                    margin: "12px 0 0",
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                  }}
                >
                  {plan.features.map((f) => (
                    <li key={f} style={{ fontSize: 13, color: C.textMuted, display: "flex", gap: 8 }}>
                      <span style={{ color: accent }}>✓</span>
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              </button>
            );
          })}
        </div>

        {error && (
          <p style={{ color: "#f87171", fontSize: 13, marginTop: 12, textAlign: "center" }}>{error}</p>
        )}

        <button
          type="button"
          disabled={busy}
          onClick={() => void continuePurchase()}
          style={{
            width: "100%",
            marginTop: 18,
            padding: "16px 18px",
            border: "none",
            borderRadius: 999,
            fontWeight: 700,
            fontSize: 16,
            cursor: busy ? "wait" : "pointer",
            color: "#fff",
            background: "linear-gradient(90deg, #f5a623 0%, #e91e63 55%, #c2185b 100%)",
            boxShadow: "0 8px 24px rgba(233,30,99,0.35)",
          }}
        >
          {busy
            ? "Working…"
            : selected === "session"
              ? "Unlock this song"
              : "Continue"}
        </button>

        <p style={{ textAlign: "center", fontSize: 11, color: C.textMuted, marginTop: 12 }}>
          Preview stays free. Download unlocks after purchase.
        </p>
      </div>
    </div>
  );
}
