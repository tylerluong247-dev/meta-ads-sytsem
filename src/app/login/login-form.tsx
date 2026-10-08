"use client";

import { createBrowserClient } from "@supabase/ssr";
import { useState } from "react";

/** Email magic link. Only the public anon key is used in the browser; RLS protects everything it can reach. */
export function LoginForm({ supabaseUrl, anonKey }: { supabaseUrl: string; anonKey: string }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    const supabase = createBrowserClient(supabaseUrl, anonKey);
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: `${window.location.origin}/auth/callback` } });
    if (error) {
      setError(error.message);
      setState("error");
    } else setState("sent");
  }

  if (state === "sent") return <p className="mt-6 rounded-lg bg-emerald-50 p-4 text-sm text-emerald-800">Check your email for a sign-in link.</p>;
  return (
    <form onSubmit={submit} className="mt-6 space-y-3">
      <label className="block text-sm font-medium" htmlFor="email">Email</label>
      <input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2" />
      <button disabled={state === "sending"} className="w-full rounded-lg bg-slate-900 px-3 py-2 font-medium text-white disabled:opacity-60">{state === "sending" ? "Sending…" : "Email me a link"}</button>
      {state === "error" && <p role="alert" className="text-sm text-red-600">{error}</p>}
    </form>
  );
}
