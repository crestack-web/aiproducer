import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getSupabaseUrl, getSupabaseAnonKey } from "@/lib/supabase/env";

type CookieToSet = {
  name: string;
  value: string;
  options?: Record<string, unknown>;
};

function parseRequestCookies(cookieHeader: string | null): { name: string; value: string }[] {
  if (!cookieHeader) return [];
  return cookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const eq = part.indexOf("=");
      if (eq === -1) return { name: part, value: "" };
      return {
        name: part.slice(0, eq),
        value: part.slice(eq + 1),
      };
    })
    .filter((c) => c.name);
}

async function hasCompletedOnboarding(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
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

/**
 * OAuth / magic-link code exchange.
 * Session cookies must be attached to the redirect Response (not only next/headers),
 * or Google sign-in appears to succeed then drops the user back on login.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const oauthError =
    searchParams.get("error_description") ||
    searchParams.get("error");
  const requestedNext = safePath(searchParams.get("next"));

  if (oauthError) {
    return NextResponse.redirect(
      `${origin}/auth?mode=login&error=oauth&detail=${encodeURIComponent(String(oauthError).slice(0, 200))}`
    );
  }

  if (!code) {
    return NextResponse.redirect(
      `${origin}/auth?mode=login&error=oauth&detail=${encodeURIComponent("missing_code")}`
    );
  }

  const url = getSupabaseUrl();
  const key = getSupabaseAnonKey();
  if (!url || !key) {
    return NextResponse.redirect(
      `${origin}/auth?mode=login&error=oauth&detail=${encodeURIComponent("supabase_not_configured")}`
    );
  }

  const cookiesToApply: CookieToSet[] = [];

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return parseRequestCookies(request.headers.get("cookie"));
      },
      setAll(cookiesToSet: CookieToSet[]) {
        cookiesToApply.push(...cookiesToSet);
      },
    },
  });

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(
      `${origin}/auth?mode=login&error=oauth&detail=${encodeURIComponent(error.message.slice(0, 200))}`
    );
  }

  let destPath = requestedNext;
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    const done = await hasCompletedOnboarding(supabase, user.id);
    if (!done) {
      destPath = "/onboarding";
    } else if (requestedNext.startsWith("/onboarding")) {
      destPath = "/app";
    } else {
      destPath = requestedNext;
    }
  }

  const response = NextResponse.redirect(`${origin}${destPath}`);
  for (const { name, value, options } of cookiesToApply) {
    response.cookies.set(name, value, options as Parameters<typeof response.cookies.set>[2]);
  }
  return response;
}
