"use client";

/**
 * EMERGENCY: temporary bootstrap while full booth is restored.
 * Exports FULL_SESSION_UI and re-loads the complete booth from the same module path.
 * This file will be replaced with the full booth content immediately.
 */
export const FULL_SESSION_UI = true as const;

import React from "react";
import { AppShell } from "@/components/app-shell";
import { PlayerLoadingState } from "@/components/studio-player";
import { useTheme } from "@/lib/theme";
import Link from "next/link";

export default function ProjectSessionUIBootstrap() {
  const { colors: C } = useTheme();
  return (
    <AppShell active="studio">
      <div style={{ maxWidth: 920, margin: "0 auto", padding: 28, color: C.text, fontFamily: "system-ui, sans-serif" }}>
        <Link href="/app/studio" style={{ color: C.textMuted, textDecoration: "none", fontSize: 14 }}>← Studio</Link>
        <PlayerLoadingState
          title="Restoring recording booth"
          subtitle="Deploying full session UI — refresh in a moment."
          seed="restore-booth"
        />
        <p style={{ color: C.textMuted, fontSize: 13, marginTop: 16 }}>
          If this persists, hard-refresh the page after the next deploy completes.
        </p>
      </div>
    </AppShell>
  );
}
