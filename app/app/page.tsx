"use client";

import React, { useEffect, useState, Suspense } from "react";
import { createPortal } from "react-dom";
import {
  useBeatAudio,
  BeatPreviewTransport,
  BeatPlayButton,
  BeatMoreButton,
  BeatActionsSheet,
  LibraryMiniPlayer,
  LibraryFullPlayer,
  IconPlay,
  IconPause,
  formatAudioTime,
} from "@/components/beat-preview-player";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { AppShell } from "@/components/app-shell";
import { EmptyState } from "@/components/empty-state";
import { useTheme } from "@/lib/theme";
import { grantedPlanForEmail, planDisplayName, resolveSubscriptionPlan } from "@/lib/subscription-grants";
import { CoverArt } from "@/components/studio-player";
import { forceDownloadFromApi } from "@/lib/download-audio";
import { ApPaywall } from "@/components/ap-paywall";
import { ArtistAvatar, IconSettingsCog, stableAvatarSeed } from "@/components/artist-avatar";
import { FeatureBanner } from "@/components/feature-banner";

type MasterVersion = {
  job_id: string;
  version: number;
  audio_path: string;
  completed_at: string | null;
  engine_version: string | null;
};

type Project = {
  id: string;
  title: string;
  status: string;
  genre: string | null;
  mood: string | null;
  updated_at: string;
  has_master?: boolean;
  has_beat?: boolean;
  beat_source?: string | null;
  masters?: MasterVersion[];
  master_count?: number;
  /** Square cover — from metadata.cover_url or generated gradient seed */
  cover_url?: string | null;
  metadata?: Record<string, unknown> | null;
};
type Tab = "home" | "library" | "profile";

/** Short-lived client cache so bottom-nav remounts (Studio ↔ Home) feel instant. */
const APP_CACHE_TTL_MS = 90_000;
type AppListCache = {
  at: number;
  projects: Project[];
  userName: string;
  userEmail: string | null;
  userId: string | null;
  userGenre: string | null;
  userPlan: string;
  isAdmin?: boolean;
};
let appListCache: AppListCache | null = null;

function AppInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { colors: C } = useTheme();
  const [userName, setUserName] = useState("Artist");
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [userGenre, setUserGenre] = useState<string | null>(null);
  const [userPlan, setUserPlan] = useState<string | null>(null);
  const [creditBalance, setCreditBalance] = useState<number | null>(null);
  const [editProfileOpen, setEditProfileOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editGenre, setEditGenre] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMsg, setProfileMsg] = useState<string | null>(null);
  const [profileSubView, setProfileSubView] = useState<"main" | "settings">("main");
  const [subscribeOpen, setSubscribeOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/metrics");
        if (!cancelled) setIsAdmin(res.ok);
      } catch {
        if (!cancelled) setIsAdmin(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("home");
  const [libraryTab, setLibraryTab] = useState<"songs" | "beats" | "recordings">("songs");
  const [librarySearchOpen, setLibrarySearchOpen] = useState(false);
  const [libraryQuery, setLibraryQuery] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [downloadModal, setDownloadModal] = useState<{ id: string; title: string; jobId?: string; version?: number } | null>(null);
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [paywallOpen, setPaywallOpen] = useState(false);
  const [fullPlayerOpen, setFullPlayerOpen] = useState(false);
  const [paywallProject, setPaywallProject] = useState<{ id: string; title: string; jobId?: string; version?: number } | null>(null);
  const [beatPlayError, setBeatPlayError] = useState<string | null>(null);
  const [beatMenu, setBeatMenu] = useState<{ id: string; title: string; meta: string } | null>(null);
  const [projectMenu, setProjectMenu] = useState<{
    id: string;
    title: string;
    meta: string;
    isReady: boolean;
    jobId?: string;
    version?: number;
  } | null>(null);
  const beatAudio = useBeatAudio({
    onError: (message) => setBeatPlayError(message),
  });
  const {
    playingId,
    activeId,
    isPlaying: audioIsPlaying,
    trackMeta,
    loadingId: loadingPlayId,
    currentTime,
    duration,
    toggle: togglePlayBeat,
    toggleMaster: togglePlayMaster,
    pause: pauseAudio,
    resume: resumeAudio,
    seek,
    skip,
    stop,
    stopIfPlaying,
    ensureUrl: ensureBeatUrl,
  } = beatAudio;

  useEffect(() => {
    const t = searchParams.get("tab");
    if (t === "library" || t === "profile" || t === "home") setTab(t);
    if (t === "profile" && searchParams.get("view") === "settings") setProfileSubView("settings");
    if (t && t !== "profile") setProfileSubView("main");
    if (t === "create" || t === "studio") router.replace("/app/studio");
    if (searchParams.get("tour") === "1") {
      window.dispatchEvent(new Event("studio-tour-start"));
      router.replace(t ? `/app?tab=${t}` : "/app");
    }
  }, [searchParams, router]); // eslint-disable-line react-hooks/exhaustive-deps

  // Instant tab switches from bottom nav (no wait for router)
  useEffect(() => {
    function onShellTab(e: Event) {
      const tabKey = (e as CustomEvent<{ tab?: string }>).detail?.tab;
      if (tabKey === "library" || tabKey === "profile" || tabKey === "home") {
        setTab(tabKey);
        if (tabKey !== "profile") setProfileSubView("main");
      }
    }
    window.addEventListener("ap-shell-tab", onShellTab);
    return () => window.removeEventListener("ap-shell-tab", onShellTab);
  }, []);

  useEffect(() => {
    if (tab !== "library") {
      setFullPlayerOpen(false);
      stop();
      setBeatMenu(null);
      setProjectMenu(null);
    }
  }, [tab, stop]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Paint cached list immediately when returning from Studio / other routes
      const cached = appListCache;
      if (cached && Date.now() - cached.at < APP_CACHE_TTL_MS) {
        setUserName(cached.userName);
        setUserEmail(cached.userEmail);
        setUserId(cached.userId);
        setUserGenre(cached.userGenre);
        setUserPlan(cached.userPlan);
        setEditName(cached.userName);
        setProjects(cached.projects);
        setLoading(false);
      }

      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.replace("/auth?mode=login");
        return;
      }
      const { data: profile } = await supabase
        .from("profiles")
        .select("display_name, genre, metadata")
        .eq("id", user.id)
        .maybeSingle();
      if (cancelled) return;
      const name =
        (profile as { display_name?: string } | null)?.display_name ||
        user.email?.split("@")[0] ||
        "Artist";
      setUserName(name);
      setUserEmail(user.email || null);
      setUserId(user.id);
      const genre = ((profile as { genre?: string | null } | null)?.genre as string) || null;
      setUserGenre(genre);
      const meta = ((profile as { metadata?: Record<string, unknown> } | null)?.metadata ||
        {}) as Record<string, unknown>;
      const resolved = resolveSubscriptionPlan({
        email: user.email,
        metadata: meta,
      });
      const planLabel = planDisplayName(resolved);
      setUserPlan(planLabel);
      setEditName(name);
      setEditGenre(genre || "");
      const res = await fetch("/api/projects");
      if (cancelled) return;
      let list: Project[] = cached?.projects || [];
      if (res.ok) {
        const json = await res.json();
        list = (json.projects || [])
          .filter((p: Project) => p.status !== "draft")
          .map((p: Project) => {
            const meta =
              p.metadata && typeof p.metadata === "object"
                ? (p.metadata as Record<string, unknown>)
                : {};
            const cover =
              (typeof p.cover_url === "string" && p.cover_url) ||
              (typeof meta.cover_url === "string" && meta.cover_url) ||
              null;
            return { ...p, cover_url: cover, metadata: meta };
          });
        setProjects(list);
      }
      appListCache = {
        at: Date.now(),
        projects: list,
        userName: name,
        userEmail: user.email || null,
        userId: user.id,
        userGenre: genre,
        userPlan: planLabel,
      };
      setLoading(false);
      try {
        const wr = await fetch("/api/credits/wallet");
        if (wr.ok && !cancelled) {
          const wj = await wr.json();
          if (typeof wj?.wallet?.balance === "number") setCreditBalance(wj.wallet.balance);
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  function isFinishedSong(p: Project) {
    if (p.has_master) return true;
    const s = (p.status || "").toLowerCase();
    return s === "complete" || s === "completed" || s === "produced" || s === "done";
  }

  function projectCoverUrl(p: Project): string | null {
    if (p.cover_url) return p.cover_url;
    const meta = (p.metadata && typeof p.metadata === "object" ? p.metadata : {}) as Record<
      string,
      unknown
    >;
    const u = meta.cover_url;
    return typeof u === "string" && u.length > 8 ? u : null;
  }

  /** Compress image to ~512px JPEG data URL for metadata.cover_url (no extra storage route). */
  async function fileToCoverDataUrl(file: File): Promise<string> {
    const bitmap = await createImageBitmap(file);
    const max = 512;
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable");
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    return canvas.toDataURL("image/jpeg", 0.82);
  }

  async function updateProjectCover(projectId: string, dataUrl: string) {
    const res = await fetch(`/api/projects/${projectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ metadata: { cover_url: dataUrl } }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(typeof j.error === "string" ? j.error : "Could not save cover");
    }
    setProjects((prev) =>
      prev.map((p) =>
        p.id === projectId
          ? {
              ...p,
              cover_url: dataUrl,
              metadata: { ...(p.metadata || {}), cover_url: dataUrl },
            }
          : p
      )
    );
    if (appListCache) {
      appListCache = {
        ...appListCache,
        at: Date.now(),
        projects: appListCache.projects.map((p) =>
          p.id === projectId
            ? {
                ...p,
                cover_url: dataUrl,
                metadata: { ...(p.metadata || {}), cover_url: dataUrl },
              }
            : p
        ),
      };
    }
  }

  function matchesLibraryQuery(p: Project, extra = "") {
    const q = libraryQuery.trim().toLowerCase();
    if (!q) return true;
    const hay = [p.title, p.genre, p.mood, p.status, p.beat_source, extra]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  }

  async function signOut() {
    await createClient().auth.signOut();
    router.replace("/");
  }

  async function saveProfile() {
    if (profileSaving) return;
    const name = editName.trim();
    if (!name) {
      setProfileMsg("Display name is required");
      return;
    }
    setProfileSaving(true);
    setProfileMsg(null);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");
      const { error } = await supabase
        .from("profiles")
        .update({
          display_name: name,
          genre: editGenre.trim() || null,
        })
        .eq("id", user.id);
      if (error) throw new Error(error.message || "Could not save");
      setUserName(name);
      setUserGenre(editGenre.trim() || null);
      setEditProfileOpen(false);
      setProfileMsg("Profile updated");
      setTimeout(() => setProfileMsg(null), 2500);
    } catch (e) {
      setProfileMsg(e instanceof Error ? e.message : "Could not save profile");
    } finally {
      setProfileSaving(false);
    }
  }

  async function deleteProject(projectId: string, title: string) {
    if (deletingId) return;
    const ok = window.confirm(`Delete “${title || "this project"}”? This cannot be undone.`);
    if (!ok) return;
    setDeletingId(projectId);
    try {
      const res = await fetch(`/api/projects/${projectId}`, { method: "DELETE" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Could not delete");
      }
      stopIfPlaying(projectId);
      setProjects((prev) => {
        const next = prev.filter((p) => p.id !== projectId);
        if (appListCache) appListCache = { ...appListCache, at: Date.now(), projects: next };
        return next;
      });
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeletingId(null);
    }
  }

  async function downloadBeatFile(projectId: string, title: string) {
    try {
      const res = await fetch(`/api/projects/${projectId}/beat/download`, {
        credentials: "same-origin",
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(typeof j.error === "string" ? j.error : "Could not download beat");
      }
      const blob = await res.blob();
      const cd = res.headers.get("Content-Disposition") || "";
      const match = /filename="([^"]+)"/i.exec(cd);
      const filename =
        match?.[1] ||
        `${(title || "beat").replace(/[^\w\-]+/g, "-").slice(0, 48)}.mp3`;
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = filename;
      a.rel = "noopener";
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 4000);
      setBeatPlayError(null);
    } catch (e) {
      setBeatPlayError(e instanceof Error ? e.message : "Download failed");
    }
  }

  const initials = userName
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const rowStyle: React.CSSProperties = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    padding: "12px 14px",
    borderRadius: 14,
    background: C.surface,
    border: `1px solid ${C.border}`,
    textDecoration: "none",
    color: C.text,
    minWidth: 0,
    overflow: "hidden",
  };
  const rowBody: React.CSSProperties = { flex: 1, minWidth: 0, overflow: "hidden" };
  const rowTitle: React.CSSProperties = {
    fontWeight: 600,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  };
  const rowMeta: React.CSSProperties = {
    fontSize: 12.5,
    color: C.textMuted,
    marginTop: 2,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  };
  const rowAction: React.CSSProperties = { color: C.brass, fontSize: 13, fontWeight: 600, flexShrink: 0 };

  const eyebrow: React.CSSProperties = {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 12,
    letterSpacing: 2.5,
    color: C.brass,
    marginBottom: 12,
  };
  const h1: React.CSSProperties = {
    fontFamily: "Georgia, serif",
    fontSize: "clamp(1.85rem, 4vw, 2.75rem)",
    lineHeight: 1.08,
    fontWeight: 500,
    margin: 0,
    color: C.text,
  };
  const sub: React.CSSProperties = {
    fontSize: 15.5,
    color: C.textMuted,
    marginTop: 14,
    lineHeight: 1.55,
    maxWidth: 440,
  };
  const primary: React.CSSProperties = {
    padding: "14px 20px",
    borderRadius: 14,
    border: "none",
    background: `linear-gradient(180deg, #F0BC80, ${C.brass})`,
    color: "#1A1208",
    fontWeight: 600,
    fontSize: 15,
    cursor: "pointer",
    fontFamily: "inherit",
  };
  const secondary: React.CSSProperties = {
    padding: "13px 18px",
    borderRadius: 14,
    border: `1px solid ${C.border}`,
    background: C.surface,
    color: C.text,
    fontWeight: 500,
    fontSize: 14.5,
    cursor: "pointer",
    fontFamily: "inherit",
  };
  const avatar: React.CSSProperties = {
    width: 36,
    height: 36,
    borderRadius: 999,
    background: `linear-gradient(145deg, ${C.brass}, #6B3F17)`,
    color: "#1A1208",
    display: "grid",
    placeItems: "center",
    fontFamily: "Georgia, serif",
    fontSize: 13,
    fontWeight: 600,
    flexShrink: 0,
  };

  const ctaBtn: React.CSSProperties = {
    ...primary,
    display: "inline-block",
    textDecoration: "none",
  };


  function openDownloadPaywall(projectId: string, title: string, opts?: { jobId?: string; version?: number }) {
    setDownloadModal(null);
    setPaywallProject({ id: projectId, title, jobId: opts?.jobId, version: opts?.version });
    setPaywallOpen(true);
  }

  function handleDownloadResult(
    result: { ok: true } | { ok: false; error: string; code?: string },
    projectId: string,
    title: string,
    opts?: { jobId?: string; version?: number }
  ) {
    if (result.ok) {
      setDownloadModal(null);
      return;
    }
    if (result.code === "PAYWALL" || result.code === "PAYMENT_REQUIRED") {
      openDownloadPaywall(projectId, title, opts);
      return;
    }
    window.alert(result.error);
  }

  async function runDownload(
    projectId: string,
    title: string,
    format: "wav" | "mp3",
    opts?: { jobId?: string; version?: number }
  ) {
    setDownloadBusy(true);
    const result = await forceDownloadFromApi(
      projectId,
      format,
      `${title || "song"}.${format}`,
      opts
    );
    setDownloadBusy(false);
    handleDownloadResult(result, projectId, title, opts);
  }

  function IconBtn({
    label,
    onClick,
    children,
    danger,
  }: {
    label: string;
    onClick: () => void;
    children: React.ReactNode;
    danger?: boolean;
  }) {
    return (
      <button
        type="button"
        aria-label={label}
        title={label}
        onClick={onClick}
        style={{
          width: 36,
          height: 36,
          borderRadius: 10,
          border: `1px solid ${C.border}`,
          background: C.surface,
          color: danger ? "#E07070" : C.brass,
          display: "grid",
          placeItems: "center",
          cursor: "pointer",
          padding: 0,
          flexShrink: 0,
        }}
      >
        {children}
      </button>
    );
  }

  function SongVersionRow({
    projectId,
    title,
    meta,
    jobId,
    version,
    isReady,
  }: {
    projectId: string;
    title: string;
    meta: string;
    jobId?: string;
    version: number;
    isReady: boolean;
  }) {
    const playId = `master:${projectId}:${jobId || `v${version}`}`;
    const isActive = activeId === playId;
    const isPlaying = isActive && audioIsPlaying;
    const busy = loadingPlayId === playId || deletingId === projectId;
    return (
      <div style={{ ...rowStyle, gap: 10 }}>
        <button
          type="button"
          aria-label={isPlaying ? "Pause" : "Play"}
          disabled={!isReady || busy}
          onClick={() => {
            if (!isReady) return;
            void togglePlayMaster(playId, projectId, {
              ...(jobId ? { jobId } : { version }),
              title,
              subtitle: meta,
              seed: title || projectId,
            });
          }}
          style={{
            position: "relative",
            width: 52,
            height: 52,
            borderRadius: 12,
            border: "none",
            padding: 0,
            flexShrink: 0,
            cursor: !isReady || busy ? "default" : "pointer",
            overflow: "hidden",
            background: "transparent",
          }}
        >
          <CoverArt seed={title || projectId} size={52} />
          <span
            style={{
              position: "absolute",
              inset: 0,
              display: "grid",
              placeItems: "center",
              background: isPlaying
                ? "rgba(0,0,0,0.35)"
                : "rgba(0,0,0,0.25)",
              color: "#fff",
              fontSize: 14,
              fontWeight: 700,
            }}
          >
            {loadingPlayId === playId ? (
              "…"
            ) : isPlaying ? (
              <IconPause size={18} color="#fff" />
            ) : (
              <IconPlay size={18} color="#fff" />
            )}
          </span>
        </button>
        <Link
          href={`/app/studio/${projectId}`}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            flex: 1,
            minWidth: 0,
            textDecoration: "none",
            color: "inherit",
          }}
        >
          <div style={rowBody}>
            <div style={{ ...rowTitle, color: isActive ? C.brass : C.text }}>{title}</div>
            <div style={rowMeta}>
              {meta}
              {isPlaying ? " · Playing" : isActive ? " · Paused" : ""}
            </div>
          </div>
        </Link>
        {isReady && (
          <IconBtn
            label="Download this version"
            onClick={() => {
              const opts = jobId ? { jobId } : { version };
              void forceDownloadFromApi(
                projectId,
                "wav",
                `${title.replace(/[^a-zA-Z0-9._-]+/g, "_")}.wav`,
                opts
              ).then((r) => handleDownloadResult(r, projectId, title, opts));
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 3v12" />
              <path d="M8 11l4 4 4-4" />
              <path d="M5 21h14" />
            </svg>
          </IconBtn>
        )}
        <BeatMoreButton
          active={projectMenu?.id === projectId && projectMenu?.meta === meta}
          onClick={() =>
            setProjectMenu({
              id: projectId,
              title,
              meta,
              isReady,
              jobId,
              version,
            })
          }
        />
      </div>
    );
  }

  function ProjectCoverFallback({ seed }: { seed: string }) {
    // Deterministic gradient from title/id (same idea as CoverArt)
    let s = 0;
    for (let i = 0; i < seed.length; i++) s = (s * 31 + seed.charCodeAt(i)) >>> 0;
    const grads = [
      ["#3A2E52", "#0B0A0F"],
      ["#2E4A4A", "#0B0A0F"],
      ["#4A2E3A", "#0B0A0F"],
      ["#39422E", "#0B0A0F"],
      ["#2E3A4A", "#0B0A0F"],
      ["#4A3A2E", "#0B0A0F"],
    ];
    const [a, b] = grads[s % grads.length];
    return (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: `linear-gradient(145deg, ${a}, ${b})`,
          display: "grid",
          placeItems: "center",
        }}
      >
        <span style={{ fontSize: 36, opacity: 0.85 }} aria-hidden>
          ♪
        </span>
      </div>
    );
  }

  function ProjectRow({ p, meta }: { p: Project; meta: string }) {
    const isReady = isFinishedSong(p);
    const cover = projectCoverUrl(p);
    const relative =
      p.updated_at
        ? (() => {
            try {
              const d = new Date(p.updated_at);
              const sec = Math.max(0, (Date.now() - d.getTime()) / 1000);
              if (sec < 60) return "just now";
              if (sec < 3600) return `${Math.floor(sec / 60)} min ago`;
              if (sec < 86400) return `${Math.floor(sec / 3600)} hours ago`;
              if (sec < 86400 * 7) return `${Math.floor(sec / 86400)} days ago`;
              return d.toLocaleDateString();
            } catch {
              return meta;
            }
          })()
        : meta;

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
        <div style={{ position: "relative", width: "100%", aspectRatio: "1 / 1" }}>
          <Link
            href={`/app/studio/${p.id}`}
            style={{
              display: "block",
              width: "100%",
              height: "100%",
              borderRadius: 12,
              overflow: "hidden",
              textDecoration: "none",
              color: "inherit",
              border: `1px solid ${C.border}`,
              background: C.surface,
              boxShadow: C.cardShadow || "0 6px 18px rgba(0,0,0,0.18)",
            }}
          >
            {cover ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={cover}
                alt=""
                style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
              />
            ) : (
              <ProjectCoverFallback seed={p.id + (p.title || "")} />
            )}
          </Link>
          <div
            style={{
              position: "absolute",
              top: 8,
              right: 8,
              zIndex: 2,
            }}
          >
            <BeatMoreButton
              active={projectMenu?.id === p.id}
              onClick={() =>
                setProjectMenu({
                  id: p.id,
                  title: p.title,
                  meta,
                  isReady,
                })
              }
            />
          </div>
        </div>
        <div style={{ padding: "0 2px", minWidth: 0 }}>
          <Link
            href={`/app/studio/${p.id}`}
            style={{
              display: "block",
              textDecoration: "none",
              color: C.text,
              fontWeight: 650,
              fontSize: 13,
              letterSpacing: -0.15,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {p.title}
          </Link>
          <div
            style={{
              marginTop: 2,
              fontSize: 12,
              color: C.textFaint,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {relative}
          </div>
        </div>
      </div>
    );
  }


  const activeNav = tab === "library" ? "library" : tab === "profile" ? "profile" : "home";

  return (
    <AppShell active={activeNav} userName={userName} userSeed={stableAvatarSeed({ userId, email: userEmail, name: userName })} onSignOut={signOut}>
<div
        className="dash-content"
        style={{ maxWidth: 1120, margin: "0 auto", padding: "28px 20px 40px", boxSizing: "border-box", width: "100%" }}
      >
        <style>{`
          .dash-project-grid {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 12px;
          }
          @media (min-width: 900px) {
            .dash-content { padding: 32px 8px 56px !important; }
            .dash-project-grid { grid-template-columns: repeat(3, minmax(0, 1fr)) !important; gap: 16px !important; }
          }
          @media (min-width: 1200px) {
            .dash-content { max-width: 1200px !important; padding: 36px 12px 64px !important; }
            .dash-project-grid { grid-template-columns: repeat(4, minmax(0, 1fr)) !important; gap: 18px !important; }
          }
        `}</style>

        {tab === "home" && (
          <>
            <h1 style={{ ...h1, fontSize: "clamp(1.45rem, 4.5vw, 1.85rem)", marginTop: 0, marginBottom: 14 }}>
              {userName && userName !== "Artist" ? (
                <>
                  Welcome back,{" "}
                  <span style={{ fontStyle: "italic", fontWeight: 400 }}>{userName}</span>
                </>
              ) : (
                <>Welcome back</>
              )}
            </h1>
            <FeatureBanner seed="ap-home-banner" variant="home" />

            

            <div
              style={{
                marginTop: 40,
                fontSize: 12,
                fontWeight: 600,
                letterSpacing: 1.2,
                color: C.textFaint,
                textTransform: "uppercase",
              }}
            >
              Recent projects
            </div>
            <div
              className="dash-project-grid"
              style={{
                marginTop: 14,
                display: "grid",
                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                gap: 16,
              }}
            >
              {loading && <p style={{ color: C.textMuted, gridColumn: "1 / -1" }}>Loading…</p>}
              {!loading && projects.length === 0 && (
                <div style={{ gridColumn: "1 / -1" }}>
                  <EmptyState
                    scene="home"
                    title="Nothing on the deck yet"
                    description="Your first song starts in Studio — drop a beat, follow the plan, and hit record."
                    action={
                      <button type="button" style={ctaBtn} onClick={() => router.push("/app/studio")}>
                        Open Studio
                      </button>
                    }
                  />
                </div>
              )}
              {projects.slice(0, 12).map((p) => (
                <ProjectRow
                  key={p.id}
                  p={p}
                  meta={`${p.status} · ${[p.genre, p.mood].filter(Boolean).join(" · ")}`}
                />
              ))}
            </div>
          </>
        )}

        {tab === "library" && (
          <>
            {!librarySearchOpen && (
              <FeatureBanner seed="ap-library-banner" variant="library" />
            )}
            {librarySearchOpen ? (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  marginTop: 12,
                  marginBottom: 16,
                }}
              >
                <div
                  style={{
                    flex: 1,
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "12px 14px",
                    borderRadius: 999,
                    background: C.surface,
                    border: `1px solid ${C.border}`,
                  }}
                >
                  <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={C.textMuted} strokeWidth="2" strokeLinecap="round" aria-hidden>
                    <circle cx="11" cy="11" r="7" />
                    <path d="M20 20l-3.5-3.5" />
                  </svg>
                  <input
                    autoFocus
                    value={libraryQuery}
                    onChange={(e) => setLibraryQuery(e.target.value)}
                    placeholder="Search your library"
                    enterKeyHint="search"
                    style={{
                      flex: 1,
                      border: "none",
                      outline: "none",
                      background: "transparent",
                      color: C.text,
                      // 16px minimum — iOS Safari zooms focused inputs under 16px
                      fontSize: 16,
                      fontFamily: "inherit",
                      minWidth: 0,
                      WebkitTextSizeAdjust: "100%",
                    }}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setLibrarySearchOpen(false);
                    setLibraryQuery("");
                  }}
                  aria-label="Close search"
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 999,
                    border: `1px solid ${C.border}`,
                    background: C.surface,
                    color: C.text,
                    cursor: "pointer",
                    display: "grid",
                    placeItems: "center",
                    flexShrink: 0,
                    fontSize: 18,
                    fontFamily: "inherit",
                  }}
                >
                  ×
                </button>
              </div>
            ) : (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "flex-end",
                  gap: 8,
                  marginTop: 10,
                  marginBottom: 10,
                }}
              >
                <button
                  type="button"
                  onClick={() => setLibrarySearchOpen(true)}
                  aria-label="Search library"
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 999,
                    border: `1px solid ${C.border}`,
                    background: C.surface,
                    color: C.text,
                    cursor: "pointer",
                    display: "grid",
                    placeItems: "center",
                    flexShrink: 0,
                    padding: 0,
                  }}
                >
                  <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                    <circle cx="11" cy="11" r="7" />
                    <path d="M20 20l-3.5-3.5" />
                  </svg>
                </button>
              </div>
            )}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 4, marginBottom: 12 }}>
              {(
                [
                  ["songs", "Songs"],
                  ["beats", "Beats"],
                  ["recordings", "Recordings"],
                ] as const
              ).map(([k, l]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setLibraryTab(k)}
                  style={{
                    padding: "8px 14px",
                    borderRadius: 999,
                    border: libraryTab === k ? `1px solid ${C.brassLine}` : `1px solid ${C.border}`,
                    background: libraryTab === k ? C.brassSoft : "transparent",
                    color: libraryTab === k ? C.brass : C.textMuted,
                    fontSize: 13,
                    fontWeight: libraryTab === k ? 600 : 500,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  {l}
                </button>
              ))}
            </div>
            {libraryTab === "songs" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {beatPlayError && (
                  <p style={{ color: "#E07070", fontSize: 13, margin: 0 }}>{beatPlayError}</p>
                )}
                {loading && <p style={{ color: C.textMuted }}>Loading…</p>}
                {!loading && projects.filter((p) => isFinishedSong(p) && matchesLibraryQuery(p)).length === 0 && (
                  libraryQuery.trim() ? (
                    <p style={{ color: C.textMuted, fontSize: 14, textAlign: "center", padding: "24px 12px" }}>
                      No songs match “{libraryQuery.trim()}”
                    </p>
                  ) : (
                  <EmptyState
                    scene="songs"
                    title="No finished songs yet"
                    description="Record your sections, preview the full arrangement, then Produce — masters land here."
                    action={
                      <button type="button" style={ctaBtn} onClick={() => router.push("/app/studio")}>
                        Make a song
                      </button>
                    }
                  />
                  )
                )}
                {projects
                  .filter((p) => isFinishedSong(p) && matchesLibraryQuery(p))
                  .flatMap((p) => {
                    const masters =
                      p.masters && p.masters.length > 0
                        ? p.masters
                        : p.has_master
                          ? [
                              {
                                job_id: "",
                                version: 1,
                                audio_path: "",
                                completed_at: p.updated_at || null,
                                engine_version: null,
                              } as MasterVersion,
                            ]
                          : [];
                    const total = Math.max(masters.length, 1);
                    return masters.map((m) => {
                      const label =
                        total > 1
                          ? `${p.title} · Take ${m.version}`
                          : p.title;
                      const when = m.completed_at
                        ? new Date(m.completed_at).toLocaleString(undefined, {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : null;
                      const eng = m.engine_version ? ` · ${m.engine_version}` : "";
                      const meta = [
                        total > 1 ? `Version ${m.version} of ${total}` : "Song ready",
                        when,
                        [p.genre, p.mood].filter(Boolean).join(" · ") || null,
                      ]
                        .filter(Boolean)
                        .join(" · ");
                      return (
                        <SongVersionRow
                          key={`${p.id}-${m.job_id || m.version}`}
                          projectId={p.id}
                          title={label}
                          meta={meta + eng}
                          jobId={m.job_id || undefined}
                          version={m.version}
                          isReady
                        />
                      );
                    });
                  })}
              </div>
            )}
            {libraryTab === "beats" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {loading && <p style={{ color: C.textMuted }}>Loading…</p>}
                {!loading && projects.filter((p) => p.has_beat && matchesLibraryQuery(p)).length === 0 && (
                  libraryQuery.trim() ? (
                    <p style={{ color: C.textMuted, fontSize: 14, textAlign: "center", padding: "24px 12px" }}>
                      No beats match “{libraryQuery.trim()}”
                    </p>
                  ) : (
                  <EmptyState
                    scene="beats"
                    title="No beats yet"
                    description="Generate an AI instrumental or upload your own — every beat becomes a session."
                    action={
                      <button type="button" style={ctaBtn} onClick={() => router.push("/app/studio")}>
                        Create a beat
                      </button>
                    }
                  />
                  )
                )}
                {beatPlayError && (
                  <p style={{ color: "#E07070", fontSize: 13, margin: 0 }}>{beatPlayError}</p>
                )}
                {projects
                  .filter((p) => p.has_beat && matchesLibraryQuery(p))
                  .map((p) => {
                    const isActive = activeId === p.id;
                    const isPlaying = isActive && audioIsPlaying;
                    const busy = loadingPlayId === p.id || deletingId === p.id;
                    const meta = [p.genre, p.mood].filter(Boolean).join(" · ") || p.status;
                    return (
                      <div
                        key={p.id}
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 0,
                          padding: "12px 14px",
                          borderRadius: 16,
                          background: C.surface,
                          border: `1px solid ${isActive ? C.brassLine || C.brass : C.border}`,
                          color: C.text,
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                          <button
                            type="button"
                            aria-label={isPlaying ? "Pause beat" : "Play beat"}
                            disabled={busy && loadingPlayId !== p.id}
                            onClick={() => {
                              setBeatPlayError(null);
                              void togglePlayBeat(p.id, {
                                title: p.title,
                                subtitle: meta || "Beat",
                                seed: p.title || p.id,
                              });
                            }}
                            style={{
                              position: "relative",
                              width: 52,
                              height: 52,
                              borderRadius: 12,
                              border: "none",
                              padding: 0,
                              flexShrink: 0,
                              cursor: "pointer",
                              overflow: "hidden",
                              background: "transparent",
                            }}
                          >
                            <CoverArt seed={p.title || p.id} size={52} />
                            <span
                              style={{
                                position: "absolute",
                                inset: 0,
                                display: "grid",
                                placeItems: "center",
                                background: "rgba(0,0,0,0.3)",
                                color: "#fff",
                                fontSize: 14,
                                fontWeight: 700,
                              }}
                            >
                              {loadingPlayId === p.id ? (
                                "…"
                              ) : isPlaying ? (
                                <IconPause size={18} color="#fff" />
                              ) : (
                                <IconPlay size={18} color="#fff" />
                              )}
                            </span>
                          </button>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div
                              style={{
                                fontWeight: 650,
                                fontSize: 14,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                                display: "flex",
                                alignItems: "center",
                                gap: 6,
                              }}
                            >
                              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {p.title}
                              </span>
                              {p.beat_source === "ai" && (
                                <span
                                  style={{
                                    flexShrink: 0,
                                    fontSize: 9,
                                    fontWeight: 800,
                                    padding: "2px 6px",
                                    borderRadius: 999,
                                    background: "rgba(231,169,97,0.16)",
                                    color: C.brass,
                                    border: `1px solid ${C.brassLine || C.brass}`,
                                  }}
                                >
                                  AP
                                </span>
                              )}
                              {p.beat_source === "upload" && (
                                <span
                                  style={{
                                    flexShrink: 0,
                                    fontSize: 9,
                                    fontWeight: 700,
                                    padding: "2px 6px",
                                    borderRadius: 999,
                                    color: C.textMuted,
                                    border: `1px solid ${C.border}`,
                                  }}
                                >
                                  Upload
                                </span>
                              )}
                            </div>
                            <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>
                              {meta}
                              {isPlaying ? " · Playing" : isActive ? " · Paused" : ""}
                            </div>
                          </div>
                          <BeatMoreButton
                            active={beatMenu?.id === p.id}
                            onClick={() =>
                              setBeatMenu({
                                id: p.id,
                                title: p.title,
                                meta: `Beat · ${meta}`,
                              })
                            }
                          />
                        </div>
                      </div>
                    );
                  })}
                <BeatActionsSheet
                  open={Boolean(beatMenu)}
                  title={beatMenu?.title || "Beat"}
                  subtitle={beatMenu?.meta}
                  onClose={() => setBeatMenu(null)}
                  items={
                    beatMenu
                      ? [
                          {
                            key: "booth",
                            icon: "booth",
                            label: "Open Booth",
                            onClick: () => router.push(`/app/studio/${beatMenu.id}`),
                          },
                          {
                            key: "console",
                            icon: "console",
                            label: "Open Console",
                            onClick: () => router.push(`/app/console/${beatMenu.id}`),
                          },
                          {
                            key: "download",
                            icon: "download",
                            label: "Download beat",
                            onClick: () => void downloadBeatFile(beatMenu.id, beatMenu.title),
                          },
                          {
                            key: "delete",
                            icon: "delete",
                            label: deletingId === beatMenu.id ? "Deleting…" : "Delete",
                            danger: true,
                            disabled: deletingId === beatMenu.id,
                            onClick: () => void deleteProject(beatMenu.id, beatMenu.title),
                          },
                        ]
                      : []
                  }
                />
              </div>
            )}
            {libraryTab === "recordings" && (
              <div
                className="dash-project-grid"
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                  gap: 12,
                }}
              >
                {loading && (
                  <p style={{ color: C.textMuted, gridColumn: "1 / -1" }}>Loading…</p>
                )}
                {!loading &&
                  projects.filter(
                    (p) =>
                      !isFinishedSong(p) &&
                      ["recording", "in_progress", "blueprint_ready", "planned", "beat_ready"].includes(
                        p.status
                      ) &&
                      matchesLibraryQuery(p)
                  ).length === 0 && (
                    <div style={{ gridColumn: "1 / -1" }}>
                      <EmptyState
                        scene="recordings"
                        title="Your voice belongs here"
                        description="Every take you record in a session shows up when you open that project. Grab headphones and hit Record."
                        action={
                          <button type="button" style={ctaBtn} onClick={() => router.push("/app/studio")}>
                            Start a session
                          </button>
                        }
                      />
                    </div>
                  )}
                {projects
                  .filter(
                    (p) =>
                      !isFinishedSong(p) &&
                      ["recording", "in_progress", "blueprint_ready", "planned", "beat_ready"].includes(
                        p.status
                      ) &&
                      matchesLibraryQuery(p)
                  )
                  .map((p) => (
                    <ProjectRow key={p.id} p={p} meta={`Session · ${p.status}`} />
                  ))}
              </div>
            )}
          </>
        )}

        {tab === "profile" && (
          <div
            style={{
              width: "100%",
              maxWidth: 520,
              margin: "0 auto",
              paddingBottom: "calc(24px + env(safe-area-inset-bottom, 0px))",
            }}
          >
            {(() => {
              const beatCount = projects.filter((p) => p.has_beat).length;
              const songCount = projects.filter((p) => isFinishedSong(p)).length;
              const sessionCount = projects.length;
              const handle =
                (userEmail && userEmail.split("@")[0]) ||
                userName.toLowerCase().replace(/\s+/g, "") ||
                "artist";
              const planLabel = (userPlan || "Free").trim();
              const isFree =
                !planLabel ||
                planLabel.toLowerCase() === "free" ||
                planLabel.toLowerCase() === "trial";
              const needsGenre = !userGenre;
              const needsFirstBeat = beatCount === 0;
              const completeSteps = [
                needsGenre
                  ? {
                      key: "genre",
                      title: "Add your primary genre",
                      sub: "Helps AP match your sound",
                      action: () => {
                        setEditName(userName);
                        setEditGenre(userGenre || "");
                        setEditProfileOpen(true);
                        setProfileSubView("main");
                      },
                    }
                  : null,
                needsFirstBeat
                  ? {
                      key: "beat",
                      title: "Create your first beat",
                      sub: "Open Studio and generate or upload",
                      action: () => router.push("/app/studio"),
                    }
                  : null,
              ].filter(Boolean) as Array<{
                key: string;
                title: string;
                sub: string;
                action: () => void;
              }>;

              const settingsRow = (
                label: string,
                opts?: {
                  sub?: string;
                  onClick?: () => void;
                  href?: string;
                  trailing?: React.ReactNode;
                  danger?: boolean;
                }
              ) => {
                const inner = (
                  <>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontWeight: 600,
                          fontSize: 15,
                          color: opts?.danger ? "#f07167" : C.text,
                        }}
                      >
                        {label}
                      </div>
                      {opts?.sub ? (
                        <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>{opts.sub}</div>
                      ) : null}
                    </div>
                    {opts?.trailing ?? (
                      <span style={{ color: C.textMuted, fontSize: 18, flexShrink: 0 }}>›</span>
                    )}
                  </>
                );
                const style: React.CSSProperties = {
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "14px 16px",
                  width: "100%",
                  textAlign: "left",
                  background: "transparent",
                  border: "none",
                  borderBottom: `1px solid ${C.border}`,
                  color: "inherit",
                  textDecoration: "none",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  boxSizing: "border-box",
                };
                if (opts?.href) {
                  return (
                    <Link key={label} href={opts.href} style={style}>
                      {inner}
                    </Link>
                  );
                }
                return (
                  <button key={label} type="button" style={style} onClick={opts?.onClick}>
                    {inner}
                  </button>
                );
              };

              if (profileSubView === "settings") {
                return (
                  <>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        marginBottom: 18,
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => setProfileSubView("main")}
                        aria-label="Back to profile"
                        style={{
                          width: 40,
                          height: 40,
                          borderRadius: 999,
                          border: `1px solid ${C.border}`,
                          background: C.surface,
                          color: C.text,
                          cursor: "pointer",
                          fontSize: 18,
                          fontFamily: "inherit",
                        }}
                      >
                        ←
                      </button>
                      <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: C.text }}>
                        Settings & preferences
                      </h1>
                    </div>

                    <div
                      style={{
                        borderRadius: 18,
                        border: `1px solid ${C.border}`,
                        background: C.surface,
                        overflow: "hidden",
                        marginBottom: 16,
                      }}
                    >
                      {settingsRow("Edit Profile", {
                        onClick: () => {
                          setEditName(userName);
                          setEditGenre(userGenre || "");
                          setEditProfileOpen(true);
                          setProfileSubView("main");
                        },
                      })}
                      {settingsRow("Account", {
                        sub: userEmail || undefined,
                        onClick: () => {
                          setEditName(userName);
                          setEditGenre(userGenre || "");
                          setEditProfileOpen(true);
                          setProfileSubView("main");
                        },
                      })}
                      {settingsRow("AP Credits", {
                        sub:
                          creditBalance == null
                            ? "Production capacity wallet"
                            : `${creditBalance.toLocaleString()} available · never expire`,
                        onClick: () => setSubscribeOpen(true),
                      })}
                      {settingsRow("My Subscription", {
                        sub: isFree ? "Free plan" : planLabel,
                        onClick: () => setSubscribeOpen(true),
                        trailing: isFree ? (
                          <span
                            style={{
                              flexShrink: 0,
                              fontSize: 12,
                              fontWeight: 700,
                              padding: "6px 10px",
                              borderRadius: 999,
                              background: "linear-gradient(135deg, #7B5CFF, #E060C0)",
                              color: "#fff",
                            }}
                          >
                            Upgrade now
                          </span>
                        ) : (
                          <span style={{ color: C.textMuted, fontSize: 18 }}>›</span>
                        ),
                      })}
                      {settingsRow("My Downloads", {
                        sub: "Beats & masters you saved",
                        onClick: () => {
                          setTab("library");
                          router.replace("/app?tab=library");
                        },
                      })}
                      {settingsRow("How Studio works", {
                        sub: "Quick product tour",
                        onClick: () => window.dispatchEvent(new Event("studio-tour-start")),
                      })}
                      {settingsRow("Notifications", {
                        sub: "Coming soon",
                        onClick: () => setProfileMsg("Notifications settings coming soon"),
                      })}
                      {settingsRow("Privacy", {
                        href: "/privacy",
                      })}
                      {settingsRow("Terms of use", {
                        href: "/terms",
                      })}
                      {settingsRow("Report a problem", {
                        href: "mailto:support@apstudio.site?subject=AP%20Studio%20report",
                      })}
                      {settingsRow("Support", {
                        href: "mailto:support@apstudio.site",
                      })}
                      {isAdmin &&
                        settingsRow("Admin dashboard", {
                          sub: "Internal metrics",
                          href: "/app/admin",
                        })}
                      <button
                        type="button"
                        onClick={signOut}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 12,
                          padding: "14px 16px",
                          width: "100%",
                          textAlign: "left",
                          background: "transparent",
                          border: "none",
                          color: "#f07167",
                          fontWeight: 650,
                          fontSize: 15,
                          cursor: "pointer",
                          fontFamily: "inherit",
                        }}
                      >
                        Log out
                      </button>
                    </div>

                    {isFree && (
                      <button
                        type="button"
                        onClick={() => setSubscribeOpen(true)}
                        style={{
                          width: "100%",
                          padding: "14px 16px",
                          borderRadius: 14,
                          border: "none",
                          background: `linear-gradient(180deg, #F0BC80, ${C.brass})`,
                          color: "#1A1208",
                          fontWeight: 750,
                          fontSize: 15,
                          cursor: "pointer",
                          fontFamily: "inherit",
                          marginBottom: 8,
                        }}
                      >
                        Choose a plan & upgrade
                      </button>
                    )}
                  </>
                );
              }

              // —— Main profile (Suno-style) ——
              return (
                <>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "flex-end",
                      marginBottom: 8,
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => setProfileSubView("settings")}
                      aria-label="Settings"
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: 999,
                        border: `1px solid ${C.border}`,
                        background: C.surface,
                        color: C.text,
                        cursor: "pointer",
                        display: "grid",
                        placeItems: "center",
                        fontFamily: "inherit",
                        padding: 0,
                      }}
                    >
                      <IconSettingsCog size={20} color={C.text} />
                    </button>
                  </div>

                  <div style={{ textAlign: "center", marginBottom: 20 }}>
                    <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}>
                      <ArtistAvatar
                        seed={stableAvatarSeed({ userId, email: userEmail, name: userName })}
                        size={96}
                      />
                    </div>
                    <div
                      style={{
                        fontSize: 24,
                        fontWeight: 750,
                        color: C.text,
                        letterSpacing: -0.02,
                      }}
                    >
                      {userName}
                    </div>
                    <div style={{ fontSize: 14, color: C.textMuted, marginTop: 4 }}>@{handle}</div>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "center",
                        gap: 18,
                        marginTop: 12,
                        fontSize: 13,
                        color: C.textMuted,
                        flexWrap: "wrap",
                      }}
                    >
                      <span>
                        <strong style={{ color: C.text }}>{beatCount}</strong> beats
                      </span>
                      <span>
                        <strong style={{ color: C.text }}>{songCount}</strong> songs
                      </span>
                      <span>
                        <strong style={{ color: C.text }}>{sessionCount}</strong> sessions
                      </span>
                    </div>
                    {userGenre ? (
                      <div style={{ fontSize: 12.5, color: C.textMuted, marginTop: 8 }}>{userGenre}</div>
                    ) : null}
                    <div
                      style={{
                        marginTop: 10,
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "4px 10px",
                        borderRadius: 999,
                        background: isFree ? "rgba(255,255,255,0.06)" : "rgba(231,169,97,0.14)",
                        border: `1px solid ${isFree ? C.border : C.brassLine || C.brass}`,
                        fontSize: 12,
                        fontWeight: 650,
                        color: isFree ? C.textMuted : C.brass,
                      }}
                    >
{isFree ? "Free plan" : planLabel}
                      {creditBalance != null ? ` · ${creditBalance.toLocaleString()} credits` : ""}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setEditName(userName);
                      setEditGenre(userGenre || "");
                      setEditProfileOpen(true);
                      setProfileMsg(null);
                    }}
                    style={{
                      ...secondary,
                      width: "100%",
                      marginBottom: 16,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 8,
                      borderRadius: 999,
                      padding: "12px 16px",
                    }}
                  >
                    ✎ Edit Profile
                  </button>

                  {isFree && (
                    <button
                      type="button"
                      onClick={() => setSubscribeOpen(true)}
                      style={{
                        width: "100%",
                        marginBottom: 20,
                        padding: "13px 16px",
                        borderRadius: 14,
                        border: "none",
                        background: "linear-gradient(135deg, #7B5CFF, #E060C0)",
                        color: "#fff",
                        fontWeight: 750,
                        fontSize: 14.5,
                        cursor: "pointer",
                        fontFamily: "inherit",
                        boxShadow: "0 8px 24px rgba(123,92,255,0.25)",
                      }}
                    >
                      Upgrade — choose a plan
                    </button>
                  )}

                  {profileMsg && (
                    <p
                      style={{
                        fontSize: 13,
                        color: profileMsg.includes("updated") || profileMsg.includes("soon") ? C.brass : "#f07167",
                        margin: "0 0 12px",
                        textAlign: "center",
                      }}
                    >
                      {profileMsg}
                    </p>
                  )}

                  {editProfileOpen && (
                    <div
                      style={{
                        padding: 16,
                        borderRadius: 18,
                        background: C.surface,
                        border: `1px solid ${C.border}`,
                        marginBottom: 20,
                      }}
                    >
                      <div style={{ fontWeight: 650, fontSize: 14, marginBottom: 12, color: C.text }}>
                        Edit profile
                      </div>
                      <label style={{ display: "block", fontSize: 12, color: C.textMuted, marginBottom: 6 }}>
                        Display name
                      </label>
                      <input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        maxLength={64}
                        style={{
                          width: "100%",
                          boxSizing: "border-box",
                          padding: "12px 14px",
                          borderRadius: 12,
                          border: `1px solid ${C.border}`,
                          background: C.bgDeep || C.bg,
                          color: C.text,
                          fontSize: 15,
                          marginBottom: 12,
                          fontFamily: "inherit",
                        }}
                      />
                      <label style={{ display: "block", fontSize: 12, color: C.textMuted, marginBottom: 6 }}>
                        Primary genre
                      </label>
                      <input
                        value={editGenre}
                        onChange={(e) => setEditGenre(e.target.value)}
                        placeholder="e.g. R&B, Afrobeats, Drill"
                        maxLength={48}
                        style={{
                          width: "100%",
                          boxSizing: "border-box",
                          padding: "12px 14px",
                          borderRadius: 12,
                          border: `1px solid ${C.border}`,
                          background: C.bgDeep || C.bg,
                          color: C.text,
                          fontSize: 15,
                          marginBottom: 14,
                          fontFamily: "inherit",
                        }}
                      />
                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                        <button
                          type="button"
                          disabled={profileSaving}
                          onClick={() => void saveProfile()}
                          style={{
                            ...primary,
                            flex: 1,
                            minWidth: 120,
                            padding: "12px 16px",
                            opacity: profileSaving ? 0.7 : 1,
                          }}
                        >
                          {profileSaving ? "Saving…" : "Save"}
                        </button>
                        <button
                          type="button"
                          disabled={profileSaving}
                          onClick={() => {
                            setEditProfileOpen(false);
                            setProfileMsg(null);
                          }}
                          style={{ ...secondary, flex: 1, minWidth: 100, padding: "12px 16px" }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {completeSteps.length > 0 && (
                    <div style={{ marginBottom: 22 }}>
                      <div style={{ fontWeight: 700, fontSize: 16, color: C.text, marginBottom: 4 }}>
                        Complete Your Profile
                      </div>
                      <div style={{ fontSize: 12.5, color: C.textMuted, marginBottom: 10 }}>
                        Step {3 - completeSteps.length} of 3
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {completeSteps.map((step) => (
                          <button
                            key={step.key}
                            type="button"
                            onClick={step.action}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 12,
                              padding: "14px 16px",
                              borderRadius: 14,
                              border: `1px solid ${C.border}`,
                              background: C.surface,
                              color: C.text,
                              textAlign: "left",
                              cursor: "pointer",
                              fontFamily: "inherit",
                              width: "100%",
                            }}
                          >
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontWeight: 650, fontSize: 14 }}>{step.title}</div>
                              <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>{step.sub}</div>
                            </div>
                            <span style={{ color: C.textMuted, fontSize: 18 }}>›</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Songs */}
                  <div style={{ marginBottom: 22 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "baseline",
                        justifyContent: "space-between",
                        marginBottom: 10,
                      }}
                    >
                      <div style={{ fontWeight: 700, fontSize: 16, color: C.text }}>Songs</div>
                      <span style={{ fontSize: 12, color: C.textMuted }}>{songCount} published</span>
                    </div>
                    {songCount === 0 ? (
                      <div
                        style={{
                          position: "relative",
                          borderRadius: 16,
                          border: `1px solid ${C.border}`,
                          background: C.surface,
                          padding: "28px 16px",
                          textAlign: "center",
                          overflow: "hidden",
                        }}
                      >
                        <div style={{ fontSize: 13, color: C.textMuted, marginBottom: 12 }}>
                          No songs published yet
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setTab("library");
                            router.replace("/app?tab=library");
                          }}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 8,
                            padding: "10px 16px",
                            borderRadius: 999,
                            border: "none",
                            background: C.text,
                            color: C.bgDeep || "#0a0a0c",
                            fontWeight: 700,
                            fontSize: 13,
                            cursor: "pointer",
                            fontFamily: "inherit",
                          }}
                        >
                          ♪ Browse your songs
                        </button>
                      </div>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {projects
                          .filter((p) => isFinishedSong(p))
                          .slice(0, 8)
                          .map((p) => (
                            <ProjectRow key={p.id} p={p} meta={`Song · ${p.genre || p.status}`} />
                          ))}
                      </div>
                    )}
                  </div>

                  {/* Beats */}
                  <div style={{ marginBottom: 22 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "baseline",
                        justifyContent: "space-between",
                        marginBottom: 10,
                      }}
                    >
                      <div style={{ fontWeight: 700, fontSize: 16, color: C.text }}>Beats</div>
                      <span style={{ fontSize: 12, color: C.textMuted }}>{beatCount} generated</span>
                    </div>
                    {beatCount === 0 ? (
                      <div
                        style={{
                          borderRadius: 16,
                          border: `1px solid ${C.border}`,
                          background: C.surface,
                          padding: "24px 16px",
                          textAlign: "center",
                        }}
                      >
                        <div style={{ fontSize: 13, color: C.textMuted, marginBottom: 12 }}>
                          No beats yet
                        </div>
                        <button
                          type="button"
                          onClick={() => router.push("/app/studio")}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 8,
                            padding: "10px 16px",
                            borderRadius: 999,
                            border: "none",
                            background: `linear-gradient(180deg, #F0BC80, ${C.brass})`,
                            color: "#1A1208",
                            fontWeight: 700,
                            fontSize: 13,
                            cursor: "pointer",
                            fontFamily: "inherit",
                          }}
                        >
                          Create a beat
                        </button>
                      </div>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {projects
                          .filter((p) => p.has_beat)
                          .slice(0, 8)
                          .map((p) => (
                            <ProjectRow
                              key={p.id}
                              p={p}
                              meta={`${p.beat_source === "upload" ? "Upload" : "AP beat"} · ${p.genre || p.status}`}
                            />
                          ))}
                        {beatCount > 8 && (
                          <button
                            type="button"
                            onClick={() => router.push("/app/studio")}
                            style={{
                              ...secondary,
                              width: "100%",
                              marginTop: 4,
                            }}
                          >
                            See all in Studio
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </>
              );
            })()}
          </div>
        )}


      </div>

        
        <BeatActionsSheet
          open={Boolean(projectMenu)}
          title={projectMenu?.title || "Project"}
          subtitle={projectMenu?.meta}
          onClose={() => setProjectMenu(null)}
          items={
            projectMenu
              ? [
                  {
                    key: "booth",
                    icon: "booth",
                    label: "Open Booth",
                    onClick: () => router.push(`/app/studio/${projectMenu.id}`),
                  },
                  {
                    key: "console",
                    icon: "console",
                    label: "Open Console",
                    onClick: () => router.push(`/app/console/${projectMenu.id}`),
                  },
                  {
                    key: "cover",
                    icon: "download",
                    label: "Change cover art",
                    onClick: () => {
                      const id = projectMenu.id;
                      const input = document.getElementById(
                        "project-cover-file-input"
                      ) as HTMLInputElement | null;
                      if (!input) return;
                      input.onchange = async () => {
                        const file = input.files?.[0];
                        input.value = "";
                        if (!file || !file.type.startsWith("image/")) return;
                        try {
                          const dataUrl = await fileToCoverDataUrl(file);
                          await updateProjectCover(id, dataUrl);
                        } catch (e) {
                          alert(e instanceof Error ? e.message : "Could not update cover");
                        }
                      };
                      input.click();
                    },
                  },
                  ...(projectMenu.isReady
                    ? [
                        {
                          key: "download",
                          icon: "download",
                          label: "Download song",
                          onClick: () =>
                            setDownloadModal({
                              id: projectMenu.id,
                              title: projectMenu.title,
                              jobId: projectMenu.jobId,
                              version: projectMenu.version,
                            }),
                        },
                      ]
                    : []),
                  {
                    key: "delete",
                    icon: "delete",
                    label: deletingId === projectMenu.id ? "Deleting…" : "Delete",
                    danger: true,
                    disabled: deletingId === projectMenu.id,
                    onClick: () => void deleteProject(projectMenu.id, projectMenu.title),
                  },
                ]
              : []
          }
        />


      
      <LibraryMiniPlayer
        open={tab === "library" && Boolean(activeId) && !fullPlayerOpen}
        title={trackMeta?.title || "Now playing"}
        subtitle={
          trackMeta?.subtitle ||
          (duration > 0
            ? `${formatAudioTime(currentTime)} / ${formatAudioTime(duration)}`
            : undefined)
        }
        seed={trackMeta?.seed}
        isPlaying={audioIsPlaying}
        loading={Boolean(loadingPlayId)}
        currentTime={currentTime}
        duration={duration}
        onTogglePlay={() => {
          if (audioIsPlaying) pauseAudio();
          else void resumeAudio();
        }}
        onSeek={seek}
        onSkip={skip}
        onClose={() => {
          setFullPlayerOpen(false);
          stop();
        }}
        onExpand={() => setFullPlayerOpen(true)}
      />

      <LibraryFullPlayer
        open={tab === "library" && Boolean(activeId) && fullPlayerOpen}
        title={trackMeta?.title || "Now playing"}
        subtitle={trackMeta?.subtitle || "AP Studio"}
        seed={trackMeta?.seed}
        isPlaying={audioIsPlaying}
        loading={Boolean(loadingPlayId)}
        currentTime={currentTime}
        duration={duration}
        onTogglePlay={() => {
          if (audioIsPlaying) pauseAudio();
          else void resumeAudio();
        }}
        onSeek={seek}
        onSkip={skip}
        onClose={() => setFullPlayerOpen(false)}
        onDownload={
          activeId && String(activeId).startsWith("master:")
            ? () => {
                // activeId = master:projectId:jobOrVersion
                const parts = String(activeId).split(":");
                const projectId = parts[1];
                const rest = parts.slice(2).join(":");
                if (!projectId) return;
                const opts =
                  rest.startsWith("v") && !rest.includes("-")
                    ? { version: Number(rest.slice(1)) || 1 }
                    : rest
                      ? { jobId: rest }
                      : undefined;
                setFullPlayerOpen(false);
                setDownloadModal({
                  id: projectId,
                  title: trackMeta?.title || "song",
                  jobId: opts && "jobId" in opts ? opts.jobId : undefined,
                  version: opts && "version" in opts ? opts.version : undefined,
                });
              }
            : undefined
        }
      />

            <ApPaywall
        open={subscribeOpen}
        onClose={() => setSubscribeOpen(false)}
        showSessionUnlock={false}
        colors={{
          text: C.text,
          textMuted: C.textMuted,
          surface: C.surface,
          border: C.border,
          accent: C.brass,
          bg: C.bgDeep || C.bg,
        }}
        onUnlocked={() => {
          setSubscribeOpen(false);
          setUserPlan("Artist");
          setProfileMsg("Plan updated");
          setTimeout(() => setProfileMsg(null), 2500);
        }}
      />

      <ApPaywall
        open={paywallOpen}
        onClose={() => {
          setPaywallOpen(false);
          setPaywallProject(null);
        }}
        songTitle={paywallProject?.title}
        projectId={paywallProject?.id}
        colors={{
          text: C.text,
          textMuted: C.textMuted,
          surface: C.surface,
          border: C.border,
          accent: C.brass,
          bg: C.bg || C.surface,
        }}
        onUnlocked={() => {
          setPaywallOpen(false);
          if (paywallProject) {
            setDownloadModal({
              id: paywallProject.id,
              title: paywallProject.title,
              jobId: paywallProject.jobId,
              version: paywallProject.version,
            });
          }
          setPaywallProject(null);
        }}
      />

      {downloadModal &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Download format"
            onClick={() => !downloadBusy && setDownloadModal(null)}
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 230,
              background: "rgba(0,0,0,0.55)",
              display: "grid",
              placeItems: "center",
              padding:
                "calc(20px + env(safe-area-inset-top, 0px)) 20px calc(20px + env(safe-area-inset-bottom, 0px))",
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                width: "100%",
                maxWidth: 340,
                borderRadius: 18,
                background: C.surface,
                border: `1px solid ${C.border}`,
                padding: "22px 20px",
                boxShadow: C.cardShadow,
              }}
            >
              <div style={{ fontFamily: "Georgia, serif", fontSize: 18, color: C.text, marginBottom: 6 }}>
                Download
              </div>
              <p style={{ fontSize: 13, color: C.textMuted, margin: "0 0 16px", lineHeight: 1.45 }}>
                Choose a format for “{downloadModal.title || "your song"}”. The file will save to your device.
              </p>
              <button
                type="button"
                disabled={downloadBusy}
                onClick={() => void runDownload(downloadModal.id, downloadModal.title, "wav", { jobId: downloadModal.jobId, version: downloadModal.version })}
                style={{
                  width: "100%",
                  padding: "12px 14px",
                  borderRadius: 12,
                  border: "none",
                  background: `linear-gradient(180deg, #F0BC80, ${C.brass})`,
                  color: "#1A1208",
                  fontWeight: 600,
                  fontSize: 14,
                  cursor: downloadBusy ? "wait" : "pointer",
                  marginBottom: 8,
                  fontFamily: "inherit",
                }}
              >
                {downloadBusy ? "Downloading…" : "WAV — full quality"}
              </button>
              <button
                type="button"
                disabled={downloadBusy}
                onClick={() => void runDownload(downloadModal.id, downloadModal.title, "mp3", { jobId: downloadModal.jobId, version: downloadModal.version })}
                style={{
                  width: "100%",
                  padding: "12px 14px",
                  borderRadius: 12,
                  border: `1px solid ${C.border}`,
                  background: C.surface,
                  color: C.text,
                  fontWeight: 600,
                  fontSize: 14,
                  cursor: downloadBusy ? "wait" : "pointer",
                  fontFamily: "inherit",
                }}
              >
                {downloadBusy ? "Downloading…" : "MP3 — smaller file"}
              </button>
              <button
                type="button"
                disabled={downloadBusy}
                onClick={() => setDownloadModal(null)}
                style={{
                  width: "100%",
                  marginTop: 12,
                  padding: "10px",
                  border: "none",
                  background: "transparent",
                  color: C.textMuted,
                  fontSize: 13,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                Cancel
              </button>
            </div>
          </div>,
          document.body
        )}
    </AppShell>
  );
}


export default function StudioAppPage() {
  return (
    <Suspense
      fallback={
        <div
          style={{
            minHeight: "100vh",
            display: "grid",
            placeItems: "center",
            color: "#9B96A3",
          }}
        >
          Loading…
        </div>
      }
    >
      <AppInner />
    </Suspense>
  );
}
