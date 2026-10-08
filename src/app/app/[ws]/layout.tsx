import type { ReactNode } from "react";
import Link from "next/link";
import { Nav } from "@/components/nav";
import { listMyWorkspaces } from "@/lib/server/context";
import { pageAccess } from "../access";

export default async function WorkspaceLayout({ children, params }: { children: ReactNode; params: Promise<{ ws: string }> }) {
  const { ws } = await params;
  const access = await pageAccess(ws);
  const mine = await listMyWorkspaces();
  return (
    <div className="lg:grid lg:grid-cols-[13rem_1fr]">
      <aside className="border-b border-line bg-panel lg:min-h-screen lg:border-b-0 lg:border-r">
        <div className="flex items-center justify-between gap-2 px-4 pt-3 lg:block">
          <Link href="/app" className="text-xs text-ink-soft hover:underline">All clients</Link>
          <p className="truncate font-semibold">{access.ws.name}</p>
          {mine.length > 1 && <p className="hidden text-xs text-ink-soft lg:block">{mine.length} workspaces</p>}
          <p className="text-xs text-ink-soft">{access.role}</p>
        </div>
        <Nav slug={access.ws.slug} />
      </aside>
      <main className="min-w-0 px-4 py-5 lg:px-6">{children}</main>
    </div>
  );
}
