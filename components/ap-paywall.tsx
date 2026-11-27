"use client";

import React, { useState } from "react";
import { createPortal } from "react-dom";
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
  projectId?: string | null;
  /**
   * When false, hide the one-time “This song” session card (profile / plan upgrade).
   * When true (default), show it for song-download unlock flows.
   */
  showSessionUnlock?: boolean;
  /** Current AP Credits balance, shown in the header when known */
  creditBalance?: number | null;
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
  projectId: projectIdProp,
  showSessionUnlock = true,
  creditBalance,
  colors: C,
}: Props) {
  const [interval, setInterval] = useState<BillingInterval>("year");
  const [selected, setSelected] = useState<PlanId>(showSessionUnlock ? "session" : "creator");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const plans = showSessionUnlock ? PLANS : PLANS.filter((plan) => plan.id !== "session");

  async function ensureProjectId(): Promise<string> {
    if (projectIdProp) return projectIdProp;
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "AP Studio plan" }),
    });
    const j = (await res.json().catch(() => ({}))) as {
      project?: { id?: string };
      id?: string;
      error?: string;
    };
    if (!res.ok) throw new Error(j.error || "Could not start checkout");
    const id = j.project?.id || j.id;
    if (!id) throw new Error("Could not start checkout");
    return id;
  }

  async function continuePurchase() {
    setBusy(true);
    setError(null);
    try {
      const projectId = await ensureProjectId();
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
  const FONT = "inherit";
  const sheetBg = "#111113";
  const card = "#18181b";
  const line = "rgba(255,255,255,0.08)";
  const text = "#f4f4f5";
  const muted = "#a1a1aa";
  const selectedPlan = plans.find((p) => p.id === selected) || plans[0];
  const selectedPrice = selectedPlan ? planPriceLabel(selectedPlan, interval) : null;

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={showSessionUnlock ? "Unlock your song" : "Get AP Credits"}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 300,
        background: "rgba(0,0,0,0.6)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        animation: "apPwFade .2s ease-out",
        fontFamily: FONT,
      }}
      onClick={onClose}
    >
      <style>{`
        @keyframes apPwFade { from { opacity: 0 } to { opacity: 1 } }
        @keyframes apPwUp { from { transform: translateY(24px); opacity: .6 } to { transform: none; opacity: 1 } }
        .ap-pw-plan { transition: border-color .15s ease, background .15s ease; }
        .ap-pw-plan:active { transform: scale(.995); }
      `}</style>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 440,
          maxHeight: "92vh",
          overflowY: "auto",
          background: sheetBg,
          borderRadius: "24px 24px 0 0",
          padding: "10px 20px calc(24px + env(safe-area-inset-bottom, 0px))",
          borderTop: `1px solid ${line}`,
          color: text,
          boxShadow: "0 -16px 48px rgba(0,0,0,.5)",
          animation: "apPwUp .25s cubic-bezier(.2,.8,.2,1)",
        }}
      >
        <div style={{ width: 36, height: 4, borderRadius: 99, background: "rgba(255,255,255,0.18)", margin: "0 auto 16px" }} />

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <h2 style={{ fontSize: 22, fontWeight: 650, letterSpacing: -0.3, margin: 0, lineHeight: 1.25 }}>
              {showSessionUnlock ? "Unlock your song" : "Get more credits"}
            </h2>
            <p style={{ color: muted, fontSize: 14, margin: "6px 0 0", lineHeight: 1.45 }}>
              {showSessionUnlock
                ? songTitle
                  ? `Download “${songTitle}” or pick a credit pack.`
                  : "Download this song or pick a credit pack."
                : "One-time packs. Credits never expire."}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              flexShrink: 0,
              width: 32,
              height: 32,
              borderRadius: 999,
              border: "none",
              background: "rgba(255,255,255,0.08)",
              color: text,
              cursor: "pointer",
              display: "grid",
              placeItems: "center",
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>

        {creditBalance != null && (
          <div
            style={{
              marginTop: 16,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "12px 14px",
              borderRadius: 14,
              background: card,
              border: `1px solid ${line}`,
            }}
          >
            <span style={{ fontSize: 13, color: muted }}>Your balance</span>
            <span style={{ fontSize: 15, fontWeight: 650, display: "inline-flex", alignItems: "center", gap: 8 }}>
              <span aria-hidden style={{ width: 7, height: 7, borderRadius: 99, background: accent }} />
              {creditBalance.toLocaleString()} credits
            </span>
          </div>
        )}

        <div
          role="tablist"
          style={{
            display: "flex",
            background: card,
            borderRadius: 12,
            padding: 3,
            border: `1px solid ${line}`,
            margin: "16px 0 14px",
          }}
        >
          {(["month", "year"] as BillingInterval[]).map((iv) => (
            <button
              key={iv}
              type="button"
              role="tab"
              aria-selected={interval === iv}
              onClick={() => setInterval(iv)}
              style={{
                flex: 1,
                border: "none",
                borderRadius: 9,
                padding: "9px 12px",
                cursor: "pointer",
                fontWeight: 600,
                fontSize: 13.5,
                fontFamily: FONT,
                background: interval === iv ? "rgba(255,255,255,0.1)" : "transparent",
                color: interval === iv ? text : muted,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
              }}
            >
              {iv === "month" ? "Single pack" : "Annual"}
              {iv === "year" && <span style={{ fontSize: 11, fontWeight: 700, color: accent }}>−20%</span>}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {plans.map((plan) => {
            const price = planPriceLabel(plan, interval);
            const active = selected === plan.id;
            const highlights = plan.features.slice(0, 3);
            return (
              <button
                key={plan.id}
                type="button"
                className="ap-pw-plan"
                aria-pressed={active}
                onClick={() => setSelected(plan.id)}
                style={{
                  textAlign: "left",
                  borderRadius: 16,
                  padding: "14px 16px",
                  cursor: "pointer",
                  border: `1.5px solid ${active ? accent : line}`,
                  background: active ? "rgba(193,122,18,0.06)" : card,
                  color: text,
                  fontFamily: FONT,
                  width: "100%",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span
                    aria-hidden
                    style={{
                      flexShrink: 0,
                      width: 20,
                      height: 20,
                      borderRadius: 99,
                      border: `2px solid ${active ? accent : "rgba(255,255,255,0.25)"}`,
                      display: "grid",
                      placeItems: "center",
                    }}
                  >
                    {active && <span style={{ width: 10, height: 10, borderRadius: 99, background: accent }} />}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontWeight: 650, fontSize: 16 }}>{plan.name}</span>
                      {plan.badge && (plan.id === "creator" || plan.id === "band") && (
                        <span
                          style={{
                            fontSize: 10.5,
                            fontWeight: 650,
                            letterSpacing: 0.3,
                            textTransform: "uppercase",
                            padding: "3px 7px",
                            borderRadius: 6,
                            background: "rgba(255,255,255,0.08)",
                            color: muted,
                          }}
                        >
                          {plan.badge}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 12.5, color: muted, marginTop: 3 }}>
                      {plan.perSongHint || (plan.id === "session" ? "This song only" : "")}
                    </div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 17, letterSpacing: -0.2 }}>{price.primary}</div>
                    <div style={{ fontSize: 11.5, color: muted, marginTop: 2 }}>
                      {plan.id === "session" ? "one-time" : interval === "year" ? "per year" : "one-time"}
                    </div>
                  </div>
                </div>
                {active && (
                  <ul style={{ listStyle: "none", padding: "12px 0 0 32px", margin: "12px 0 0", borderTop: `1px solid ${line}`, display: "flex", flexDirection: "column", gap: 7 }}>
                    {highlights.map((f) => (
                      <li key={f} style={{ fontSize: 13, color: muted, display: "flex", gap: 8, alignItems: "flex-start" }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={text} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" style={{ marginTop: 2, flexShrink: 0 }}><path d="M5 12.5l4.5 4.5L19 7" /></svg>
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                )}
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
            padding: "15px 18px",
            border: "none",
            borderRadius: 14,
            fontWeight: 650,
            fontSize: 16,
            fontFamily: FONT,
            cursor: busy ? "wait" : "pointer",
            color: "#111113",
            background: accent,
            opacity: busy ? 0.7 : 1,
          }}
        >
          {busy
            ? "Working…"
            : selected === "session"
              ? `Unlock for ${selectedPrice?.primary ?? ""}`
              : `Continue · ${selectedPrice?.primary ?? ""}`}
        </button>

        <p style={{ textAlign: "center", fontSize: 12, color: muted, marginTop: 12 }}>
          {showSessionUnlock
            ? "Preview stays free. Download unlocks after purchase."
            : "Secure checkout with Paystack."}
        </p>
      </div>
    </div>,
    document.body
  );
}
