/**
 * After generate-beat returns while provider is still working, poll projects
 * until the beat is ready (or fail / timeout). Keeps UI in "Generating…" state.
 */
export async function waitForBeatReady(
  projectId: string,
  beatJson: { status?: string; beat?: { audio_path?: string } | null },
  opts?: { timeoutMs?: number; intervalMs?: number }
): Promise<void> {
  const beatStatus = String(beatJson?.status || "");
  const hasAudio = Boolean(beatJson?.beat?.audio_path);
  if (beatStatus !== "processing" && hasAudio) return;

  const timeoutMs = opts?.timeoutMs ?? 90_000;
  const intervalMs = opts?.intervalMs ?? 2_000;
  const deadline = Date.now() + timeoutMs;

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
      if (
        row?.has_beat ||
        row?.status === "beat_ready" ||
        row?.status === "analyzing" ||
        row?.status === "blueprint_ready"
      ) {
        return;
      }
      if (row?.status === "failed") {
        throw new Error("Beat generation failed. Try again.");
      }
    } catch (e) {
      if (e instanceof Error && e.message.includes("failed")) throw e;
    }
  }
  throw new Error(
    "Beat is still generating. Wait a moment, then open it from Your beats — or try Create beat again."
  );
}
