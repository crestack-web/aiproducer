"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { CSSProperties, ReactNode } from "react";
import { STUDIO_LOGO_URL } from "@/lib/brand";
import { useTheme } from "@/lib/theme";
import { ThemeToggle } from "@/components/theme-toggle";

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
      <rect x="9" y="2" width="6" height="11" rx="3" stroke={color} strokeWidth="1.8" />
      <path d="M5 11a7 7 0 0 0 14 0" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
      <path d="M12 18v3M9 21h6" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
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
  const { colors: C, mode } = useTheme();
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

  const shell: CSSProperties = {
    display: "flex",
    minHeight: "100vh",
    height: "100dvh",
    background: C.bgDeep,
    color: C.text,
    fontFamily: "Inter, system-ui, sans-serif",
  };

  const sidebar: CSSProperties = {
    width: 232,
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    padding: "20px 14px 16px",
    borderRight: `1px solid ${C.border}`,
    background: mode === "light" ? C.surfaceRaised : C.bgDeep,
    boxShadow: mode === "light" ? "1px 0 0 rgba(55,40,22,0.04)" : "none",
  };

  const brandRow: CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginBottom: 28,
    paddingLeft: 6,
    paddingRight: 2,
  };

  const brand: CSSProperties = {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    letterSpacing: 2,
    color: C.brass,
    opacity: 0.95,
    display: "flex",
    alignItems: "center",
  };

  const navItem: CSSProperties = {
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
  };

  const navActive: CSSProperties = {
    background: C.brassSoft,
    border: `1px solid ${C.brassLine}`,
    color: C.brass,
    fontWeight: 600,
  };

  const sideCard: CSSProperties = {
    marginTop: "auto",
    padding: 12,
    borderRadius: 12,
    background: mode === "light" ? C.surface : "rgba(255,255,255,0.03)",
    border: `1px solid ${C.border}`,
    boxShadow: mode === "light" ? C.cardShadow : "none",
    marginBottom: 12,
  };

  const sideCta: CSSProperties = {
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
  };

  const avatar: CSSProperties = {
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
  };

  const main: CSSProperties = {
    flex: 1,
    minWidth: 0,
    height: "100%",
    overflowY: "auto",
    background:
      mode === "light"
        ? `radial-gradient(ellipse at 50% -20%, rgba(168,107,31,0.08), transparent 50%), linear-gradient(180deg, ${C.bg} 0%, ${C.bgDeep} 70%)`
        : `linear-gradient(180deg, ${C.bg} 0%, ${C.bgDeep} 45%)`,
    WebkitOverflowScrolling: "touch",
  };

  const mobileHeader: CSSProperties = {
    position: "sticky",
    top: 0,
    zIndex: 40,
    display: "none",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "10px 16px",
    paddingTop: "calc(10px + env(safe-area-inset-top, 0px))",
    borderBottom: `1px solid ${C.border}`,
    background: C.navGlass,
    backdropFilter: "blur(16px)",
  };

  const bottomNav: CSSProperties = {
    position: "fixed",
    left: 0,
    right: 0,
    bottom: 0,
    minHeight: 74,
    height: "auto",
    paddingTop: 8,
    paddingBottom: "calc(8px + env(safe-area-inset-bottom, 0px))",
    background: C.navGlass,
    backdropFilter: "blur(16px)",
    borderTop: `1px solid ${C.border}`,
    zIndex: 50,
    alignItems: "stretch",
    justifyContent: "space-around",
    boxSizing: "border-box",
  };

  const bottomItem: CSSProperties = {
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
    padding: "6px 0 4px",
    minHeight: 56,
  };

  return (
    <div style={shell}>
      <style>{`
        .studio-sidebar { display: flex; }
        .studio-bottom-nav { display: none; }
        .studio-mobile-header { display: none !important; }
        .studio-main-pad {
          padding-bottom: 32px;
          box-sizing: border-box;
        }
        .studio-main-pad::after {
          content: "";
          display: block;
          width: 100%;
          height: 0;
          pointer-events: none;
        }
        @media (max-width: 899px) {
          .studio-sidebar { display: none !important; }
          .studio-bottom-nav { display: flex !important; }
          .studio-main-pad {
            padding-bottom: calc(160px + env(safe-area-inset-bottom, 0px)) !important;
          }
          .studio-main-pad::after {
            height: 24px;
          }
        }
      `}</style>

      <aside className="studio-sidebar" style={sidebar}>
        <div style={brandRow}>
          <div style={brand}>
            <img
              src={STUDIO_LOGO_URL}
              alt="Studio"
              width={22}
              height={22}
              style={{ borderRadius: 6, marginRight: 8, verticalAlign: "middle", objectFit: "cover" }}
            />
            STUDIO
          </div>
          <ThemeToggle compact />
        </div>
        <nav style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }} aria-label="Main">
          {NAV.map(({ key, label, href, Icon }) => {
            const isActive = current === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => go(key, href)}
                style={{ ...navItem, ...(isActive ? navActive : {}) }}
                aria-current={isActive ? "page" : undefined}
              >
                <Icon size={18} color={isActive ? C.brass : C.textMuted} />
                {label}
              </button>
            );
          })}
        </nav>

        <div style={sideCard}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={avatar}>{initials}</div>
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  color: C.text,
                }}
              >
                {userName || "Artist"}
              </div>
              <button
                type="button"
                onClick={onSignOut}
                style={{
                  background: "none",
                  border: "none",
                  color: C.textFaint,
                  fontSize: 11.5,
                  padding: 0,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                Sign out
              </button>
            </div>
          </div>
          <Link href="/app/studio" style={{ ...sideCta, display: "block", textAlign: "center", textDecoration: "none" }}>
            New session
          </Link>
        </div>
      </aside>

      <main style={main} className="studio-main-pad">
        <div className="studio-mobile-header" style={mobileHeader}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <img
              src={STUDIO_LOGO_URL}
              alt=""
              width={22}
              height={22}
              style={{ borderRadius: 6, objectFit: "cover" }}
            />
            <span
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 11,
                letterSpacing: 2,
                color: C.brass,
              }}
            >
              STUDIO
            </span>
          </div>
          <ThemeToggle compact />
        </div>
        {children}
      </main>

      <nav className="studio-bottom-nav" style={bottomNav} aria-label="Main">
        {NAV.map(({ key, label, href, Icon }) => {
          const isActive = current === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => go(key, href)}
              style={{
                ...bottomItem,
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
