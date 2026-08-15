/** Central env helpers. Prefer DEV_MODE for free local UI testing. */

export function isDevMode(): boolean {
  return process.env.DEV_MODE === "true" || process.env.NODE_ENV === "development";
}

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

/**
 * RoEx environment gate.
 * - "test" (default): preview endpoints only; paid/final ops must throw.
 * - "live": allows full production endpoints when ROEX_ALLOW_FULL=true.
 */
export function getRoexEnv(): "test" | "live" {
  const v = (process.env.ROEX_ENV || "test").toLowerCase().trim();
  if (v === "live" || v === "production" || v === "prod") return "live";
  return "test";
}

/** True only when explicitly allowed to call paid/final RoEx endpoints. */
export function isRoexFullAllowed(): boolean {
  return getRoexEnv() === "live" && process.env.ROEX_ALLOW_FULL === "true";
}

export function assertRoexPreviewOnly(operation: string): void {
  if (getRoexEnv() === "test" || !isRoexFullAllowed()) {
    if (
      operation === "full" ||
      operation === "final" ||
      operation === "paid" ||
      operation.includes("final") ||
      operation.includes("full")
    ) {
      throw new Error("ROEX_FULL_PRODUCTION_DISABLED_IN_TEST");
    }
  }
}
