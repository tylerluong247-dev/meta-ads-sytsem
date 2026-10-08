import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/server/context";
import { env } from "@/lib/server/env";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return (
    <div className="min-h-screen">
      {env.isDemo && (
        <p className="bg-warn-bg px-4 py-1.5 text-center text-xs text-warn" role="status">
          Demo mode: sample data held in memory, resets on restart. Add Supabase keys to use real data.
        </p>
      )}
      {children}
    </div>
  );
}
