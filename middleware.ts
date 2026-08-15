import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

type CookieToSet = {
  name: string;
  value: string;
  options?: Record<string, unknown>;
};

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
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

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|html)$).*)",
  ],
};
