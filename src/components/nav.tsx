"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  ["", "Profit"],
  ["/leads", "Pipeline"],
  ["/campaigns", "Campaigns"],
  ["/creatives", "Creatives"],
  ["/experiments", "Tests"],
  ["/calculator", "Calculator"],
  ["/analyst", "Analyst"],
  ["/automations", "Follow-up"],
  ["/landing-pages", "Landing pages"],
  ["/audit", "Audit log"],
  ["/settings", "Settings"],
] as const;

export function Nav({ slug }: { slug: string }) {
  const path = usePathname();
  const base = `/app/${slug}`;
  return (
    <nav aria-label="Workspace" className="flex gap-1 overflow-x-auto px-3 py-1.5 lg:flex-col lg:overflow-visible lg:px-2 lg:py-3">
      {ITEMS.map(([href, label]) => {
        const full = base + href;
        const active = href === "" ? path === base : path.startsWith(full);
        return (
          <Link key={href} href={full} aria-current={active ? "page" : undefined} className={`whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm ${active ? "bg-tide text-white" : "text-ink-soft hover:bg-slate-100 hover:text-ink"}`}>
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
