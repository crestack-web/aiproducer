"use client";

import { Suspense, useEffect, useRef, useState, type CSSProperties } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { AppShell } from "@/components/app-shell";
import {
  useBeatAudio,
  BeatPreviewTransport,
  BeatPlayButton,
  BeatMoreButton,
  BeatActionsSheet,
} from "@/components/beat-preview-player";
import { analyzeAudioFile } from "@/lib/audio/beat-detect";
import { waitForBeatReady } from "@/lib/studio/poll-beat-ready";
import { useTheme } from "@/lib/theme";
import { ApPaywall } from "@/components/ap-paywall";

// TEMPORARY STUB - FULL FILE RESTORE IN PROGRESS
export default function StudioPage() {
  return (
    <AppShell>
      <div style={{ padding: 24, color: "#F4F1EC" }}>
        Studio is restoring. Please refresh in a moment.
      </div>
    </AppShell>
  );
}
