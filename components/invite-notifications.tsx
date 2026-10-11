"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ArtistAvatar } from "@/components/artist-avatar";
import { useTheme } from "@/lib/theme";

export function IconBell({
  size = 20,
  color = "currentColor",
}: {
  size?: number;
  color?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M6 9a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10 18a2 2 0 0 0 4 0" />
    </svg>
  );
}

export function IconInvitePerson({
  size = 20,
  color = "currentColor",
}: {
  size?: number;
  color?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M19 8v6M22 11h-6" />
    </svg>
  );
}

function IconClose({ size = 18, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" aria-hidden>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

function buildInviteLink(handle: string) {
  if (typeof window === "undefined") return "https://apstudio.site";
  const base = window.location.origin || "https://apstudio.site";
  const clean = handle.replace(/^@/, "").trim() || "artist";
  return `${base}/auth?mode=signup&ref=${encodeURIComponent(clean)}`;
}

type Colors = {
  text: string;
  textMuted: string;
  textFaint?: string;
  surface: string;
  border: string;
  bg?: string;
  bgDeep?: string;
  brass?: string;
};

type InviteSheetProps = {
  open: boolean;
  onClose: () => void;
  userName: string;
  handle: string;
  avatarSeed: string;
  colors: Colors;
};

export function InviteFriendsSheet({
  open,
  onClose,
  userName,
  handle,
  avatarSeed,
  colors: C,
}: InviteSheetProps) {
  const [copied, setCopied] = useState(false);
  const link = useMemo(() => buildInviteLink(handle), [handle, open]);

  useEffect(() => {
    if (!open) setCopied(false);
  }, [open]);

  const copyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }, [link]);

  const shareNative = useCallback(async () => {
    const text = `Make music with me on AP Studio — ${link}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "AP Studio", text, url: link });
        return;
      }
    } catch {
      /* user cancelled */
    }
    await copyLink();
  }, [link, copyLink]);

  if (!open || typeof document === "undefined") return null;

  const shareActions: Array<{
    key: string;
    label: string;
    bg: string;
    color: string;
    onClick: () => void;
    icon: React.ReactNode;
  }> = [
    {
      key: "copy",
      label: copied ? "Copied" : "Copy Link",
      bg: "rgba(255,255,255,0.08)",
      color: C.text,
      onClick: () => void copyLink(),
      icon: (
        <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </svg>
      ),
    },
    {
      key: "messages",
      label: "Messages",
      bg: "#34C759",
      color: "#fff",
      onClick: () => {
        window.open(`sms:&body=${encodeURIComponent(`Join me on AP Studio: ${link}`)}`, "_blank");
      },
      icon: (
        <svg width={18} height={18} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z" />
        </svg>
      ),
    },
    {
      key: "x",
      label: "X",
      bg: "#000",
      color: "#fff",
      onClick: () => {
        window.open(
          `https://twitter.com/intent/tweet?text=${encodeURIComponent(`Make music with me on AP Studio`)}&url=${encodeURIComponent(link)}`,
          "_blank",
          "noopener,noreferrer"
        );
      },
      icon: (
        <svg width={16} height={16} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.227-8.26L1.254 2.25H8.08l4.253 5.622L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z" />
        </svg>
      ),
    },
    {
      key: "wa",
      label: "WhatsApp",
      bg: "#25D366",
      color: "#fff",
      onClick: () => {
        window.open(`https://wa.me/?text=${encodeURIComponent(`Join me on AP Studio: ${link}`)}`, "_blank", "noopener,noreferrer");
      },
      icon: (
        <svg width={18} height={18} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.435 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z" />
        </svg>
      ),
    },
    {
      key: "more",
      label: "More",
      bg: "rgba(255,255,255,0.08)",
      color: C.text,
      onClick: () => void shareNative(),
      icon: (
        <svg width={18} height={18} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <circle cx="5" cy="12" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="19" cy="12" r="2" />
        </svg>
      ),
    },
  ];

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Invite your friends"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 120,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 440,
          borderRadius: "20px 20px 0 0",
          background: C.surface || "#16141C",
          border: `1px solid ${C.border}`,
          padding: "12px 16px calc(20px + env(safe-area-inset-bottom, 0px))",
          color: C.text,
          boxShadow: "0 -12px 40px rgba(0,0,0,0.45)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 8 }}>
          <div style={{ width: 36, height: 4, borderRadius: 999, background: "rgba(255,255,255,0.2)" }} />
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <div style={{ width: 36 }} />
          <div style={{ fontWeight: 700, fontSize: 17 }}>Invite your friends</div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              width: 36,
              height: 36,
              borderRadius: 999,
              border: `1px solid ${C.border}`,
              background: "transparent",
              color: C.textMuted,
              cursor: "pointer",
              display: "grid",
              placeItems: "center",
            }}
          >
            <IconClose color={C.textMuted} />
          </button>
        </div>

        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 12 }}>
            <ArtistAvatar seed={avatarSeed} size={88} />
          </div>
          <div style={{ fontWeight: 700, fontSize: 18 }}>{userName}</div>
          <div style={{ fontSize: 13, color: C.textMuted, marginTop: 2 }}>
            @{handle.replace(/^@/, "")}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 8,
            paddingBottom: 4,
          }}
        >
          {shareActions.map((a) => (
            <button
              key={a.key}
              type="button"
              onClick={a.onClick}
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 6,
                background: "none",
                border: "none",
                color: C.textMuted,
                cursor: "pointer",
                fontFamily: "inherit",
                fontSize: 11,
                padding: 0,
              }}
            >
              <span
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 999,
                  background: a.bg,
                  color: a.color,
                  display: "grid",
                  placeItems: "center",
                }}
              >
                {a.icon}
              </span>
              {a.label}
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
}

