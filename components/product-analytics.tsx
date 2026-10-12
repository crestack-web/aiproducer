"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

const SESSION_KEY = "ap_analytics_sid";

function getSessionId(): string {
  if (typeof window === "undefined") return "";
  try {
    let sid = sessionStorage.getItem(SESSION_KEY);
    if (!sid) {
      sid =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `s_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      sessionStorage.setItem(SESSION_KEY, sid);
    }
    return sid;
  } catch {
    return `s_${Date.now()}`;
  }
}

export function trackProductEvent(
  event: string,
  meta?: Record<string, unknown>
): void {
  if (typeof window === "undefined") return;
  const path = window.location.pathname + window.location.search;
  const sessionId = getSessionId();
  const body = JSON.stringify({ event, path, sessionId, meta: meta || {} });
  try {
    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: "application/json" });
      navigator.sendBeacon("/api/analytics/track", blob);
      return;
    }
  } catch {
    /* fall through */
  }
  void fetch("/api/analytics/track", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => undefined);
}

/** Welcome page (/) — one view per mount. */
export function WelcomeAnalytics() {
  const sent = useRef(false);
  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    trackProductEvent("welcome_view");
  }, []);
  return null;
}

/** Authenticated app shell — track route changes as app usage. */
export function AppUsageAnalytics() {
  const pathname = usePathname();
  const last = useRef<string | null>(null);

  useEffect(() => {
    if (!pathname) return;
    if (last.current === pathname) return;
    last.current = pathname;
    const isApp =
      pathname.startsWith("/app") ||
      pathname.startsWith("/onboarding") ||
      pathname.startsWith("/booth");
    if (!isApp) return;
    trackProductEvent("app_view", { route: pathname });
  }, [pathname]);

  return null;
}
