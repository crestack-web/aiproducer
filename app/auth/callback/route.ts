import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

async function hasCompletedOnboarding(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string
): Promise<boolean> {
  try {
    const { data } = await supabase
      .from("profiles")
      .select("onboarding_completed_at")
      .eq("id", userId)
      .maybeSingle();
    const at = (data as { onboarding_completed_at?: string | null } | null)
      ?.onboarding_completed_at;
    return Boolean(at);
  } catch {
    return false;
  }
}

function safePath(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/app";
  return next;
}

/** OAuth code exchange (Google, Spotify, etc.). */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const requestedNext = safePath(searchParams.get("next"));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        const done = await hasCompletedOnboarding(supabase, user.id);
        // Onboarding only once — returning users never land there again
        if (done) {
          const dest =
            requestedNext.startsWith("/onboarding") ? "/app" : requestedNext;
          return NextResponse.redirect(`${origin}${dest}`);
        }
        return NextResponse.redirect(`${origin}/onboarding`);
      }
      return NextResponse.redirect(`${origin}${requestedNext}`);
    }
  }

  return NextResponse.redirect(`${origin}/auth?mode=login&error=oauth`);
}
