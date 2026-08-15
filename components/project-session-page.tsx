"use client";

import { AppShell } from "@/components/app-shell";
import SessionCore from "./project-session-core";

/** Full recording session — section TaskPicker, retakes, beat under vocal — inside Studio shell */
export default function ProjectDetailPage() {
  return (
    <AppShell active="studio">
      <SessionCore />
    </AppShell>
  );
}
