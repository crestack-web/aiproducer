import { NextResponse } from "next/server";

/**
 * Lightweight liveness probe for self-hosted / Docker deployments.
 * Does not touch the database or secrets.
 */
export async function GET() {
  return NextResponse.json({
    status: "ok",
    service: "ap-web",
    time: new Date().toISOString(),
  });
}
