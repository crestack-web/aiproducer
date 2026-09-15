"use client";

import { useCallback, useEffect, useState } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

/**
 * Desktop install affordance for Studio as a downloadable web app.
 * Shows when Chromium fires beforeinstallprompt; hidden when already installed.
 */
export function PwaInstallButton({ compact = false }: { compact?: boolean }) {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 900px)");
    const syncDesktop = () => setIsDesktop(mq.matches);
    syncDesktop();
    mq.addEventListener("change", syncDesktop);

    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      // @ts-expect-error iOS
      Boolean(window.navigator.standalone);
    setInstalled(standalone);

    const onBip = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
    };
    window.addEventListener("beforeinstallprompt", onBip);
    window.addEventListener("appinstalled", onInstalled);

    // Register SW once (needed for installability)
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }

    return () => {
      mq.removeEventListener("change", syncDesktop);
      window.removeEventListener("beforeinstallprompt", onBip);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const install = useCallback(async () => {
    if (!deferred) return;
    await deferred.prompt();
    try {
      await deferred.userChoice;
    } catch {
      /* ignore */
    }
    setDeferred(null);
  }, [deferred]);

  if (installed || !isDesktop || !deferred) return null;

  return (
    <button
      type="button"
      onClick={() => void install()}
      title="Install Studio on this computer"
      aria-label="Install Studio as a desktop app"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: compact ? 0 : 6,
        padding: compact ? "6px 10px" : "7px 12px",
        borderRadius: 999,
        border: "1px solid rgba(201, 162, 39, 0.45)",
        background: "rgba(201, 162, 39, 0.12)",
        color: "var(--studio-brass, #c9a227)",
        fontSize: compact ? 11 : 12.5,
        fontWeight: 600,
        fontFamily: "inherit",
        cursor: "pointer",
        letterSpacing: 0.02,
        whiteSpace: "nowrap",
      }}
    >
      {compact ? "Install" : "Install app"}
    </button>
  );
}

/** Registers the service worker on any page (welcome + app). */
export function PwaRegister() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }, []);
  return null;
}
