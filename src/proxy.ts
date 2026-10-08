import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Refreshes the Supabase session cookie and gates /app/*. This is the optimistic first check only:
 * every page and API action re-verifies the user and workspace role server-side (authorize()).
 * In demo mode (no Supabase env) it is a no-op.
 */
export async function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname;
  // Public pages: set a first-party visitor id (used to keep A/B arms sticky and to count page views once).
  if (!path.startsWith("/app") && path !== "/login") {
    const res = NextResponse.next();
    if (!req.cookies.get("sw_vid")) {
      res.cookies.set("sw_vid", crypto.randomUUID(), { maxAge: 60 * 60 * 24 * 365, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production" });
    }
    return res;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon || !process.env.SUPABASE_SERVICE_ROLE_KEY) return NextResponse.next();

  let res = NextResponse.next({ request: req });
  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (list) => {
        for (const c of list) req.cookies.set(c.name, c.value);
        res = NextResponse.next({ request: req });
        for (const c of list) res.cookies.set(c.name, c.value, c.options);
      },
    },
  });
  const { data } = await supabase.auth.getUser();

  if (!data.user && req.nextUrl.pathname.startsWith("/app")) {
    const login = req.nextUrl.clone();
    login.pathname = "/login";
    login.search = `?next=${encodeURIComponent(req.nextUrl.pathname)}`;
    return NextResponse.redirect(login);
  }
  if (data.user && req.nextUrl.pathname === "/login") {
    const app = req.nextUrl.clone();
    app.pathname = "/app";
    app.search = "";
    return NextResponse.redirect(app);
  }
  return res;
}

export const config = { matcher: ["/app/:path*", "/login", "/((?!api|_next|auth|.*\\..*).*)"] };
