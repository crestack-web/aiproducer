"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import type { ApSession, ApSessionMember, ApSessionRole } from "@/lib/sessions/types";

type Msg = {
  id: string;
  user_id: string | null;
  kind: string;
  body: string;
  created_at: string;
  display_name?: string | null;
};

type Props = {
  projectId: string;
  open: boolean;
  onClose: () => void;
  /** Optional: publish local transport when user plays in Console */
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
const surface = "rgba(22,20,18,0.98)";

function roleLabel(r: string) {
  return r.charAt(0).toUpperCase() + r.slice(1);
}

export default function ApSessionsPanel({
  projectId,
  open,
  onClose,
  transportPlaying,
  transportPositionMs,
  onFollowTransport,
}: Props) {
  const [session, setSession] = useState<ApSession | null>(null);
  const [members, setMembers] = useState<(ApSessionMember & { presence?: string })[]>([]);
  const [myRole, setMyRole] = useState<ApSessionRole | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [inviteRole, setInviteRole] = useState<"artist" | "producer" | "listener">("artist");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<"people" | "chat" | "invite">("people");
  const lastMsgAt = useRef<string | null>(null);
  const lastTransportRev = useRef(0);

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
      setSession(detJ.session);
      setMembers(detJ.members || []);
      setMyRole(detJ.myRole);
    } catch {
      setErr("Network error");
    }
  }, [projectId]);

  const createSession = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, name: "AP Session" }),
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
  };

  const createInvite = async () => {
    if (!session) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/sessions/${session.id}/invites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: inviteRole, expiresInHours: 72 }),
      });
      const j = await res.json();
      if (!res.ok) {
        setErr(j.error || "Could not create invite");
        return;
      }
      setInviteUrl(j.joinUrl || j.joinPath);
      setTab("invite");
    } finally {
      setBusy(false);
    }
  };

  const sendChat = async () => {
    if (!session || !chatInput.trim()) return;
    const body = chatInput.trim();
    setChatInput("");
    const res = await fetch(`/api/sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setErr(j.error || "Could not send");
      return;
    }
    const j = await res.json();
    if (j.message) {
      setMessages((prev) => [...prev, { ...j.message, display_name: "You" }]);
    }
  };

  const endSession = async () => {
    if (!session) return;
    if (!confirm("End this AP Session for everyone?")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/sessions/${session.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "ended" }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setErr(j.error || "Could not end session");
        return;
      }
      setSession(null);
      setMembers([]);
      setMessages([]);
    } finally {
      setBusy(false);
    }
  };

  // Initial load + presence + chat poll
  useEffect(() => {
    if (!open) return;
    void loadSession();
  }, [open, loadSession]);

  useEffect(() => {
    if (!open || !session?.id) return;
    let cancelled = false;

    const tick = async () => {
      try {
        const pres = await fetch(`/api/sessions/${session.id}/presence`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            isPlaying: Boolean(transportPlaying),
          }),
        });
        if (pres.ok) {
          const j = await pres.json();
          if (!cancelled) {
            setMembers(j.members || []);
            if (j.myRole) setMyRole(j.myRole);
          }
        }

        const after = lastMsgAt.current;
        const msgUrl = after
          ? `/api/sessions/${session.id}/messages?after=${encodeURIComponent(after)}`
          : `/api/sessions/${session.id}/messages`;
        const msgRes = await fetch(msgUrl);
        if (msgRes.ok) {
          const j = await msgRes.json();
          const list = (j.messages || []) as Msg[];
          if (list.length && !cancelled) {
            setMessages((prev) => {
              if (!after) return list;
              const ids = new Set(prev.map((m) => m.id));
              const merged = [...prev];
              for (const m of list) {
                if (!ids.has(m.id)) merged.push(m);
              }
              return merged;
            });
            lastMsgAt.current = list[list.length - 1].created_at;
          }
        }

        const tr = await fetch(`/api/sessions/${session.id}/transport`);
        if (tr.ok && onFollowTransport) {
          const j = await tr.json();
          const t = j.transport || {};
          const rev = typeof t.revision === "number" ? t.revision : 0;
          if (rev > lastTransportRev.current && t.updatedBy) {
            lastTransportRev.current = rev;
            onFollowTransport({
              playing: Boolean(t.playing),
              positionMs: Number(t.positionMs) || 0,
              revision: rev,
            });
          }
        }
      } catch {
        /* ignore transient */
      }
    };

    void tick();
    const id = setInterval(tick, 10000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [open, session?.id, transportPlaying, onFollowTransport]);

  // Publish local transport when host plays/pauses (throttled by parent updates)
  useEffect(() => {
    if (!open || !session?.id) return;
    if (typeof transportPlaying !== "boolean") return;
    const positionMs = transportPositionMs ?? 0;
    void fetch(`/api/sessions/${session.id}/transport`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        playing: transportPlaying,
        positionMs,
        clientTs: Date.now(),
      }),
    }).then(async (res) => {
      if (res.ok) {
        const j = await res.json();
        if (j.transport?.revision) lastTransportRev.current = j.transport.revision;
      }
    });
  }, [open, session?.id, transportPlaying, transportPositionMs]);

  if (!open) return null;

  const canInvite = myRole === "owner" || myRole === "producer";
  const canEnd = myRole === "owner";

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 95,
        background: "rgba(0,0,0,0.72)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 12,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(420px, 100%)",
          maxHeight: "88vh",
          overflow: "auto",
          borderRadius: 18,
          border: `1px solid ${border}`,
          background: surface,
          boxShadow: "0 28px 90px rgba(0,0,0,0.6)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "14px 16px",
            borderBottom: `1px solid ${border}`,
          }}
        >
          <div>
            <div style={{ fontWeight: 800, fontSize: 16, color: "#F5F0E8" }}>AP Sessions</div>
            <div style={{ fontSize: 11, color: muted, marginTop: 2 }}>
              Remote collaboration on this project
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              border: `1px solid ${border}`,
              background: "rgba(0,0,0,0.35)",
              color: muted,
              cursor: "pointer",
            }}
          >
            ×
          </button>
        </div>

        <div style={{ padding: 16 }}>
          {err && (
            <p style={{ color: "#F87171", fontSize: 13, margin: "0 0 12px" }}>{String(err)}</p>
          )}

          {!session ? (
            <div style={{ textAlign: "center", padding: "24px 8px" }}>
              <p style={{ color: muted, fontSize: 13, lineHeight: 1.5, margin: "0 0 16px" }}>
                Start an AP Session so collaborators can join, chat, follow playback, and submit
                takes — without overwriting your project.
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={() => void createSession()}
                style={{
                  padding: "12px 20px",
                  borderRadius: 12,
                  border: "none",
                  background: brass,
                  color: "#1A1208",
                  fontWeight: 800,
                  cursor: busy ? "wait" : "pointer",
                  fontFamily: "inherit",
                }}
              >
                {busy ? "Creating…" : "Create AP Session"}
              </button>
            </div>
          ) : (
            <>
              <div
                style={{
                  padding: 12,
                  borderRadius: 12,
                  border: `1px solid ${border}`,
                  background: "rgba(0,0,0,0.28)",
                  marginBottom: 12,
                }}
              >
                <div style={{ fontWeight: 700, color: "#F5F0E8" }}>{session.name}</div>
                <div style={{ fontSize: 11, color: muted, marginTop: 4 }}>
                  Status · {session.status}
                  {myRole ? ` · You are ${roleLabel(myRole)}` : ""}
                </div>
              </div>

              <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
                {(["people", "chat", "invite"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTab(t)}
                    style={{
                      flex: 1,
                      padding: "8px",
                      borderRadius: 10,
                      border: `1px solid ${tab === t ? brass : border}`,
                      background: tab === t ? "rgba(231,169,97,0.12)" : "transparent",
                      color: tab === t ? brass : muted,
                      fontWeight: 700,
                      fontSize: 12,
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    {t === "people" ? "People" : t === "chat" ? "Chat" : "Invite"}
                  </button>
                ))}
              </div>

              {tab === "people" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {members.map((m) => (
                    <div
                      key={m.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: "10px 12px",
                        borderRadius: 12,
                        border: `1px solid ${border}`,
                        background: "rgba(0,0,0,0.25)",
                      }}
                    >
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          background: m.presence === "online" ? "#4ADE80" : muted,
                          boxShadow: m.presence === "online" ? "0 0 8px #4ADE80" : "none",
                        }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 650, color: "#F5F0E8", fontSize: 13 }}>
                          {m.display_name || "Collaborator"}
                        </div>
                        <div style={{ fontSize: 11, color: muted }}>
                          {roleLabel(m.role)}
                          {m.is_recording ? " · recording" : ""}
                          {m.is_playing ? " · playing" : ""}
                        </div>
                      </div>
                    </div>
                  ))}
                  {!members.length && (
                    <p style={{ color: muted, fontSize: 13 }}>No members yet.</p>
                  )}
                </div>
              )}

              {tab === "chat" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <div
                    style={{
                      maxHeight: 240,
                      overflow: "auto",
                      display: "flex",
                      flexDirection: "column",
                      gap: 8,
                      padding: 8,
                      borderRadius: 12,
                      border: `1px solid ${border}`,
                      background: "rgba(0,0,0,0.3)",
                    }}
                  >
                    {messages.map((m) => (
                      <div key={m.id} style={{ fontSize: 13 }}>
                        <span style={{ color: m.kind === "system" ? brass : muted, fontWeight: 650 }}>
                          {m.kind === "system" ? "System" : m.display_name || "User"}
                        </span>
                        <span style={{ color: "#E8E2D6", marginLeft: 8 }}>{m.body}</span>
                      </div>
                    ))}
                    {!messages.length && (
                      <p style={{ color: muted, fontSize: 12, margin: 0 }}>No messages yet.</p>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void sendChat();
                      }}
                      placeholder="Message the session…"
                      maxLength={2000}
                      style={{
                        flex: 1,
                        padding: "10px 12px",
                        borderRadius: 10,
                        border: `1px solid ${border}`,
                        background: "rgba(0,0,0,0.35)",
                        color: "#F5F0E8",
                        fontFamily: "inherit",
                        fontSize: 13,
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => void sendChat()}
                      style={{
                        padding: "10px 14px",
                        borderRadius: 10,
                        border: "none",
                        background: brass,
                        color: "#1A1208",
                        fontWeight: 700,
                        cursor: "pointer",
                        fontFamily: "inherit",
                      }}
                    >
                      Send
                    </button>
                  </div>
                </div>
              )}

              {tab === "invite" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {!canInvite ? (
                    <p style={{ color: muted, fontSize: 13 }}>
                      Only the owner or a producer can create invites.
                    </p>
                  ) : (
                    <>
                      <label style={{ fontSize: 12, color: muted }}>
                        Role for invite
                        <select
                          value={inviteRole}
                          onChange={(e) =>
                            setInviteRole(e.target.value as "artist" | "producer" | "listener")
                          }
                          style={{
                            display: "block",
                            width: "100%",
                            marginTop: 6,
                            padding: 10,
                            borderRadius: 10,
                            border: `1px solid ${border}`,
                            background: "rgba(0,0,0,0.35)",
                            color: "#F5F0E8",
                            fontFamily: "inherit",
                          }}
                        >
                          <option value="artist">Artist — record & submit takes</option>
                          <option value="producer">Producer — edit & review</option>
                          <option value="listener">Listener — listen & chat</option>
                        </select>
                      </label>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void createInvite()}
                        style={{
                          padding: "12px",
                          borderRadius: 12,
                          border: "none",
                          background: brass,
                          color: "#1A1208",
                          fontWeight: 800,
                          cursor: busy ? "wait" : "pointer",
                          fontFamily: "inherit",
                        }}
                      >
                        Generate invite link
                      </button>
                      {inviteUrl && (
                        <div
                          style={{
                            padding: 12,
                            borderRadius: 12,
                            border: `1px solid ${border}`,
                            background: "rgba(0,0,0,0.35)",
                            wordBreak: "break-all",
                            fontSize: 12,
                            color: "#E8E2D6",
                          }}
                        >
                          {inviteUrl}
                          <button
                            type="button"
                            onClick={() => void navigator.clipboard?.writeText(inviteUrl)}
                            style={{
                              display: "block",
                              marginTop: 10,
                              padding: "8px 12px",
                              borderRadius: 8,
                              border: `1px solid ${border}`,
                              background: "transparent",
                              color: brass,
                              fontWeight: 700,
                              cursor: "pointer",
                              fontFamily: "inherit",
                              width: "100%",
                            }}
                          >
                            Copy link
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {canEnd && (
                <button
                  type="button"
                  onClick={() => void endSession()}
                  style={{
                    marginTop: 16,
                    width: "100%",
                    padding: "10px",
                    borderRadius: 10,
                    border: `1px solid ${border}`,
                    background: "transparent",
                    color: muted,
                    fontSize: 12,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  End session
                </button>
              )}

              <p style={{ margin: "12px 0 0", fontSize: 11, color: muted, lineHeight: 1.45 }}>
                Playback sync is best-effort across devices (not sample-accurate). Presence uses a
                heartbeat — offline after ~45s without a pulse.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
