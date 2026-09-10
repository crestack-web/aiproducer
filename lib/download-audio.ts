/**
 * Force-download audio from a signed URL (does not open in browser player).
 */
export async function forceDownloadFromApi(
  projectId: string,
  format: "wav" | "mp3",
  fallbackName?: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch(
      `/api/projects/${projectId}/download?kind=master&format=${format}`
    );
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.download_url) {
      return { ok: false, error: (j as { error?: string }).error || "Download not available" };
    }
    const filename =
      (j as { filename?: string }).filename ||
      fallbackName ||
      `song.${format}`;

    // Fetch as blob so the browser saves a file instead of navigating/playing
    const fileRes = await fetch((j as { download_url: string }).download_url);
    if (!fileRes.ok) {
      return { ok: false, error: "Could not fetch audio file" };
    }
    const blob = await fileRes.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = filename;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 2_000);
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Download failed",
    };
  }
}
