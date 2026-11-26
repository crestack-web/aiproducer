"use client";

import type { ReactNode } from "react";
import "@/app/app/suno-ui.css";

export type BoothMenuItem = {
  key: string;
  label: string;
  hint?: string;
  disabled?: boolean;
  onSelect: () => void;
};

/** Advanced bottom sheet — the only place for extras, incl. Open in Console. */
export function BoothAdvancedSheet({
  open,
  title = "Advanced",
  items,
  children,
  onClose,
}: {
  open: boolean;
  title?: string;
  items?: BoothMenuItem[];
  children?: ReactNode;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <div className="ap-sheet-backdrop" style={{ zIndex: 60 }} role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div className="ap-sheet" onClick={(e) => e.stopPropagation()}>
        <h2 className="ap-sheet-title">{title}</h2>
        <div className="bx-sheet-scroll" style={{ marginTop: 12 }}>
          {items?.length ? (
            <div className="bx-menu">
              {items.map((it) => (
                <button key={it.key} type="button" disabled={it.disabled} onClick={it.onSelect}>
                  <span>
                    {it.label}
                    {it.hint ? <small>{it.hint}</small> : null}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
          {children}
        </div>
        <button type="button" className="ap-sheet-btn ghost" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