type NotifProps = {
  open: boolean;
  onClose: () => void;
  onInvite: () => void;
  colors: Colors;
};

export function NotificationsPanel({ open, onClose, onInvite, colors: C }: NotifProps) {
  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Notifications"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 110,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 480,
          height: "100%",
          background: C.bgDeep || C.bg || "#0a0a0c",
          color: C.text,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 14px",
            paddingTop: "calc(12px + env(safe-area-inset-top, 0px))",
            borderBottom: `1px solid ${C.border}`,
          }}
        >
          <button
            type="button"
            onClick={onClose}
            aria-label="Back"
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
          <div style={{ fontWeight: 700, fontSize: 17 }}>Notifications</div>
          <button
            type="button"
            onClick={() => {
              onClose();
              onInvite();
            }}
            aria-label="Invite friends"
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
            }}
          >
            <IconInvitePerson size={20} color={C.text} />
          </button>
        </div>

        <div style={{ padding: 16, flex: 1, overflowY: "auto" }}>
          <button
            type="button"
            onClick={() => {
              onClose();
              onInvite();
            }}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "14px 14px",
              borderRadius: 16,
              border: "none",
              background: "linear-gradient(135deg, #1a3a6e 0%, #0d1f3c 100%)",
              color: "#fff",
              textAlign: "left",
              cursor: "pointer",
              fontFamily: "inherit",
              boxShadow: "0 8px 24px rgba(0,40,100,0.35)",
            }}
          >
            <span
              style={{
                width: 40,
                height: 40,
                borderRadius: 999,
                background: "rgba(255,255,255,0.12)",
                display: "grid",
                placeItems: "center",
                flexShrink: 0,
              }}
            >
              <IconInvitePerson size={20} color="#fff" />
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontWeight: 700, fontSize: 15 }}>Invite friends</span>
              <span style={{ display: "block", fontSize: 12.5, opacity: 0.75, marginTop: 2 }}>
                Share your invite link
              </span>
            </span>
          </button>

          <div
            style={{
              marginTop: 28,
              textAlign: "center",
              color: C.textMuted,
              fontSize: 13,
            }}
          >
            You’re all caught up
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

/** Header icon button style helper */
export function HeaderIconButton({
  onClick,
  label,
  children,
  colors: C,
}: {
  onClick: () => void;
  label: string;
  children: React.ReactNode;
  colors: Colors;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      style={{
        width: 32,
        height: 32,
        borderRadius: 999,
        border: `1px solid ${C.border}`,
        background: C.surface,
        color: C.text,
        cursor: "pointer",
        display: "grid",
        placeItems: "center",
        padding: 0,
        flexShrink: 0,
      }}
    >
      {children}
    </button>
  );
}
