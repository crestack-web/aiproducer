import type { PcmStereo } from "../types";

/** Apply stereo width: 0 = mono center, 1 = strong L/R bias of mid/side. */
export function applyWidth(pcm: PcmStereo, width: number, pan = 0): void {
  const w = Math.max(0, Math.min(1, width));
  const p = Math.max(-1, Math.min(1, pan));
  for (let i = 0; i < pcm.left.length; i++) {
    const l = pcm.left[i] || 0;
    const r = pcm.right[i] || 0;
    const mid = 0.5 * (l + r);
    const side = 0.5 * (l - r);
    const sideW = side * (1 + w * 1.4);
    let nl = mid + sideW;
    let nr = mid - sideW;
    // Soft pan
    if (p !== 0) {
      const lg = p <= 0 ? 1 : 1 - p;
      const rg = p >= 0 ? 1 : 1 + p;
      nl *= lg;
      nr *= rg;
    }
    pcm.left[i] = nl;
    pcm.right[i] = nr;
  }
}
