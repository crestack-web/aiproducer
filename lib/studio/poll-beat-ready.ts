/**
 * After generate-beat returns while provider is still working, poll projects
 * until the beat is ready (or fail / timeout). Keeps UI in "Generating…" state.
 *
 * IMPORTANT: Never treat "still generating" as a hard failure that should delete
 * the project. Callers must not discard the project on timeout.
 */
export type WaitForBeatResult =
  | { ok: true; reason: "ready" | "has_beat" | "already_ready" }
  | { ok: false; reason: "failed" | "timeout"; status?: string };

export async function waitForBeatReady(
  projectId: string,
  beatJson: { status?: string; beat?: { audio_path?: string } | null },
  opts?: { timeoutMs?: number; intervalMs?: number }
): Promise<WaitForBeatResult> {
  const beatStatus = String(beatJson?.status || "");
  const hasAudio = Boolean(beatJson?.beat?.audio_path);
  if (beatStatus !== "processing" && hasAudio) {
    return { ok: true, reason: "already_ready" };
  }
  // Immediate complete status from API
  if (beatStatus === "complete" || beatStatus === "ready") {
    return { ok: true, reason: "already_ready" };
  }

  const timeoutMs = opts?.timeoutMs ?? 180_000; // 3 min — drill/long gens need more than 90s
  const intervalMs = opts?.intervalMs ?? 2_000;
  const deadline = Date.now() + timeoutMs;
  let lastStatus: string | undefined;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, intervalMs));
    try {
      const pr = await fetch("/api/projects");
      if (!pr.ok) continue;
      const pj = await pr.json();
      const list = (pj.projects || []) as Array<{
        id: string;
        status?: string;
        has_beat?: boolean;
      }>;
      const row = list.find((x) => x.id === projectId);
      if (!row) continue;
      lastStatus = row.status;
      if (
        row.has_beat ||
        row.status === "beat_ready" ||
        row.status === "analyzing" ||
        row.status === "blueprint_ready" ||
        row.status === "recording" ||
        row.status === "complete" ||
        row.status === "completed"
      ) {
        return { ok: true, reason: row.has_beat ? "has_beat" : "ready" };
      }
      if (row.status === "failed") {
        // Only fail if there is truly no beat row
        if (row.has_beat) return { ok: true, reason: "has_beat" };
        return { ok: false, reason: "failed", status: "failed" };
      }
      // generating_beat / processing / draft → keep waiting
    } catch {
      /* network blip — keep polling */
    }
  }

  // Timeout: soft result — project must NOT be deleted by caller
  return { ok: false, reason: "timeout", status: lastStatus };
}
