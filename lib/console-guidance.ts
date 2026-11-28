export const GUIDE_DURATION_MS = 6000;
export type ClipTap = { id: string; at: number; x: number; y: number };
export function isClipDoubleTap(previous: ClipTap | null, current: ClipTap): boolean {
  return !!previous && previous.id === current.id && current.at - previous.at <= 350 && current.at > previous.at && Math.hypot(current.x - previous.x, current.y - previous.y) < 12;
}
export function isClipTap(start: { x: number; y: number }, end: { x: number; y: number }): boolean {
  return Math.hypot(end.x - start.x, end.y - start.y) < 6;
}
