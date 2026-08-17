"use client";

/** Re-export full booth — keeps import paths stable. Marker must stay true. */
export const FULL_SESSION_UI = true as const;
export { default } from "./project-session-impl";
