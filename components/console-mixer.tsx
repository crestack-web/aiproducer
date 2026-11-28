"use client";

/**
 * AP Studio Mixer — channel controls driven by the same TrackFx used in Console + Produce.
 * Mix with AP proposes non-destructive TrackFx updates; artist can undo.
 */
import React, { useState } from "react";
import {
  MIX_STYLES,
  buildAutoMixProposal,
  type MixProposal,
  type MixStyleId,
  type MixTrackInput,
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
    brass = "#C17A12",
    border = "rgba(255,255,255,0.1)",
    text = "#F5F3EE",
    mutedText = "rgba(245,243,238,0.58)",
    surface = "#111113",
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
      const nextProposal = buildAutoMixProposal(
        channels.map((channel) => ({
          id: channel.id,
          label: channel.label,
          kind: channel.kind,
          roleHint: channel.label,
        })),
        style
      );
      setProposal(nextProposal);
      setStage(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="ap-mixer-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ap-mixer-title"
      onClick={onClose}
    >
      <section className={`ap-mixer-sheet${isNarrow ? " is-narrow" : ""}`} onClick={(event) => event.stopPropagation()}>
        {isNarrow && <div className="ap-mixer-handle" aria-hidden="true" />}

        <header className="ap-mixer-header">
          <div className="ap-mixer-heading">
            <span className="ap-mixer-eyebrow" style={{ color: brass }}>MIX CONSOLE</span>
            <h2 id="ap-mixer-title">Balance your tracks</h2>
            <p>Adjust each part, preview the mix, then export when it feels right.</p>
          </div>
          <button type="button" className="ap-mixer-close" onClick={onClose} aria-label="Close mixer">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>

        <div className="ap-mixer-toolbar">
          <div className="ap-mixer-view-toggle" aria-label="Mixer detail level">
            <button type="button" className={simple ? "active" : ""} onClick={() => setSimple(true)} aria-pressed={simple}>
              Essential
            </button>
            <button type="button" className={!simple ? "active" : ""} onClick={() => setSimple(false)} aria-pressed={!simple}>
              All controls
            </button>
          </div>
          <span className="ap-mixer-track-count">{channels.length} {channels.length === 1 ? "track" : "tracks"}</span>
        </div>

        <div className="ap-mixer-scroll">
          <section className="ap-mix-assistant" aria-labelledby="ap-mix-assistant-title">
            <div className="ap-mix-assistant-copy">
              <span className="ap-mix-assistant-icon" style={{ color: brass }} aria-hidden="true">✦</span>
              <div>
                <h3 id="ap-mix-assistant-title">Get a balanced starting point</h3>
                <p>AP suggests levels for your tracks. You can review everything before applying it.</p>
              </div>
            </div>
            <div className="ap-mix-assistant-actions">
              <label>
                <span>Mix style</span>
                <select value={style} onChange={(event) => setStyle(event.target.value as MixStyleId)} disabled={busy}>
                  {MIX_STYLES.map((mixStyle) => (
                    <option key={mixStyle.id} value={mixStyle.id}>{mixStyle.label}</option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="ap-mix-primary"
                style={{ background: brass }}
                disabled={busy || channels.length === 0}
                onClick={() => void runAutoMix()}
              >
                {busy ? stage || "Working…" : "Suggest a mix"}
              </button>
              {canUndoMix && (
                <button type="button" className="ap-mix-text-button" onClick={onUndoMix}>Undo last mix</button>
              )}
            </div>
            {proposal && (
              <div className="ap-mix-proposal">
                <div>
                  <strong>Your suggested mix is ready</strong>
                  <p>Review the changes below. Your current settings stay untouched until you apply them.</p>
                </div>
                <ul>
                  {proposal.summary.slice(0, 6).map((summary, index) => <li key={index}>{summary}</li>)}
                </ul>
                <div className="ap-mix-proposal-actions">
                  <button
                    type="button"
                    className="ap-mix-primary"
                    style={{ background: brass }}
                    onClick={() => {
                      onApplyMixProposal(proposal);
                      setProposal(null);
                    }}
                  >
                    Apply suggested mix
                  </button>
                  <button type="button" className="ap-mix-secondary" onClick={() => setProposal(null)}>Keep my settings</button>
                </div>
              </div>
            )}
          </section>

          <div className="ap-mixer-section-heading">
            <div>
              <h3>Track controls</h3>
              <p>{simple ? "The everyday controls, without the clutter." : "Volume, stereo position and effects for every track."}</p>
            </div>
            <span>Changes save automatically</span>
          </div>

          <div className="ap-channel-grid">
            {channels.map((channel) => (
              <ChannelCard
                key={channel.id}
                channel={channel}
                showAdvanced={!simple}
                brass={brass}
                mutedText={mutedText}
                onGain={onGain}
                onPan={onPan}
                onMute={onMute}
                onSolo={onSolo}
                onOpenFx={onOpenFx}
              />
            ))}

            <article className="ap-channel-card ap-master-card" style={{ borderColor: `${brass}66` }}>
              <div className="ap-channel-title-row">
                <span className="ap-channel-dot" style={{ background: brass }} aria-hidden="true" />
                <div>
                  <h4>Master</h4>
                  <span>Final output</span>
                </div>
              </div>
              <label className="ap-control-label" htmlFor="ap-master-volume">
                <span>Output volume</span>
                <strong>{formatDb(masterGainDb)}</strong>
              </label>
              <input
                id="ap-master-volume"
                className="ap-mixer-range"
                type="range"
                min={-24}
                max={6}
                step={0.5}
                value={masterGainDb}
                onChange={(event) => onMasterGain(Number(event.target.value))}
                style={{ accentColor: brass }}
              />
              <div className="ap-range-labels" style={{ color: mutedText }}><span>−24 dB</span><span>+6 dB</span></div>
              <p className="ap-master-note">Controls the volume of the full song.</p>
            </article>
          </div>

          {channels.length === 0 && (
            <div className="ap-mixer-empty">Add a track to start shaping your mix.</div>
          )}
        </div>
      </section>

      <style>{`
        .ap-mixer-backdrop {
          position: fixed; inset: 0; z-index: 80; display: flex; align-items: center; justify-content: center;
          padding: 20px; background: rgba(0,0,0,.76); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
          color: ${text}; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          animation: apMixerFade .18s ease-out;
        }
        .ap-mixer-sheet {
          width: 100%; max-width: 980px; max-height: 90vh; display: flex; flex-direction: column; overflow: hidden;
          border: 1px solid ${border}; border-radius: 24px; background: ${surface};
          box-shadow: 0 32px 100px rgba(0,0,0,.58); animation: apMixerUp .22s ease-out;
        }
        .ap-mixer-sheet.is-narrow { max-height: 94dvh; border-radius: 28px 28px 0 0; border-bottom: 0; }
        .ap-mixer-handle { width: 40px; height: 4px; border-radius: 999px; background: rgba(255,255,255,.2); margin: 10px auto 0; flex-shrink: 0; }
        .ap-mixer-header { display: flex; align-items: flex-start; gap: 20px; padding: 24px 26px 18px; flex-shrink: 0; }
        .ap-mixer-heading { min-width: 0; }
        .ap-mixer-eyebrow { display: block; font-size: 10px; line-height: 1; font-weight: 800; letter-spacing: .14em; margin-bottom: 9px; }
        .ap-mixer-heading h2 { margin: 0; color: ${text}; font-size: 24px; line-height: 1.15; letter-spacing: -.035em; font-weight: 750; }
        .ap-mixer-heading p { margin: 7px 0 0; color: ${mutedText}; font-size: 13px; line-height: 1.5; }
        .ap-mixer-close { margin-left: auto; width: 38px; height: 38px; flex: 0 0 38px; display: grid; place-items: center; border: 1px solid ${border}; border-radius: 12px; background: rgba(255,255,255,.045); color: ${mutedText}; cursor: pointer; }
        .ap-mixer-close:hover { color: ${text}; background: rgba(255,255,255,.08); }
        .ap-mixer-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 0 26px 18px; flex-shrink: 0; }
        .ap-mixer-view-toggle { display: inline-flex; gap: 3px; padding: 3px; border-radius: 11px; background: rgba(255,255,255,.055); border: 1px solid rgba(255,255,255,.06); }
        .ap-mixer-view-toggle button { min-height: 32px; padding: 0 13px; border: 0; border-radius: 8px; background: transparent; color: ${mutedText}; font: 650 12px/1 inherit; cursor: pointer; }
        .ap-mixer-view-toggle button.active { color: ${text}; background: rgba(255,255,255,.1); box-shadow: 0 1px 3px rgba(0,0,0,.25); }
        .ap-mixer-track-count { color: ${mutedText}; font-size: 12px; white-space: nowrap; }
        .ap-mixer-scroll { overflow-y: auto; overscroll-behavior: contain; padding: 0 26px 28px; }
        .ap-mix-assistant { padding: 18px; border-radius: 18px; border: 1px solid ${brass}45; background: linear-gradient(135deg, ${brass}12, rgba(255,255,255,.025) 62%); }
        .ap-mix-assistant-copy { display: flex; align-items: flex-start; gap: 12px; }
        .ap-mix-assistant-icon { width: 34px; height: 34px; flex: 0 0 34px; display: grid; place-items: center; border-radius: 11px; background: ${brass}18; font-size: 17px; }
        .ap-mix-assistant h3, .ap-mixer-section-heading h3 { margin: 0; font-size: 14px; line-height: 1.3; color: ${text}; font-weight: 700; }
        .ap-mix-assistant-copy p, .ap-mixer-section-heading p { margin: 4px 0 0; font-size: 12px; line-height: 1.5; color: ${mutedText}; }
        .ap-mix-assistant-actions { display: flex; align-items: flex-end; flex-wrap: wrap; gap: 9px; margin-top: 15px; }
        .ap-mix-assistant-actions label { display: flex; flex-direction: column; gap: 6px; }
        .ap-mix-assistant-actions label > span { color: ${mutedText}; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; }
        .ap-mix-assistant-actions select { height: 38px; min-width: 140px; padding: 0 32px 0 11px; border: 1px solid ${border}; border-radius: 10px; background: #1a1a1e; color: ${text}; font: 600 12px/1 inherit; }
        .ap-mix-primary, .ap-mix-secondary, .ap-mix-text-button { min-height: 38px; padding: 0 15px; border-radius: 10px; font: 750 12px/1 inherit; cursor: pointer; }
        .ap-mix-primary { border: 0; color: #0B0A0F; box-shadow: 0 5px 18px ${brass}24; }
        .ap-mix-primary:disabled { cursor: wait; opacity: .55; }
        .ap-mix-secondary { border: 1px solid ${border}; color: ${text}; background: rgba(255,255,255,.04); }
        .ap-mix-text-button { border: 0; color: ${mutedText}; background: transparent; text-decoration: underline; text-underline-offset: 3px; }
        .ap-mix-proposal { margin-top: 16px; padding-top: 16px; border-top: 1px solid ${border}; }
        .ap-mix-proposal strong { font-size: 13px; color: ${text}; }
        .ap-mix-proposal p { margin: 4px 0 0; font-size: 12px; color: ${mutedText}; line-height: 1.45; }
        .ap-mix-proposal ul { margin: 12px 0; padding-left: 18px; color: ${mutedText}; font-size: 12px; line-height: 1.55; }
        .ap-mix-proposal-actions { display: flex; flex-wrap: wrap; gap: 8px; }
        .ap-mixer-section-heading { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; margin: 24px 1px 12px; }
        .ap-mixer-section-heading > span { color: ${mutedText}; font-size: 11px; white-space: nowrap; }
        .ap-channel-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 12px; }
        .ap-channel-card { min-width: 0; padding: 16px; border: 1px solid ${border}; border-radius: 17px; background: rgba(255,255,255,.032); }
        .ap-channel-title-row { display: flex; align-items: center; gap: 10px; margin-bottom: 15px; }
        .ap-channel-dot { width: 9px; height: 34px; flex: 0 0 9px; border-radius: 999px; }
        .ap-channel-title-row > div { min-width: 0; }
        .ap-channel-title-row h4 { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin: 0; color: ${text}; font-size: 14px; line-height: 1.3; font-weight: 700; text-transform: capitalize; }
        .ap-channel-title-row span:not(.ap-channel-dot) { display: block; margin-top: 3px; color: ${mutedText}; font-size: 11px; text-transform: capitalize; }
        .ap-channel-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; margin-bottom: 17px; }
        .ap-channel-actions button { height: 34px; border: 1px solid ${border}; border-radius: 9px; background: rgba(255,255,255,.035); color: ${mutedText}; font: 650 11px/1 inherit; cursor: pointer; }
        .ap-channel-actions button[aria-pressed="true"] { color: ${text}; background: rgba(255,255,255,.1); }
        .ap-channel-actions button.ap-mute-active { border-color: rgba(240,113,103,.42); background: rgba(240,113,103,.13); color: #F07167; }
        .ap-channel-actions button.ap-solo-active { border-color: ${brass}66; background: ${brass}1f; color: ${brass}; }
        .ap-control-label { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin: 0 0 10px; color: ${mutedText}; font-size: 11px; }
        .ap-control-label strong { color: ${text}; font-size: 11px; font-variant-numeric: tabular-nums; }
        .ap-mixer-range { display: block; width: 100%; height: 20px; margin: 0; cursor: pointer; }
        .ap-range-labels { display: flex; align-items: center; justify-content: space-between; margin-top: 2px; font-size: 9px; }
        .ap-pan-control { margin-top: 15px; padding-top: 14px; border-top: 1px solid rgba(255,255,255,.065); }
        .ap-effects-button { width: 100%; min-height: 36px; display: flex; align-items: center; justify-content: space-between; margin-top: 14px; padding: 0 11px; border: 1px solid ${border}; border-radius: 10px; background: transparent; color: ${text}; font: 650 11px/1 inherit; cursor: pointer; }
        .ap-effects-button:hover { border-color: ${brass}77; color: ${brass}; }
        .ap-master-card { background: ${brass}0b; }
        .ap-master-note { margin: 16px 0 0; padding-top: 13px; border-top: 1px solid ${border}; color: ${mutedText}; font-size: 11px; line-height: 1.45; }
        .ap-mixer-empty { margin-top: 12px; padding: 18px; border: 1px dashed ${border}; border-radius: 14px; color: ${mutedText}; text-align: center; font-size: 12px; }
        .ap-mixer-backdrop button:focus-visible, .ap-mixer-backdrop select:focus-visible, .ap-mixer-backdrop input:focus-visible { outline: 2px solid ${brass}; outline-offset: 2px; }
        @keyframes apMixerFade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes apMixerUp { from { opacity: 0; transform: translateY(14px) scale(.99); } to { opacity: 1; transform: translateY(0) scale(1); } }
        @media (max-width: 640px) {
          .ap-mixer-backdrop { align-items: flex-end; padding: 0; }
          .ap-mixer-header { padding: 16px 18px 14px; gap: 12px; }
          .ap-mixer-heading h2 { font-size: 21px; }
          .ap-mixer-heading p { font-size: 12px; }
          .ap-mixer-toolbar { padding: 0 18px 14px; }
          .ap-mixer-scroll { padding: 0 18px max(24px, env(safe-area-inset-bottom)); }
          .ap-mix-assistant { padding: 15px; }
          .ap-mix-assistant-actions { align-items: stretch; }
          .ap-mix-assistant-actions label { flex: 1; }
          .ap-mix-assistant-actions select { width: 100%; min-width: 0; box-sizing: border-box; }
          .ap-mix-primary { flex: 1; }
          .ap-mixer-section-heading > span { display: none; }
          .ap-channel-grid { grid-template-columns: 1fr; }
        }
        @media (prefers-reduced-motion: reduce) {
          .ap-mixer-backdrop, .ap-mixer-sheet { animation: none; }
        }
      `}</style>
    </div>
  );
}

function formatDb(value: number) {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)} dB`;
}

function formatPan(value: number) {
  if (Math.abs(value) < 0.05) return "Center";
  return `${value < 0 ? "Left" : "Right"} ${Math.round(Math.abs(value) * 100)}%`;
}

function ChannelCard(props: {
  channel: MixerChannel;
  showAdvanced: boolean;
  brass: string;
  mutedText: string;
  onGain: (id: string, db: number, commit?: boolean) => void;
  onPan: (id: string, pan: number, commit?: boolean) => void;
  onMute: (id: string) => void;
  onSolo: (id: string) => void;
  onOpenFx: (id: string) => void;
}) {
  const { channel, showAdvanced, brass, mutedText } = props;
  const volumeId = `ap-volume-${channel.id}`;
  const panId = `ap-pan-${channel.id}`;

  return (
    <article className="ap-channel-card">
      <div className="ap-channel-title-row">
        <span className="ap-channel-dot" style={{ background: channel.color || brass }} aria-hidden="true" />
        <div>
          <h4 title={channel.label}>{channel.label}</h4>
          <span>{channel.kind === "vocal" ? "Vocal track" : channel.kind === "beat" ? "Beat track" : "Audio track"}</span>
        </div>
      </div>

      <div className="ap-channel-actions">
        <button
          type="button"
          className={channel.muted ? "ap-mute-active" : ""}
          onClick={() => props.onMute(channel.id)}
          aria-pressed={Boolean(channel.muted)}
          aria-label={`${channel.muted ? "Unmute" : "Mute"} ${channel.label}`}
        >
          {channel.muted ? "Muted" : "Mute"}
        </button>
        <button
          type="button"
          className={channel.soloed ? "ap-solo-active" : ""}
          onClick={() => props.onSolo(channel.id)}
          aria-pressed={Boolean(channel.soloed)}
          aria-label={`${channel.soloed ? "Unsolo" : "Solo"} ${channel.label}`}
        >
          {channel.soloed ? "Soloed" : "Solo"}
        </button>
      </div>

      <label className="ap-control-label" htmlFor={volumeId}>
        <span>Volume</span>
        <strong>{formatDb(channel.gainDb)}</strong>
      </label>
      <input
        id={volumeId}
        className="ap-mixer-range"
        type="range"
        min={-12}
        max={12}
        step={0.1}
        value={channel.gainDb}
        onChange={(event) => props.onGain(channel.id, Number(event.target.value), false)}
        onPointerUp={(event) => props.onGain(channel.id, Number((event.target as HTMLInputElement).value), true)}
        onKeyUp={(event) => props.onGain(channel.id, Number((event.target as HTMLInputElement).value), true)}
        style={{ accentColor: brass }}
      />
      <div className="ap-range-labels" style={{ color: mutedText }}><span>−12 dB</span><span>+12 dB</span></div>

      {showAdvanced && (
        <div className="ap-pan-control">
          <label className="ap-control-label" htmlFor={panId}>
            <span>Stereo position</span>
            <strong>{formatPan(channel.pan)}</strong>
          </label>
          <input
            id={panId}
            className="ap-mixer-range"
            type="range"
            min={-1}
            max={1}
            step={0.05}
            value={channel.pan}
            onChange={(event) => props.onPan(channel.id, Number(event.target.value), false)}
            onPointerUp={(event) => props.onPan(channel.id, Number((event.target as HTMLInputElement).value), true)}
            onKeyUp={(event) => props.onPan(channel.id, Number((event.target as HTMLInputElement).value), true)}
            style={{ accentColor: brass }}
          />
          <div className="ap-range-labels" style={{ color: mutedText }}><span>Left</span><span>Center</span><span>Right</span></div>
        </div>
      )}

      <button type="button" className="ap-effects-button" onClick={() => props.onOpenFx(channel.id)}>
        <span>Open effects</span><span aria-hidden="true">→</span>
      </button>
    </article>
  );
}
