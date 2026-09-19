import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

type CookieToSet = {
  name: string;
  value: string;
  options?: Record<string, unknown>;
};

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const url = (
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_PROJECT_URL ||
    ""
  ).trim();
  const keyCandidates = [
    process.env.SUPABASE_ANON_KEY,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    process.env.SUPABASE_PUBLISHABLE_KEY,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    process.env.SUPABASE_KEY,
  ]
    .map((v) => (v || "").trim())
    .filter(Boolean);
  const key =
    keyCandidates.find((k) => k.startsWith("eyJ")) || keyCandidates[0] || "";
  if (!url || !key) return supabaseResponse;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isAuthPage = path.startsWith("/auth");
  const isOnboarding = path.startsWith("/onboarding");
  const isProtected =
    path.startsWith("/app") ||
    path.startsWith("/onboarding") ||
    path.startsWith("/api/projects") ||
    path.startsWith("/api/recording-tasks") ||
    path.startsWith("/api/jobs");

  if (path === "/" || path.startsWith("/welcome")) {
    return supabaseResponse;
  }

  if (isProtected && !user && !path.startsWith("/api/")) {
    const redirect = request.nextUrl.clone();
    redirect.pathname = "/auth";
    redirect.searchParams.set("mode", "login");
    redirect.searchParams.set("next", path);
    return NextResponse.redirect(redirect);
  }

  if (isAuthPage && user) {
    const redirect = request.nextUrl.clone();
    redirect.pathname = "/app";
    redirect.search = "";
    return NextResponse.redirect(redirect);
  }

  if (isOnboarding && !user) {
    const redirect = request.nextUrl.clone();
    redirect.pathname = "/auth";
    redirect.searchParams.set("mode", "signup");
    return NextResponse.redirect(redirect);
  }

  // Onboarding is one-time: completed → leave /onboarding; incomplete → enter from /app once
  if (user && (isOnboarding || path.startsWith("/app"))) {
    try {
      const { data: profile } = await supabase
        .from("profiles")
        .select("onboarding_completed_at")
        .eq("id", user.id)
        .maybeSingle();
      const done = Boolean(
        profile &&
          (profile as { onboarding_completed_at?: string | null }).onboarding_completed_at
      );
      if (isOnboarding && done) {
        const redirect = request.nextUrl.clone();
        redirect.pathname = "/app";
        redirect.search = "";
        return NextResponse.redirect(redirect);
      }
      // Only force onboarding on top-level /app (not deep studio/console/admin links)
      if (path === "/app" && !done) {
        const redirect = request.nextUrl.clone();
        redirect.pathname = "/onboarding";
        redirect.search = "";
        return NextResponse.redirect(redirect);
      }
    } catch {
      /* fail open */
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|html)$).*)",
  ],
};
