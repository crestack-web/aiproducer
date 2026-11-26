"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useParams } from "next/navigation";
import { normalizeEditMode } from "@/lib/edit-ownership";
import { EditingInConsole } from "@/components/booth/editing-in-console";

type GateProject = { title?: string | null; edit_mode?: string | null; master_url?: string | null };

/**
 * Wraps the Booth screen. Once a song was handed off to Console
 * (projects.edit_mode = 'console'), Booth is listen-only.
 */
export function BoothOwnershipGate({ children }: { children: ReactNode }) {
  const id = useParams().id as string;
  const [project, setProject] = useState<GateProject | null>(null);
  const [listenUrl, setListenUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetch(`/api/projects/${id}`).catch(() => null);
      if (!res?.ok || cancelled) return;
      const j = await res.json().catch(() => ({}));
      const p = (j.project || j) as GateProject;
      if (cancelled) return;
      setProject(p);
      if (normalizeEditMode(p.edit_mode) !== "console") return;
      if (p.master_url) {
        setListenUrl(p.master_url);
        return;
      }
      const prev = await fetch(`/api/projects/${id}/session-preview`).catch(() => null);
      if (!prev?.ok || cancelled) return;
      const pj = await prev.json().catch(() => ({}));
      setListenUrl(pj.master_url || pj.mix_url || pj.beat_url || pj.beatUrl || null);
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (project && normalizeEditMode(project.edit_mode) === "console") {
    return <EditingInConsole projectId={id} songTitle={project.title} listenUrl={listenUrl} />;
  }
  return <>{children}</>;
}
