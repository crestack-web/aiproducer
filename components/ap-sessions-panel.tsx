"use client";

/**
 * AP Session share modal — Riffle-style Collaborate UI in AP Studio dark theme.
 * Copy link + email invite; roles: artist / producer / listener.
 */

import React, { useCallback, useEffect, useState } from "react";
import type { ApSession, ApSessionMember, ApSessionRole } from "@/lib/sessions/types";

type Props = {
  projectId: string;
  open: boolean;
  onClose: () => void;
  transportPlaying?: boolean;
  transportPositionMs?: number;
  onFollowTransport?: (state: {
    playing: boolean;
    positionMs: number;
    revision: number;
  }) => void;
};

const brass = "#E7A961";
const border = "rgba(255,255,255,0.1)";
const muted = "rgba(245,240,232,0.55)";
const surface = "rgba(18,18,24,0.98)";
const text = "#F5F0E8";

function roleLabel(r: string) {
  if (r === "owner") return "Owner";
  if (r === "producer") return "Producer";
  if (r === "listener") return "Listener";
  return "Artist";
}

function roleHint(r: string) {
  if (r === "producer") return "Can edit session & invite";
  if (r === "listener") return "Can listen & chat";
  return "Can record & collaborate";
}

function initial(name: string) {
  const t = (name || "?").trim();
  return (t[0] || "?").toUpperCase();
}

function avatarColor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const hues = [28, 200, 320, 160, 40, 280];
  const hue = hues[h % hues.length];
  return `hsl(${hue} 55% 42%)`;
}

