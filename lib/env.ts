/** Central env helpers. Prefer DEV_MODE for free local UI testing. */

export function isDevMode(): boolean {
  return process.env.DEV_MODE === "true" || process.env.NODE_ENV === "development";
}

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}
