"use client";

/**
 * AP Studio Mixer — channel strips driven by the same TrackFx used in Console + Produce.
 * Mix with AP proposes non-destructive TrackFx updates; artist can undo.
 */
import React, { useMemo, useState } from "react";
import {
  MIX_STYLES,
  buildAutoMixProposal,
  type MixProposal,
  type MixStyleId,
  type MixTrackInput,
  autoTuneModeLabel,
  type AutoTuneModeId,
} from "@/lib/audio/mix-session";

export type MixerChannel = MixTrackInput & {
  color?: string;
  muted?: boolean;
  soloed?: boolean;
  gainDb: number;
  pan: number;
  level?: number;
  autoTuneEnabled?: boolean;
  autoTuneAmount?: number;
  autoTuneMode?: AutoTuneModeId;
};

type Props = {
  open: boolean;
  onClose: () => void;
  channels: MixerChannel[];
  masterGainDb: number;
  onMasterGain: (db: number) => void;
  onGain: (trackId: string, db: number, commit?: boolean) => void;
  onPan: (trackId: string, pan: number, commit?: boolean) => void;
  onMute: (trackId: string) => void;
  onSolo: (trackId: string) => void;
  onOpenFx: (trackId: string) => void;
  onApplyMixProposal: (proposal: MixProposal) => void;
  onUndoMix: () => void;
  canUndoMix: boolean;
  onAutoTuneChange: (
    trackId: string,
    patch: {
      autoTuneEnabled?: number;
      autoTuneAmount?: number;
      autoTuneMode?: number;
    }
  ) => void;
  brass?: string;
  border?: string;
  text?: string;
  mutedText?: string;
  surface?: string;
  isNarrow?: boolean;
};

