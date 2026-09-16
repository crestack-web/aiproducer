/**
 * Force-download audio from the project download API (does not rely on navigating away).
 * Handles paywall errors and CORS-blocked signed URLs with a fallback.
 */
export async function forceDownloadFromApi(
  projectId: string,
  format: "wav" | "mp3",
  fallbackName?: string
): Promise<{ ok: true } | { ok: false; error: string; code?: string }> {
  try {
    const res = await fetch(
      `/api/projects/${projectId}/download?kind=master&format=${format}`,
      { credentials: "same-origin" }
    );
    const j = (await res.json().catch(() => ({}))) as {
      download_url?: string;
      filename?: string;
      error?: string;
      message?: string;
      code?: string;
      available?: string[];
    };

    if (res.status === 402 || j.code === "PAYWALL") {
      return {
        ok: false,
        code: "PAYWALL",
        error:
          j.message ||
          j.error ||
          "Unlock this song (or a plan) to download the master.",
      };
    }

    if (!res.ok || !j.download_url) {
      return {
        ok: false,
        error: j.error || j.message || "Download not available yet.",
      };
    }

    const filename = j.filename || fallbackName || `song.${format}`;
    const downloadUrl = j.download_url;

    // Prefer same-origin blob save; signed storage URLs often fail CORS on fetch()
    try {
      const fileRes = await fetch(downloadUrl);
      if (fileRes.ok) {
        const blob = await fileRes.blob();
        const objectUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = objectUrl;
        a.download = filename;
        a.rel = "noopener";
        a.style.display = "none";
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(objectUrl), 4_000);
        return { ok: true };
      }
    } catch {
      /* fall through */
    }

    // Fallback: open signed URL with download attribute / new tab
    try {
      const a = document.createElement("a");
      a.href = downloadUrl;
      a.download = filename;
      a.rel = "noopener";
      a.target = "_blank";
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      a.remove();
      return { ok: true };
    } catch {
      // Last resort: same-origin redirect endpoint (attachment)
      window.location.href = `/api/projects/${projectId}/download?kind=master&format=${format}&redirect=1`;
      return { ok: true };
    }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Download failed",
    };
  }
}
