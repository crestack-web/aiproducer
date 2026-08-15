"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";

const C = {
  bg: "#0B0A0F",
  bgDeep: "#050508",
  brass: "#E7A961",
  brassSoft: "rgba(231,169,97,0.15)",
  brassLine: "rgba(231,169,97,0.55)",
  text: "#F4F1EC",
  textMuted: "#9B96A3",
  textFaint: "#5C5866",
  border: "rgba(255,255,255,0.09)",
};

function IconHome({ size = 20, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5.5v-6h-3v6H5a1 1 0 0 1-1-1v-9.5Z"
        stroke={color}
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconStudio({ size = 20, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 3v10.5a3.5 3.5 0 1 1-2-3.175V3h2Z"
        stroke={color}
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M16 7v2.5a2.5 2.5 0 1 0 2-2.45V7h-2Z" stroke={color} strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

function IconLibrary({ size = 20, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="m16 6 4 14M12 6v14M8 8v12M4 4v16" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function IconProfile({ size = 20, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="8" r="3.5" stroke={color} strokeWidth="1.8" />
      <path d="M5 19.5c1.8-3.2 4.2-4.5 7-4.5s5.2 1.3 7 4.5" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export type AppNavKey = "home" | "studio" | "library" | "profile";

const NAV: { key: AppNavKey; label: string; href: string; Icon: typeof IconHome }[] = [
  { key: "home", label: "Home", href: "/app", Icon: IconHome },
  { key: "studio", label: "Studio", href: "/app/studio", Icon: IconStudio },
  { key: "library", label: "Library", href: "/app?tab=library", Icon: IconLibrary },
  { key: "profile", label: "Profile", href: "/app?tab=profile", Icon: IconProfile },
];

function resolveActive(pathname: string | null, search: string, forced?: AppNavKey): AppNavKey {
  if (forced) return forced;
  if (pathname?.startsWith("/app/studio") || pathname?.startsWith("/app/projects")) return "studio";
  if (pathname === "/app" || pathname === "/app/") {
    const tab = new URLSearchParams(search).get("tab");
    if (tab === "library") return "library";
    if (tab === "profile") return "profile";
    return "home";
  }
  return "home";
}

export function AppShell({
  children,
  active,
  userName,
  onSignOut,
}: {
  children: ReactNode;
  active?: AppNavKey;
  userName?: string;
  onSignOut?: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const search = typeof window !== "undefined" ? window.location.search : "";
  const current = resolveActive(pathname, search, active);
  const initials = (userName || "A")
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  function go(key: AppNavKey, href: string) {
    if (key === "home") router.push("/app");
    else if (key === "studio") router.push("/app/studio");
    else if (key === "library") router.push("/app?tab=library");
    else if (key === "profile") router.push("/app?tab=profile");
    else router.push(href);
  }

  return (
    <div style={S.shell}>
      <style>{`
        .studio-sidebar { display: flex; }
        .studio-bottom-nav { display: none; }
        @media (max-width: 899px) {
          .studio-sidebar { display: none !important; }
          .studio-bottom-nav { display: flex !important; }
          .studio-main-pad { padding-bottom: 96px !important; }
        }
      `}</style>

      <aside className="studio-sidebar" style={S.sidebar}>
        <div style={S.brand}>
          <img src="/logo.svg" alt="" width={18} height={18} style={{ borderRadius: 4, marginRight: 8, verticalAlign: "middle" }} />
          STUDIO
        </div>
        <nav style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }} aria-label="Main">
          {NAV.map(({ key, label, href, Icon }) => {
            const isActive = current === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => go(key, href)}
                style={{ ...S.navItem, ...(isActive ? S.navActive : {}) }}
                aria-current={isActive ? "page" : undefined}
              >
                <Icon size={18} color={isActive ? C.brass : C.textMuted} />
                {label}
              </button>
            );
          })}
        </nav>

        <div style={S.sideCard}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={S.avatar}>{initials}</div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {userName || "Artist"}
              </div>
              <button
                type="button"
                onClick={onSignOut}
                style={{ background: "none", border: "none", color: C.textFaint, fontSize: 11.5, padding: 0, cursor: "pointer", fontFamily: "inherit" }}
              >
                Sign out
              </button>
            </div>
          </div>
          <Link href="/app/studio" style={{ ...S.sideCta, display: "block", textAlign: "center", textDecoration: "none" }}>
            New session
          </Link>
        </div>
      </aside>

      <main style={S.main} className="studio-main-pad">
        {children}
      </main>

      <nav className="studio-bottom-nav" style={S.bottomNav} aria-label="Main">
        {NAV.map(({ key, label, href, Icon }) => {
          const isActive = current === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => go(key, href)}
              style={{
                ...S.bottomItem,
                color: isActive ? C.brass : C.textFaint,
                fontWeight: isActive ? 600 : 500,
              }}
              aria-current={isActive ? "page" : undefined}
            >
              <Icon size={22} color={isActive ? C.brass : C.textFaint} />
              {label}
            </button>
          );
        })}
      </nav>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  shell: {
    height: "100vh",
    maxHeight: "100dvh",
    display: "flex",
    background: C.bgDeep,
    color: C.text,
    fontFamily: "Inter, system-ui, sans-serif",
    overflow: "hidden",
  },
  sidebar: {
    width: 200,
    flexShrink: 0,
    height: "100%",
    display: "flex",
    flexDirection: "column",
    padding: "24px 12px 0",
    borderRight: "1px solid rgba(255,255,255,0.06)",
    background: C.bgDeep,
  },
  brand: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    letterSpacing: 2,
    color: C.brass,
    marginBottom: 28,
    paddingLeft: 10,
    opacity: 0.9,
    display: "flex",
    alignItems: "center",
  },
  navItem: {
    padding: "10px 12px",
    borderRadius: 10,
    fontSize: 14,
    fontWeight: 500,
    color: C.textMuted,
    border: "1px solid transparent",
    background: "transparent",
    textAlign: "left",
    cursor: "pointer",
    fontFamily: "inherit",
    width: "100%",
    display: "flex",
    alignItems: "center",
    gap: 10,
  },
  navActive: {
    background: C.brassSoft,
    border: `1px solid ${C.brassLine}`,
    color: C.brass,
    fontWeight: 600,
  },
  sideCard: {
    marginTop: "auto",
    padding: 12,
    borderRadius: 12,
    background: "rgba(255,255,255,0.03)",
    border: "1px solid rgba(255,255,255,0.06)",
    marginBottom: 12,
  },
  sideCta: {
    marginTop: 10,
    width: "100%",
    padding: "9px 12px",
    borderRadius: 10,
    border: "none",
    background: `linear-gradient(180deg, #F0BC80, ${C.brass})`,
    color: "#1A1208",
    fontWeight: 600,
    fontSize: 13,
    cursor: "pointer",
    fontFamily: "inherit",
    boxSizing: "border-box",
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 999,
    background: `linear-gradient(145deg, ${C.brass}, #6B3F17)`,
    color: "#1A1208",
    display: "grid",
    placeItems: "center",
    fontFamily: "Fraunces, Georgia, serif",
    fontSize: 13,
    fontWeight: 600,
    flexShrink: 0,
  },
  main: {
    flex: 1,
    minWidth: 0,
    height: "100%",
    overflowY: "auto",
    background: `linear-gradient(180deg, ${C.bg} 0%, ${C.bgDeep} 45%)`,
  },
  bottomNav: {
    position: "fixed",
    left: 0,
    right: 0,
    bottom: 0,
    height: 74,
    paddingBottom: "env(safe-area-inset-bottom)",
    background: "rgba(11,10,15,0.94)",
    backdropFilter: "blur(16px)",
    borderTop: `1px solid ${C.border}`,
    zIndex: 50,
    alignItems: "stretch",
    justifyContent: "space-around",
  },
  bottomItem: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    fontSize: 10.5,
    fontFamily: "inherit",
    background: "transparent",
    border: "none",
    cursor: "pointer",
    paddingBottom: 8,
  },
};
