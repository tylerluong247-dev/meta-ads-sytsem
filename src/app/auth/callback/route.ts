import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { env } from "@/lib/server/env";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  if (code && !env.isDemo) {
    const store = await cookies();
    const supabase = createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
      cookies: { getAll: () => store.getAll(), setAll: (list) => list.forEach((c) => store.set(c.name, c.value, c.options)) },
    });
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Only allow same-site relative redirects.
      const next = url.searchParams.get("next");
      return NextResponse.redirect(new URL(next && next.startsWith("/") && !next.startsWith("//") ? next : "/app", url.origin));
    }
  }
  return NextResponse.redirect(new URL("/login?error=auth", url.origin));
}
