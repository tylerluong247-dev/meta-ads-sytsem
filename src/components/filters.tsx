"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DATE_PRESETS } from "@/lib/core/dates";

const LABELS: Record<string, string> = { today: "Today", yesterday: "Yesterday", last_7_days: "Last 7 days", last_30_days: "Last 30 days", this_month: "This month", last_month: "Last month", custom: "Custom" };

export interface FilterOptions {
  campaigns: Array<{ id: string; name: string }>;
  creatives: Array<{ id: string; name: string }>;
  landingPages: string[];
  sources: string[];
  niches: string[];
}

/** URL-driven filters so every view is shareable and the server renders it. */
export function Filters({ options }: { options: FilterOptions }) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const get = (k: string) => sp.get(k) ?? "";
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(sp.toString());
    if (v) next.set(k, v); else next.delete(k);
    if (k === "range" && v !== "custom") { next.delete("from"); next.delete("to"); }
    router.push(`${path}?${next.toString()}`);
  };
  const sel = "rounded-md border border-line bg-white px-2 py-1.5 text-sm";
  const preset = get("range") || "last_30_days";
  return (
    <form className="flex flex-wrap items-end gap-2" aria-label="Dashboard filters" onSubmit={(e) => e.preventDefault()}>
      <label className="text-xs text-ink-soft">Dates<select aria-label="Date range" className={`${sel} mt-0.5 block`} value={preset} onChange={(e) => set("range", e.target.value)}>{DATE_PRESETS.map((p) => <option key={p} value={p}>{LABELS[p]}</option>)}</select></label>
      {preset === "custom" && (
        <>
          <label className="text-xs text-ink-soft">From<input type="date" className={`${sel} mt-0.5 block`} value={get("from")} onChange={(e) => set("from", e.target.value)} /></label>
          <label className="text-xs text-ink-soft">To<input type="date" className={`${sel} mt-0.5 block`} value={get("to")} onChange={(e) => set("to", e.target.value)} /></label>
        </>
      )}
      <label className="text-xs text-ink-soft">Count<select aria-label="Counting mode" className={`${sel} mt-0.5 block`} value={get("mode") || "cohort"} onChange={(e) => set("mode", e.target.value)}><option value="cohort">Leads created in range</option><option value="period">Events in range</option></select></label>
      <label className="text-xs text-ink-soft">Campaign<select className={`${sel} mt-0.5 block max-w-44`} value={get("campaign")} onChange={(e) => set("campaign", e.target.value)}><option value="">All</option>{options.campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label className="text-xs text-ink-soft">Creative<select className={`${sel} mt-0.5 block max-w-44`} value={get("creative")} onChange={(e) => set("creative", e.target.value)}><option value="">All</option>{options.creatives.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      {options.niches.length > 1 && <label className="text-xs text-ink-soft">Niche<select className={`${sel} mt-0.5 block`} value={get("niche")} onChange={(e) => set("niche", e.target.value)}><option value="">All</option>{options.niches.map((n) => <option key={n}>{n}</option>)}</select></label>}
      {options.landingPages.length > 0 && <label className="text-xs text-ink-soft">Landing page<select className={`${sel} mt-0.5 block`} value={get("landing")} onChange={(e) => set("landing", e.target.value)}><option value="">All</option>{options.landingPages.map((n) => <option key={n}>{n}</option>)}</select></label>}
      {options.sources.length > 0 && <label className="text-xs text-ink-soft">Lead source<select className={`${sel} mt-0.5 block`} value={get("source")} onChange={(e) => set("source", e.target.value)}><option value="">All</option>{options.sources.map((n) => <option key={n}>{n}</option>)}</select></label>}
      {(get("campaign") || get("creative") || get("landing") || get("source") || get("niche")) && <button type="button" className="pb-1.5 text-sm text-tide underline" onClick={() => router.push(path + (sp.get("range") ? `?range=${sp.get("range")}` : ""))}>Clear filters</button>}
    </form>
  );
}
