import { CreativeStatusSelect } from "@/components/creative-controls";
import { Chip, Empty, PageTitle, th, td } from "@/components/ui/kit";
import { suggestStatus } from "@/lib/core/creatives";
import { tzOffsetMinutes } from "@/lib/core/booking";
import { formatMoney, formatPct, formatX } from "@/lib/core/metrics";
import { parseDashboardParams, type SearchParams } from "@/lib/server/dashboard-params";
import { Filters } from "@/components/filters";
import { getDashboard } from "@/lib/server/services/dashboard";
import { pageAccess } from "../../access";

export const metadata = { title: "Creatives" };

export default async function Creatives({ params, searchParams }: { params: Promise<{ ws: string }>; searchParams: Promise<SearchParams> }) {
  const { ws } = await params;
  const { ws: w, role, readDeps } = await pageAccess(ws);
  const p = parseDashboardParams(await searchParams, readDeps.now(), tzOffsetMinutes(w.timezone, readDeps.now()));
  const [d, creatives, campaigns] = await Promise.all([getDashboard(readDeps, w, { range: p.range, mode: p.mode, filters: p.filters }), readDeps.repo.list("creatives", w.id), readDeps.repo.list("campaigns", w.id)]);
  const byId = new Map(d.creatives.map((c) => [c.creative.id, c]));
  const canEdit = role !== "viewer";
  return (
    <>
      <PageTitle aside={<Filters options={{ campaigns: campaigns.map((c) => ({ id: c.id, name: c.name })), creatives: [], landingPages: [], sources: [], niches: [] }} />}>Creative testing</PageTitle>
      {creatives.length === 0 ? <Empty title="No creatives yet">Save a campaign plan or sync Meta to add creatives.</Empty> : (
        <div className="overflow-x-auto rounded-lg border border-line bg-panel">
          <table className="w-full">
            <thead><tr>{["Creative", "Status", "Spend", "Leads", "Qualified", "Cost / qualified", "Booked", "Won", "Revenue", "ROAS", "Advice"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
            <tbody>
              {creatives.map((c) => {
                const row = byId.get(c.id);
                const m = row?.metrics;
                const rec = row?.recommendation;
                return (
                  <tr key={c.id} className="border-t border-line align-top">
                    <td className="max-w-64 px-3 py-2 text-sm"><p className="font-medium">{c.name}</p><p className="truncate text-xs text-ink-soft">{c.angle ?? ""} {c.hook ? `· ${c.hook}` : ""}</p></td>
                    <td className="px-3 py-2 text-sm">{canEdit ? <CreativeStatusSelect slug={w.slug} id={c.id} status={c.status} suggested={rec ? suggestStatus(rec.action) : undefined} /> : <Chip>{c.status.toLowerCase()}</Chip>}</td>
                    <td className={td}>{formatMoney(m?.spend ?? 0)}</td><td className={td}>{m?.leads ?? 0}</td><td className={td}>{m?.qualified ?? 0} <span className="text-xs text-ink-soft">{formatPct(m?.rates.leadToQualified ?? null)}</span></td>
                    <td className={td}>{formatMoney(m?.costPerQualified ?? null)}</td><td className={td}>{m?.booked ?? 0}</td><td className={td}>{m?.won ?? 0}</td><td className={td}>{formatMoney(m?.revenue ?? 0)}</td><td className={td}>{formatX(m?.roas ?? null)}</td>
                    <td className="max-w-56 px-3 py-2 text-xs text-ink-soft">{rec ? <><Chip tone={rec.action === "SCALE" ? "good" : rec.action === "KILL" ? "bad" : "neutral"}>{rec.action.replace("_", " ").toLowerCase()}</Chip><p className="mt-1">{rec.reason}</p></> : "No data in range"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-xs text-ink-soft">Advice weighs revenue and cost per qualified lead over raw CPL or click rate, and waits for enough spend before judging. Status is yours to set; &ldquo;Apply suggested&rdquo; copies the advice.</p>
    </>
  );
}
