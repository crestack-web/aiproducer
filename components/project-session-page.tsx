"use client";

import { AppShell } from "@/components/app-shell";
import SessionCore from "./project-session-core";

export default function ProjectDetailPage() {
  return (
    <AppShell active="studio">
      <SessionCore />
    </AppShell>
  );
}