export function ConsoleMixer(props: Props) {
  const {
    open,
    onClose,
    channels,
    masterGainDb,
    onMasterGain,
    onGain,
    onPan,
    onMute,
    onSolo,
    onOpenFx,
    onApplyMixProposal,
    onUndoMix,
    canUndoMix,
    onAutoTuneChange,
    brass = "#E7A961",
    border = "rgba(255,255,255,0.1)",
    text = "#F5F0E8",
    mutedText = "rgba(245,240,232,0.55)",
    surface = "#12100E",
    isNarrow = false,
  } = props;

  const [style, setStyle] = useState<MixStyleId>("natural");
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  const [proposal, setProposal] = useState<MixProposal | null>(null);
  const [simple, setSimple] = useState(true);

  if (!open) return null;

  async function runAutoMix() {
    setBusy(true);
    setProposal(null);
    const stages = [
      "Analysing tracks…",
      "Detecting instruments and vocals…",
      "Measuring balance…",
      "Building the mix…",
      "Finalising proposal…",
    ];
    try {
      for (const s of stages) {
        setStage(s);
        await new Promise((r) => setTimeout(r, 280));
      }
      const p = buildAutoMixProposal(
        channels.map((c) => ({
          id: c.id,
          label: c.label,
          kind: c.kind,
          roleHint: c.label,
        })),
        style
      );
      setProposal(p);
      setStage(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Mixer"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 80,
        background: "rgba(0,0,0,0.72)",
        display: "flex",
        alignItems: isNarrow ? "flex-end" : "center",
        justifyContent: "center",
        padding: isNarrow ? 0 : 16,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: isNarrow ? "100%" : 960,
          maxHeight: isNarrow ? "92vh" : "88vh",
          borderRadius: isNarrow ? "18px 18px 0 0" : 18,
          background: surface,
          border: `1px solid ${border}`,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          color: text,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "14px 16px",
            borderBottom: `1px solid ${border}`,
            flexShrink: 0,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: 16, letterSpacing: "-0.02em" }}>Mixer</div>
            <div style={{ fontSize: 12, color: mutedText, marginTop: 2 }}>
              Same levels for Console, preview, and export
            </div>
          </div>
          <button
            type="button"
            onClick={() => setSimple((v) => !v)}
            style={chip(border, mutedText)}
          >
            {simple ? "Advanced" : "Simple"}
          </button>
          <button type="button" onClick={onClose} style={chip(border, mutedText)} aria-label="Close">
            ✕
          </button>
        </div>

        {/* AP Auto Mix */}
        <div style={{ padding: "12px 16px", borderBottom: `1px solid ${border}`, flexShrink: 0 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: brass }}>Mix with AP</span>
            <select
              value={style}
              onChange={(e) => setStyle(e.target.value as MixStyleId)}
              disabled={busy}
              style={{
                background: "rgba(255,255,255,0.06)",
                border: `1px solid ${border}`,
                color: text,
                borderRadius: 8,
                padding: "6px 10px",
                fontSize: 12,
                fontFamily: "inherit",
              }}
            >
              {MIX_STYLES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={busy}
              onClick={() => void runAutoMix()}
              style={{
                padding: "8px 14px",
                borderRadius: 999,
                border: "none",
                background: `linear-gradient(180deg, #F0BC80, ${brass})`,
                color: "#1A1208",
                fontWeight: 800,
                fontSize: 13,
                cursor: busy ? "wait" : "pointer",
                fontFamily: "inherit",
                opacity: busy ? 0.7 : 1,
              }}
            >
              {busy ? stage || "Working…" : "Mix with AP"}
            </button>
            {canUndoMix && (
              <button type="button" onClick={onUndoMix} style={chip(border, brass)}>
                Undo mix
              </button>
            )}
          </div>
          {proposal && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 12, color: mutedText, marginBottom: 8 }}>
                Proposed mix — review and apply. Originals stay intact.
              </div>
              <ul style={{ margin: "0 0 10px", paddingLeft: 18, fontSize: 12, lineHeight: 1.45 }}>
                {proposal.summary.slice(0, 6).map((s, i) => (
                  <li key={i} style={{ marginBottom: 4 }}>
                    {s}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => {
                  onApplyMixProposal(proposal);
                  setProposal(null);
                }}
                style={{
                  padding: "8px 14px",
                  borderRadius: 10,
                  border: `1px solid ${brass}`,
                  background: "rgba(231,169,97,0.15)",
                  color: brass,
                  fontWeight: 700,
                  fontSize: 13,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                Apply mix
              </button>
            </div>
          )}
        </div>

        {/* Channel strips */}
        <div
          style={{
            flex: 1,
            overflowX: "auto",
            overflowY: "auto",
            WebkitOverflowScrolling: "touch",
            padding: "12px 10px 16px",
            display: "flex",
            gap: 8,
            alignItems: "stretch",
          }}
        >
          {channels.map((ch) => (
            <ChannelStrip
              key={ch.id}
              ch={ch}
              simple={simple}
              brass={brass}
              border={border}
              text={text}
              mutedText={mutedText}
              onGain={onGain}
              onPan={onPan}
              onMute={onMute}
              onSolo={onSolo}
              onOpenFx={onOpenFx}
              onAutoTuneChange={onAutoTuneChange}
            />
          ))}
          {/* Master */}
          <div
            style={{
              minWidth: isNarrow ? 72 : 88,
              flexShrink: 0,
              borderRadius: 12,
              border: `1px solid ${brass}55`,
              background: "rgba(231,169,97,0.06)",
              padding: "10px 8px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 8,
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 800, color: brass }}>MASTER</div>
            <div style={{ display: "flex", alignItems: "center", gap: 2, height: 140 }}>
              <FaderScale
                min={-24}
                max={6}
                height={140}
                ticks={[6, 0, -6, -12, -18, -24]}
                color={mutedText}
              />
              <input
                type="range"
                min={-24}
                max={6}
                step={0.5}
                value={masterGainDb}
                onChange={(e) => onMasterGain(Number(e.target.value))}
                style={{
                  writingMode: "vertical-lr",
                  direction: "rtl",
                  height: 140,
                  width: 22,
                  accentColor: brass,
                } as React.CSSProperties}
                aria-label="Master volume"
              />
            </div>
            <div style={{ fontSize: 11, fontVariantNumeric: "tabular-nums", color: mutedText }}>
              {masterGainDb > 0 ? "+" : ""}
              {masterGainDb.toFixed(1)} dB
            </div>
          </div>
        </div>

        {!simple && (
          <div
            style={{
              padding: "10px 16px 16px",
              borderTop: `1px solid ${border}`,
              fontSize: 12,
              color: mutedText,
            }}
          >
            Add Auto-Tune from the FX rack on any vocal track. AP detects the key; you set the amount and character. Correction applies on Produce / export.
          </div>
        )}
      </div>
    </div>
  );
}

function chip(border: string, color: string): React.CSSProperties {
  return {
    padding: "6px 10px",
    borderRadius: 8,
    border: `1px solid ${border}`,
    background: "transparent",
    color,
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
  };
}


/** Vertical dB scale beside a fader. Top = max, bottom = min. */
function FaderScale({
  min,
  max,
  height,
  ticks,
  color,
}: {
  min: number;
  max: number;
  height: number;
  ticks: number[];
  color: string;
}) {
  const span = max - min || 1;
  return (
    <div
      style={{
        position: "relative",
        height,
        width: 28,
        flexShrink: 0,
        fontSize: 8,
        fontVariantNumeric: "tabular-nums",
        color,
        userSelect: "none",
      }}
      aria-hidden="true"
    >
      {ticks.map((db) => {
        const pct = ((max - db) / span) * 100; // top = max
        return (
          <div
            key={db}
            style={{
              position: "absolute",
              top: `${pct}%`,
              right: 0,
              transform: "translateY(-50%)",
              whiteSpace: "nowrap",
              lineHeight: 1,
            }}
          >
            {db > 0 ? `+${db}` : db}
          </div>
        );
      })}
    </div>
  );
}

function ChannelStrip(props: {
  ch: MixerChannel;
  simple: boolean;
  brass: string;
  border: string;
  text: string;
  mutedText: string;
  onGain: (id: string, db: number, commit?: boolean) => void;
  onPan: (id: string, pan: number, commit?: boolean) => void;
  onMute: (id: string) => void;
  onSolo: (id: string) => void;
  onOpenFx: (id: string) => void;
  onAutoTuneChange: (
    id: string,
    patch: { autoTuneEnabled?: number; autoTuneAmount?: number; autoTuneMode?: number }
  ) => void;
}) {
  const { ch, simple, brass, border, text, mutedText } = props;
  const mode: AutoTuneModeId =
    ch.autoTuneMode === "modern" ? "modern" : ch.autoTuneMode === "hard" ? "hard" : "natural";

  return (
    <div
      style={{
        minWidth: simple ? 72 : 96,
        maxWidth: 110,
        flexShrink: 0,
        borderRadius: 12,
        border: `1px solid ${border}`,
        background: "rgba(255,255,255,0.03)",
        padding: "10px 6px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 6,
      }}
    >
      <div
        title={ch.label}
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: ch.color || text,
          textAlign: "center",
          maxWidth: "100%",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          width: "100%",
        }}
      >
        {ch.label}
      </div>
      <div style={{ display: "flex", gap: 4 }}>
        <button
          type="button"
          onClick={() => props.onMute(ch.id)}
          style={{
            ...chip(border, ch.muted ? "#F07167" : mutedText),
            padding: "4px 6px",
            fontSize: 10,
            fontWeight: 800,
          }}
          aria-pressed={!!ch.muted}
        >
          M
        </button>
        <button
          type="button"
          onClick={() => props.onSolo(ch.id)}
          style={{
            ...chip(border, ch.soloed ? brass : mutedText),
            padding: "4px 6px",
            fontSize: 10,
            fontWeight: 800,
          }}
          aria-pressed={!!ch.soloed}
        >
          S
        </button>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 2, height: 120 }}>
        <FaderScale
          min={-12}
          max={12}
          height={120}
          ticks={[12, 6, 0, -6, -12]}
          color={mutedText}
        />
        <input
          type="range"
          min={-12}
          max={12}
          step={0.1}
          value={ch.gainDb}
          onChange={(e) => props.onGain(ch.id, Number(e.target.value), false)}
          onMouseUp={(e) => props.onGain(ch.id, Number((e.target as HTMLInputElement).value), true)}
          onTouchEnd={(e) =>
            props.onGain(ch.id, Number((e.target as HTMLInputElement).value), true)
          }
          style={
            {
              writingMode: "vertical-lr",
              direction: "rtl",
              height: 120,
              width: 22,
              accentColor: brass,
            } as React.CSSProperties
          }
          aria-label={`${ch.label} volume`}
        />
      </div>
      <div style={{ fontSize: 10, fontVariantNumeric: "tabular-nums", color: mutedText }}>
        {ch.gainDb > 0 ? "+" : ""}
        {ch.gainDb.toFixed(1)}
      </div>
      <input
        type="range"
        min={-1}
        max={1}
        step={0.05}
        value={ch.pan}
        onChange={(e) => props.onPan(ch.id, Number(e.target.value), false)}
        onMouseUp={(e) => props.onPan(ch.id, Number((e.target as HTMLInputElement).value), true)}
        onTouchEnd={(e) =>
          props.onPan(ch.id, Number((e.target as HTMLInputElement).value), true)
        }
        style={{ width: "90%", accentColor: brass }}
        aria-label={`${ch.label} pan`}
      />
      <div style={{ fontSize: 9, color: mutedText }}>
        {Math.abs(ch.pan) < 0.05
          ? "C"
          : ch.pan < 0
            ? `L${Math.round(-ch.pan * 100)}`
            : `R${Math.round(ch.pan * 100)}`}
      </div>
      <button type="button" onClick={() => props.onOpenFx(ch.id)} style={{ ...chip(border, brass), fontSize: 10 }}>
        FX
      </button>
    </div>
  );
}