export default function ApSessionsPanel({
  projectId,
  open,
  onClose,
}: Props) {
  const [session, setSession] = useState<ApSession | null>(null);
  const [members, setMembers] = useState<
    (ApSessionMember & { display_name?: string | null; avatar_url?: string | null })[]
  >([]);
  const [myRole, setMyRole] = useState<ApSessionRole | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [inviteRole, setInviteRole] = useState<"artist" | "producer" | "listener">("artist");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState<"collaborate" | "chat">("collaborate");
  const [projectTitle, setProjectTitle] = useState("Project");

  const canInvite = myRole === "owner" || myRole === "producer" || myRole == null;

  const loadSession = useCallback(async () => {
    setErr(null);
    try {
      const listRes = await fetch(`/api/sessions?projectId=${projectId}`);
      const listJ = await listRes.json();
      if (!listRes.ok) {
        setErr(listJ.error || "Could not load sessions");
        return;
      }
      const sessions = (listJ.sessions || []) as ApSession[];
      const active = sessions.find((s) => s.status === "active") || sessions[0] || null;
      if (!active) {
        setSession(null);
        setMembers([]);
        return;
      }
      const det = await fetch(`/api/sessions/${active.id}`);
      const detJ = await det.json();
      if (!det.ok) {
        setErr(detJ.error || "Could not open session");
        return;
      }
      setSession(detJ.session || active);
      setMembers(detJ.members || []);
      setMyRole(detJ.myRole || null);
    } catch {
      setErr("Network error loading session");
    }
  }, [projectId]);

  const ensureSession = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      const j = await res.json();
      if (!res.ok) {
        setErr(j.error || "Could not create session");
        return;
      }
      setSession(j.session);
      await loadSession();
    } finally {
      setBusy(false);
    }
  }, [projectId, loadSession]);

  const ensureInviteLink = useCallback(async () => {
    if (!session) return null;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/sessions/${session.id}/invites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: inviteRole, expiresInHours: 168, maxUses: 50 }),
      });
      const j = await res.json();
      if (!res.ok) {
        setErr(typeof j.error === "string" ? j.error : "Could not create invite");
        return null;
      }
      const url = j.joinUrl || j.joinPath;
      setInviteUrl(url);
      return url as string;
    } finally {
      setBusy(false);
    }
  }, [session, inviteRole]);

  const copyLink = useCallback(async () => {
    setOkMsg(null);
    let url = inviteUrl;
    if (!url) {
      if (!session) {
        await ensureSession();
        return;
      }
      url = await ensureInviteLink();
    }
    if (!url) return;
    try {
      await navigator.clipboard?.writeText(url);
      setCopied(true);
      setOkMsg("Link copied — send it to your collaborator");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setOkMsg(url);
    }
  }, [inviteUrl, session, ensureSession, ensureInviteLink]);

  const sendEmailInvite = useCallback(async () => {
    const to = email.trim().toLowerCase();
    if (!to || !to.includes("@")) {
      setErr("Enter a valid email address");
      return;
    }
    if (!session) {
      await ensureSession();
      return;
    }
    setSending(true);
    setErr(null);
    setOkMsg(null);
    try {
      const res = await fetch(`/api/sessions/${session.id}/invites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: inviteRole,
          expiresInHours: 168,
          maxUses: 20,
          invitedEmail: to,
          sendEmail: true,
        }),
      });
      const j = await res.json();
      if (!res.ok) {
        setErr(typeof j.error === "string" ? j.error : "Could not send invite");
        return;
      }
      if (j.joinUrl) setInviteUrl(j.joinUrl);
      setOkMsg(
        j.emailSent
          ? `Invite emailed to ${to}`
          : j.emailError
            ? `Link created, but email failed: ${j.emailError}`
            : `Invite created for ${to}`
      );
      setEmail("");
    } finally {
      setSending(false);
    }
  }, [email, session, inviteRole, ensureSession]);

  useEffect(() => {
    if (!open) return;
    setTab("collaborate");
    setErr(null);
    setOkMsg(null);
    void loadSession();
    fetch(`/api/projects/${projectId}`)
      .then((r) => r.json())
      .then((j) => {
        const p = j.project || j;
        if (p?.title) setProjectTitle(String(p.title));
      })
      .catch(() => {});
  }, [open, loadSession, projectId]);

  // Auto-create session when opening with none
  useEffect(() => {
    if (!open || busy || session) return;
    // soft auto-create after first load found none
  }, [open, busy, session]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal
      aria-label="Share session"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 80,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "max(12px, env(safe-area-inset-top)) 12px 24px",
        background: "rgba(0,0,0,0.55)",
        backdropFilter: "blur(6px)",
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(420px, 100%)",
          marginTop: 48,
          maxHeight: "min(88vh, 720px)",
          overflow: "auto",
          borderRadius: 20,
          border: `1px solid ${border}`,
          background: surface,
          boxShadow: "0 24px 80px rgba(0,0,0,0.55)",
          color: text,
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
        {/* Tabs */}
        <div
          style={{
            display: "flex",
            gap: 4,
            padding: "14px 14px 0",
            borderBottom: `1px solid ${border}`,
          }}
        >
          {(
            [
              ["collaborate", "Collaborate"],
              ["chat", "Session"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              style={{
                flex: 1,
                padding: "10px 12px",
                borderRadius: 999,
                border: "none",
                marginBottom: 10,
                background: tab === id ? "rgba(231,169,97,0.18)" : "transparent",
                color: tab === id ? brass : muted,
                fontWeight: 700,
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            style={{
              width: 36,
              height: 36,
              borderRadius: 999,
              border: "none",
              background: "transparent",
              color: muted,
              fontSize: 20,
              cursor: "pointer",
              marginBottom: 10,
            }}
          >
            ×
          </button>
        </div>

        {tab === "collaborate" && (
          <div style={{ padding: 16 }}>
            <div style={{ fontSize: 12, color: muted, marginBottom: 12, lineHeight: 1.4 }}>
              Invite collaborators to <strong style={{ color: text }}>{projectTitle}</strong>.
              They sign in (or create an account) and join with your link.
            </div>

            {!session ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void ensureSession()}
                style={primaryBtn}
              >
                {busy ? "Starting…" : "Start collaboration session"}
              </button>
            ) : (
              <>
                {/* Email invite */}
                <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                  <input
                    type="email"
                    placeholder="Enter an email address"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    style={inputStyle}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void sendEmailInvite();
                    }}
                  />
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    marginBottom: 14,
                  }}
                >
                  <label style={{ fontSize: 12, color: muted, display: "flex", alignItems: "center", gap: 8 }}>
                    Role
                    <select
                      value={inviteRole}
                      onChange={(e) => {
                        setInviteRole(e.target.value as typeof inviteRole);
                        setInviteUrl(null);
                      }}
                      style={{
                        padding: "6px 10px",
                        borderRadius: 999,
                        border: `1px solid ${border}`,
                        background: "rgba(0,0,0,0.35)",
                        color: text,
                        fontSize: 12,
                        fontWeight: 600,
                      }}
                    >
                      <option value="artist">Artist · can record</option>
                      <option value="producer">Producer · can edit</option>
                      <option value="listener">Listener · view only</option>
                    </select>
                  </label>
                  <button
                    type="button"
                    disabled={sending || !canInvite}
                    onClick={() => void sendEmailInvite()}
                    style={{
                      ...primaryBtn,
                      width: "auto",
                      padding: "8px 14px",
                      fontSize: 13,
                      opacity: canInvite ? 1 : 0.5,
                    }}
                  >
                    {sending ? "Sending…" : "Send invite"}
                  </button>
                </div>
                <p style={{ margin: "0 0 14px", fontSize: 11, color: muted }}>{roleHint(inviteRole)}</p>

                {/* People with access */}
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", color: muted, marginBottom: 10 }}>
                  PEOPLE WITH ACCESS
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
                  {members.length === 0 && (
                    <p style={{ margin: 0, fontSize: 13, color: muted }}>Only you so far — invite someone below.</p>
                  )}
                  {members.map((m) => {
                    const name = m.display_name || "Collaborator";
                    const seed = String(m.user_id || name);
                    return (
                      <div
                        key={m.id || m.user_id}
                        style={{ display: "flex", alignItems: "center", gap: 12 }}
                      >
                        <div
                          style={{
                            width: 40,
                            height: 40,
                            borderRadius: 999,
                            background: avatarColor(seed),
                            display: "grid",
                            placeItems: "center",
                            fontWeight: 800,
                            fontSize: 15,
                            color: "#fff",
                            flexShrink: 0,
                          }}
                        >
                          {initial(name)}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis" }}>
                            {name}
                            {m.role === myRole && members.length === 1 ? " (you)" : ""}
                          </div>
                          <div style={{ fontSize: 12, color: muted }}>{roleLabel(m.role)}</div>
                        </div>
                        <div style={{ fontSize: 12, color: muted, fontWeight: 600 }}>{roleLabel(m.role)}</div>
                      </div>
                    );
                  })}
                </div>

                <div
                  style={{
                    padding: "10px 12px",
                    borderRadius: 999,
                    border: `1px solid ${border}`,
                    background: "rgba(0,0,0,0.25)",
                    fontSize: 13,
                    color: text,
                    marginBottom: 12,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <span aria-hidden>🔒</span>
                  Only people with the link or invite can join
                </div>

                {/* Copy link row */}
                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    alignItems: "center",
                    padding: 6,
                    paddingLeft: 12,
                    borderRadius: 999,
                    border: `1px solid ${border}`,
                    background: "rgba(0,0,0,0.3)",
                  }}
                >
                  <div
                    style={{
                      flex: 1,
                      minWidth: 0,
                      fontSize: 12,
                      color: muted,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {inviteUrl || "Generate a link to share"}
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void copyLink()}
                    style={{
                      flexShrink: 0,
                      padding: "10px 14px",
                      borderRadius: 999,
                      border: "none",
                      background: `linear-gradient(135deg, ${brass}, #C4893F)`,
                      color: "#1A1208",
                      fontWeight: 800,
                      fontSize: 13,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    {copied ? "Copied" : "Copy link"}
                  </button>
                </div>
              </>
            )}

            {err && (
              <p style={{ color: "#F87171", fontSize: 13, margin: "12px 0 0" }}>{err}</p>
            )}
            {okMsg && (
              <p style={{ color: brass, fontSize: 13, margin: "12px 0 0" }}>{okMsg}</p>
            )}
          </div>
        )}

        {tab === "chat" && (
          <div style={{ padding: 16 }}>
            <p style={{ margin: 0, fontSize: 13, color: muted, lineHeight: 1.5 }}>
              Session is active for this project. Use <strong style={{ color: text }}>Collaborate</strong> to
              invite artists or producers. They open the link, sign up or log in, then join the Console.
            </p>
            {session && (
              <p style={{ margin: "12px 0 0", fontSize: 12, color: muted }}>
                Session id: <code style={{ color: brass }}>{session.id.slice(0, 8)}…</code>
              </p>
            )}
            {session && myRole === "owner" && (
              <button
                type="button"
                style={{ ...ghostBtn, marginTop: 16 }}
                onClick={async () => {
                  if (!session) return;
                  await fetch(`/api/sessions/${session.id}`, { method: "DELETE" });
                  setSession(null);
                  setMembers([]);
                  setInviteUrl(null);
                  setOkMsg("Session ended");
                }}
              >
                End session
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  flex: 1,
  width: "100%",
  padding: "12px 14px",
  borderRadius: 999,
  border: `1px solid ${border}`,
  background: "rgba(0,0,0,0.35)",
  color: text,
  fontSize: 14,
  outline: "none",
};

const primaryBtn: React.CSSProperties = {
  width: "100%",
  padding: "12px 16px",
  borderRadius: 999,
  border: "none",
  background: `linear-gradient(135deg, ${brass}, #C4893F)`,
  color: "#1A1208",
  fontWeight: 800,
  fontSize: 14,
  cursor: "pointer",
};

const ghostBtn: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 999,
  border: `1px solid ${border}`,
  background: "transparent",
  color: muted,
  fontWeight: 600,
  fontSize: 13,
  cursor: "pointer",
};
