import { redirect } from "next/navigation";
import { env } from "@/lib/server/env";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

export default function LoginPage() {
  if (env.isDemo) redirect("/app");
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
      <h1 className="text-2xl font-semibold">Sign in</h1>
      <p className="mt-1 text-sm text-slate-500">ScaleWaves Media acquisition OS</p>
      <LoginForm supabaseUrl={env.supabaseUrl} anonKey={env.supabaseAnonKey} />
    </main>
  );
}
