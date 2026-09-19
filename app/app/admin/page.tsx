"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { useTheme } from "@/lib/theme";
import type { AdminMetrics } from "@/lib/admin/metrics";

function StatCard({
  label,
  value,
  sub,
  colors,
}: {
  label: string;
  value: string | number;
  sub?: string;
  colors: { surface: string; border: string; text: string; muted: string; brass: string };
}) {
  return (
    <div
      style={{
        padding: "16px 18px",
        borderRadius: 14,
        border: `1px solid ${colors.border}`,
        background: colors.surface,
        minWidth: 0,
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: colors.brass,
          marginBottom: 8,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 28, fontWeight: 800, color: colors.text, lineHeight: 1.1 }}>
        {value}
      </div>
      {sub ? (
        <div style={{ fontSize: 12, color: colors.muted, marginTop: 6, lineHeight: 1.35 }}>{sub}</div>
      ) : null}
    </div>
  );
}

export default function AdminDashboardPage() {
  const { colors: C } = useTheme();
  const [metrics, setMetrics] = useState<AdminMetrics | null>(null);
  const [adminEmail, setAdminEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const surface = C.surface || "rgba(255,255,255,0.05)";
  const border = C.border || "rgba(255,255,255,0.1)";
  const text = C.text || "#F4F1EC";
  const muted = C.textMuted || "#9B96A3";
  const brass = C.brass || "#E7A961";
  const palette = { surface, border, text, muted, brass };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/metrics", { cache: "no-store" });
      const j = await res.json().catch(() => ({}));
      if (res.status === 401) {
        setError("Sign in required.");
        setMetrics(null);
        return;
      }
      if (res.status === 403) {
        setError("Admin access required. Add your email to ADMIN_EMAILS on the server.");
        setMetrics(null);
        return;
      }
      if (!res.ok) throw new Error(j.error || "Failed to load metrics");
      setMetrics(j.metrics as AdminMetrics);
      setAdminEmail(typeof j.admin === "string" ? j.admin : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
      setMetrics(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <AppShell>
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "20px 16px 48px" }}>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 12,
            marginBottom: 20,
          }}
        >
          <div>
            <div
              style={{
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: brass,
                marginBottom: 6,
              }}
            >
              Internal
            </div>
            <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, color: text }}>Admin dashboard</h1>
            <p style={{ margin: "8px 0 0", fontSize: 14, color: muted, maxWidth: 520 }}>
              Users, revenue estimates, activity, and churn proxies for AP Studio.
              {adminEmail ? (
                <span>
                  {" "}
                  Signed in as <strong style={{ color: text }}>{adminEmail}</strong>.
                </span>
              ) : null}
            </p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              style={{
                height: 36,
                padding: "0 14px",
                borderRadius: 999,
                border: `1px solid ${border}`,
                background: surface,
                color: text,
                fontWeight: 700,
                fontSize: 13,
                cursor: loading ? "wait" : "pointer",
                fontFamily: "inherit",
              }}
            >
              {loading ? "Refreshing…" : "Refresh"}
            </button>
            <Link
              href="/app"
              style={{
                height: 36,
                padding: "0 14px",
                borderRadius: 999,
                border: `1px solid ${border}`,
                background: "transparent",
                color: muted,
                fontWeight: 600,
                fontSize: 13,
                display: "inline-flex",
                alignItems: "center",
                textDecoration: "none",
              }}
            >
              Library
            </Link>
          </div>
        </div>

        {error ? (
          <div
            style={{
              padding: 16,
              borderRadius: 14,
              border: "1px solid rgba(240,113,103,0.35)",
              background: "rgba(240,113,103,0.08)",
              color: "#F07167",
              fontSize: 14,
              marginBottom: 16,
            }}
          >
            {error}
          </div>
        ) : null}

        {loading && !metrics ? (
          <p style={{ color: muted }}>Loading metrics…</p>
        ) : null}

        {metrics ? (
          <>
            <p style={{ fontSize: 12, color: muted, marginBottom: 16 }}>
              Generated {new Date(metrics.generatedAt).toLocaleString()}
            </p>

            <h2 style={{ fontSize: 15, fontWeight: 800, color: text, margin: "0 0 12px" }}>Users</h2>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
                gap: 12,
                marginBottom: 28,
              }}
            >
              <StatCard label="Total users" value={metrics.users.total} colors={palette} />
              <StatCard label="New (7d)" value={metrics.users.last7d} colors={palette} />
              <StatCard label="New (30d)" value={metrics.users.last30d} colors={palette} />
              <StatCard label="Onboarded" value={metrics.users.onboarded} colors={palette} />
              <StatCard
                label="Creator"
                value={metrics.users.paidPlans.creator}
                sub="Active plan flag on profile"
                colors={palette}
              />
              <StatCard
                label="Pro"
                value={metrics.users.paidPlans.pro}
                sub="Active plan flag on profile"
                colors={palette}
              />
            </div>

            <h2 style={{ fontSize: 15, fontWeight: 800, color: text, margin: "0 0 12px" }}>
              Revenue (estimate)
            </h2>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
                gap: 12,
                marginBottom: 8,
              }}
            >
              <StatCard
                label="Est. revenue"
                value={`$${metrics.revenue.estimatedUsd.toFixed(2)}`}
                sub={metrics.revenue.currencyNote}
                colors={palette}
              />
              <StatCard
                label="Unlocked songs"
                value={metrics.revenue.unlockedProjects}
                colors={palette}
              />
              <StatCard
                label="Unlocks (30d)"
                value={metrics.revenue.paidDownloadsLast30d}
                colors={palette}
              />
            </div>
            {Object.keys(metrics.revenue.byPlan).length > 0 ? (
              <p style={{ fontSize: 13, color: muted, marginBottom: 16 }}>
                By plan:{" "}
                {Object.entries(metrics.revenue.byPlan)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join(" · ")}
              </p>
            ) : (
              <p style={{ fontSize: 13, color: muted, marginBottom: 16 }}>No paid unlocks yet.</p>
            )}

            {metrics.revenue.recentPayments.length > 0 ? (
              <div
                style={{
                  borderRadius: 14,
                  border: `1px solid ${border}`,
                  overflow: "hidden",
                  marginBottom: 28,
                }}
              >
                <div
                  style={{
                    padding: "10px 14px",
                    fontSize: 12,
                    fontWeight: 700,
                    color: brass,
                    borderBottom: `1px solid ${border}`,
                    background: surface,
                  }}
                >
                  Recent payments
                </div>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr style={{ color: muted, textAlign: "left" }}>
                        <th style={{ padding: "10px 14px", fontWeight: 600 }}>When</th>
                        <th style={{ padding: "10px 14px", fontWeight: 600 }}>Plan</th>
                        <th style={{ padding: "10px 14px", fontWeight: 600 }}>USD</th>
                        <th style={{ padding: "10px 14px", fontWeight: 600 }}>Project</th>
                      </tr>
                    </thead>
                    <tbody>
                      {metrics.revenue.recentPayments.map((p) => (
                        <tr key={p.projectId + (p.reference || "")} style={{ borderTop: `1px solid ${border}` }}>
                          <td style={{ padding: "10px 14px", color: text, whiteSpace: "nowrap" }}>
                            {p.paidAt ? new Date(p.paidAt).toLocaleString() : "—"}
                          </td>
                          <td style={{ padding: "10px 14px", color: text }}>{p.plan}</td>
                          <td style={{ padding: "10px 14px", color: text }}>
                            {p.amountUsd != null ? `$${p.amountUsd.toFixed(2)}` : "—"}
                          </td>
                          <td style={{ padding: "10px 14px" }}>
                            <Link
                              href={`/app/console/${p.projectId}`}
                              style={{ color: brass, fontWeight: 600, textDecoration: "none" }}
                            >
                              {p.projectId.slice(0, 8)}…
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}

            <h2 style={{ fontSize: 15, fontWeight: 800, color: text, margin: "0 0 12px" }}>
              Activity
            </h2>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
                gap: 12,
                marginBottom: 28,
              }}
            >
              <StatCard label="Projects" value={metrics.activity.projectsTotal} colors={palette} />
              <StatCard label="Projects (7d)" value={metrics.activity.projectsLast7d} colors={palette} />
              <StatCard label="With beat" value={metrics.activity.withBeat} colors={palette} />
              <StatCard label="Recording" value={metrics.activity.recording} colors={palette} />
              <StatCard label="Produced" value={metrics.activity.produced} colors={palette} />
              <StatCard
                label="Beats generated"
                value={metrics.activity.beatsGeneratedCompleted}
                sub={`${metrics.activity.beatsGeneratedLast7d} in last 7d`}
                colors={palette}
              />
              <StatCard label="Songs ready" value={metrics.activity.songsReady} colors={palette} />
            </div>

            <h2 style={{ fontSize: 15, fontWeight: 800, color: text, margin: "0 0 12px" }}>
              Churn proxies
            </h2>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
                gap: 12,
                marginBottom: 12,
              }}
            >
              <StatCard
                label="Inactive 30d"
                value={metrics.churn.inactive30d}
                sub="Had projects; last update > 30d"
                colors={palette}
              />
              <StatCard
                label="Never onboarded"
                value={metrics.churn.neverOnboarded}
                sub="Signed up > 14d ago, no onboarding"
                colors={palette}
              />
              <StatCard
                label="Stalled"
                value={metrics.churn.stalledProducers}
                sub="Has projects, quiet 30d+"
                colors={palette}
              />
            </div>
            <p style={{ fontSize: 12, color: muted, maxWidth: 640 }}>{metrics.churn.note}</p>
          </>
        ) : null}
      </div>
    </AppShell>
  );
}
