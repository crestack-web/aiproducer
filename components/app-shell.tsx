"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { STUDIO_LOGO_URL } from "@/lib/brand";
import { useTheme } from "@/lib/theme";
import { ThemeToggle } from "@/components/theme-toggle";
import { PwaInstallButton } from "@/components/pwa-install";
import { ProductTour, useProductTour } from "@/components/product-tour";

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
      <rect x="3" y="6" width="18" height="12" rx="2" stroke={color} strokeWidth="1.8" />
      <path d="M7 10h4M7 14h6" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function IconBooth({ size = 20, color = "currentColor" }: { size?: number; color?: string }) {
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
  const tour = useProductTour(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return sessionStorage.getItem("app_sidebar_collapsed") === "1";
    } catch {
      return false;
    }
  });
  const toggleSidebar = () => {
    setSidebarCollapsed((c) => {
      const next = !c;
      try {
        sessionStorage.setItem("app_sidebar_collapsed", next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  // Allow any page to open the tour: tour.start() via custom event or ?tour=1
  useEffect(() => {
    function onStart() {
      tour.start();
    }
    window.addEventListener("studio-tour-start", onStart);
    return () => window.removeEventListener("studio-tour-start", onStart);
  }, [tour.start]);
  const search = typeof window !== "undefined" ? window.location.search : "";
  const current = resolveActive(pathname, search, active);
  const projectPathMatch = pathname.match(/\/app\/(studio|console)\/([^/]+)/);
  const projectIdFromPath = projectPathMatch?.[2] || null;
  const onBoothPage = projectPathMatch?.[1] === "studio";
  const onStudioPage = projectPathMatch?.[1] === "console";
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
    width: sidebarCollapsed ? 72 : 248,
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    padding: sidebarCollapsed ? "16px 8px 16px" : "20px 14px 16px",
    borderRight: `1px solid ${C.border}`,
    background: mode === "light" ? C.surfaceRaised : C.bgDeep,
    boxShadow: mode === "light" ? "1px 0 0 rgba(55,40,22,0.04)" : "none",
    transition: "width 0.18s ease, padding 0.18s ease",
    overflow: "hidden",
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
    display: "flex",
    alignItems: "center",
    gap: 10,
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
        ? `radial-gradient(ellipse at 50% -15%, rgba(10,143,122,0.12), transparent 48%), radial-gradient(ellipse at 100% 0%, rgba(196,120,32,0.10), transparent 42%), linear-gradient(180deg, ${C.bg} 0%, ${C.bgDeep} 75%)`
        : `linear-gradient(180deg, ${C.bg} 0%, ${C.bgDeep} 45%)`,
    WebkitOverflowScrolling: "touch",
  };

  const mobileAppBar: CSSProperties = {
    /* Visibility controlled by .studio-mobile-appbar CSS (hidden on desktop). */
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    minHeight: 52,
    padding: "8px 14px",
    paddingTop: "calc(8px + env(safe-area-inset-top, 0px))",
    borderBottom: `1px solid ${C.border}`,
    background: mode === "light" ? (C.surfaceRaised || C.bg || "#F7F1E8") : (C.bgDeep || C.bg || "#0B0A0F"),
    boxSizing: "border-box",
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
        .studio-mobile-appbar { display: none; }
        .studio-main-pad {
          padding-bottom: 40px;
          box-sizing: border-box;
        }
        @media (min-width:900px) {
          .studio-main-pad {
            padding: 28px 32px 48px;
            max-width: 1200px;
            margin: 0 auto;
            width: 100%;
          }
        }
        @media (min-width:1280px) {
          .studio-main-pad {
            padding: 32px 40px 56px;
            max-width: 1280px;
          }
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
          .studio-bottom-nav {
            display: flex !important;
            position: fixed !important;
            left: 0 !important;
            right: 0 !important;
            bottom: 0 !important;
            z-index: 55 !important;
          }
          .studio-mobile-appbar {
            display: flex !important;
            visibility: visible !important;
            opacity: 1 !important;
            position: fixed !important;
            top: 0 !important;
            left: 0 !important;
            right: 0 !important;
            z-index: 60 !important;
            width: 100% !important;
            transform: none !important;
          }
          .studio-main-pad {
            padding-top: calc(52px + env(safe-area-inset-top, 0px) + 8px) !important;
            padding-bottom: calc(96px + env(safe-area-inset-bottom, 0px)) !important;
          }
          .studio-main-pad::after {
            height: 16px;
          }
        }
      `}</style>

      <aside className="studio-sidebar" style={sidebar}>
        <div style={{ ...brandRow, justifyContent: sidebarCollapsed ? "center" : "space-between", marginBottom: sidebarCollapsed ? 16 : 28 }}>
          <div style={{ ...brand, gap: 8 }}>
            <img
              src={STUDIO_LOGO_URL}
              alt="Studio"
              width={sidebarCollapsed ? 28 : 22}
              height={sidebarCollapsed ? 28 : 22}
              style={{ borderRadius: 6, marginRight: sidebarCollapsed ? 0 : 8, verticalAlign: "middle", objectFit: "cover" }}
            />
            {!sidebarCollapsed && <span>STUDIO</span>}
          </div>
          {!sidebarCollapsed && (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <PwaInstallButton compact />
              <ThemeToggle compact />
              <button
                type="button"
                onClick={toggleSidebar}
                aria-label="Collapse sidebar"
                title="Collapse sidebar"
                style={{
                  background: "none",
                  border: `1px solid ${C.border}`,
                  borderRadius: 8,
                  color: C.textMuted,
                  width: 28,
                  height: 28,
                  cursor: "pointer",
                  fontSize: 14,
                  lineHeight: 1,
                }}
              >
                «
              </button>
            </div>
          )}
        </div>
        {sidebarCollapsed && (
          <button
            type="button"
            onClick={toggleSidebar}
            aria-label="Expand sidebar"
            title="Expand sidebar"
            style={{
              background: "none",
              border: `1px solid ${C.border}`,
              borderRadius: 8,
              color: C.textMuted,
              width: "100%",
              height: 32,
              cursor: "pointer",
              marginBottom: 12,
              fontSize: 14,
            }}
          >
            »
          </button>
        )}
        <nav style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }} aria-label="Main">
          {NAV.map(({ key, label, href, Icon }) => {
            const isActive = current === key;
            return (
              <button
                key={key}
                type="button"
                data-tour-nav={key}
                onClick={() => go(key, href)}
                title={label}
                style={{
                  ...navItem,
                  ...(isActive ? navActive : {}),
                  justifyContent: sidebarCollapsed ? "center" : "flex-start",
                  padding: sidebarCollapsed ? "12px 8px" : navItem.padding,
                }}
                aria-current={isActive ? "page" : undefined}
              >
                <Icon size={18} color={isActive ? C.brass : C.textMuted} />
                {!sidebarCollapsed && label}
              </button>
            );
          })}
        </nav>

        {projectIdFromPath && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 4,
              marginTop: 12,
              marginBottom: 12,
              paddingTop: 12,
              borderTop: `1px solid ${C.border}`,
            }}
          >
            {!sidebarCollapsed && (
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                  color: C.textFaint,
                  padding: "0 8px 4px",
                }}
              >
                THIS SONG
              </div>
            )}
            <button
              type="button"
              title="Booth — record vocals"
              onClick={() => router.push(`/app/studio/${projectIdFromPath}`)}
              style={{
                ...navItem,
                ...(onBoothPage ? navActive : {}),
                justifyContent: sidebarCollapsed ? "center" : "flex-start",
                padding: sidebarCollapsed ? "12px 8px" : navItem.padding,
                gap: 10,
              }}
            >
              <IconBooth size={18} color={onBoothPage ? C.brass : C.textMuted} />
              {!sidebarCollapsed && "Booth"}
            </button>
            <button
              type="button"
              title="Studio — timeline / mix"
              onClick={() => router.push(`/app/console/${projectIdFromPath}`)}
              style={{
                ...navItem,
                ...(onStudioPage ? navActive : {}),
                justifyContent: sidebarCollapsed ? "center" : "flex-start",
                padding: sidebarCollapsed ? "12px 8px" : navItem.padding,
                gap: 10,
              }}
            >
              <IconStudio size={18} color={onStudioPage ? C.brass : C.textMuted} />
              {!sidebarCollapsed && "Studio"}
            </button>
          </div>
        )}

        <div style={{ ...sideCard, padding: sidebarCollapsed ? 8 : 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: sidebarCollapsed ? "center" : "flex-start" }}>
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
            New session (Booth)
          </Link>
          <Link
            href="/app/studio?mode=console"
            style={{
              ...sideCta,
              display: "block",
              textAlign: "center",
              textDecoration: "none",
              marginTop: 8,
              background: "transparent",
              border: `1px solid ${C.brassLine || C.border}`,
              color: C.brass,
            }}
          >
            New in Studio
          </Link>
        </div>
      </aside>

      <main style={main} className="studio-main-pad">
        <header
          className="studio-mobile-appbar"
          style={mobileAppBar}
          role="banner"
          aria-label="App bar"
        >
          <button
            type="button"
            onClick={() => router.push("/app")}
            aria-label="Go to Home"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              minWidth: 0,
              flex: 1,
              background: "none",
              border: "none",
              padding: 0,
              cursor: "pointer",
              fontFamily: "inherit",
              textAlign: "left",
            }}
          >
            <img
              src={STUDIO_LOGO_URL}
              alt=""
              width={28}
              height={28}
              style={{
                borderRadius: 8,
                objectFit: "cover",
                flexShrink: 0,
                boxShadow: mode === "light" ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
              }}
            />
            <span
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 12,
                letterSpacing: 2,
                color: C.brass,
                fontWeight: 600,
              }}
            >
              STUDIO
            </span>
          </button>

          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            <ThemeToggle compact />
            <button
              type="button"
              onClick={() => go("profile", "/app?tab=profile")}
              aria-label="Profile"
              style={{
                ...avatar,
                width: 32,
                height: 32,
                fontSize: 12,
                border: "none",
                cursor: "pointer",
                padding: 0,
              }}
            >
              {initials || "A"}
            </button>
          </div>
        </header>

        {children}
      </main>

      <ProductTour open={tour.open} onClose={tour.close} index={tour.index} onIndexChange={tour.setIndex} />

      <nav className="studio-bottom-nav" style={bottomNav} aria-label="Main">
        {projectIdFromPath ? (
          <>
            <button
              type="button"
              data-tour-nav="home"
              onClick={() => go("home", "/app")}
              style={{
                ...bottomItem,
                color: current === "home" ? C.brass : C.textFaint,
                fontWeight: current === "home" ? 600 : 500,
              }}
              aria-current={current === "home" ? "page" : undefined}
            >
              <IconHome size={22} color={current === "home" ? C.brass : C.textFaint} />
              Home
            </button>
            <button
              type="button"
              title="Booth — guided recording"
              onClick={() => router.push(`/app/studio/${projectIdFromPath}`)}
              style={{
                ...bottomItem,
                color: onBoothPage ? C.brass : C.textFaint,
                fontWeight: onBoothPage ? 600 : 500,
              }}
              aria-current={onBoothPage ? "page" : undefined}
            >
              <IconBooth size={22} color={onBoothPage ? C.brass : C.textFaint} />
              Booth
            </button>
            <button
              type="button"
              title="Studio — AI timeline"
              onClick={() => router.push(`/app/console/${projectIdFromPath}`)}
              style={{
                ...bottomItem,
                color: onStudioPage ? C.brass : C.textFaint,
                fontWeight: onStudioPage ? 600 : 500,
              }}
              aria-current={onStudioPage ? "page" : undefined}
            >
              <IconStudio size={22} color={onStudioPage ? C.brass : C.textFaint} />
              Studio
            </button>
            <button
              type="button"
              data-tour-nav="library"
              onClick={() => go("library", "/app?tab=library")}
              style={{
                ...bottomItem,
                color: current === "library" ? C.brass : C.textFaint,
                fontWeight: current === "library" ? 600 : 500,
              }}
              aria-current={current === "library" ? "page" : undefined}
            >
              <IconLibrary size={22} color={current === "library" ? C.brass : C.textFaint} />
              Library
            </button>
          </>
        ) : (
          NAV.map(({ key, label, href, Icon }) => {
            const isActive = current === key;
            return (
              <button
                key={key}
                type="button"
                data-tour-nav={key}
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
          })
        )}
      </nav>
    </div>
  );
}
