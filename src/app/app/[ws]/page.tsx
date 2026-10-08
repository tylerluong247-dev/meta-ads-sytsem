import Link from "next/link";
import { TrendCharts } from "@/components/charts";
import { Filters } from "@/components/filters";
import { Chip, Empty, Kpi, Panel, profitLabel, profitTone, th, td } from "@/components/ui/kit";
import { tzOffsetMinutes } from "@/lib/core/booking";
import { formatMoney, formatPct, formatX } from "@/lib/core/metrics";
import { parseDashboardParams, type SearchParams } from "@/lib/server/dashboard-params";
import { getDashboard } from "@/lib/server/services/dashboard";
import { pageAccess } from "../access";

export const metadata = { title: "Profit" };
const sevTone = { critical: "bad", warning: "warn", info: "neutral", success: "good" } as const;

export default async function Home({ params, searchParams }: { params: Promise<{ ws: string }>; searchParams: Promise<SearchParams> }) {
  const { ws } = await params;
  const { ws: w, readDeps } = await pageAccess(ws);
  const p = parseDashboardParams(await searchParams, readDeps.now(), tzOffsetMinutes(w.timezone, readDeps.now()));
  const d = await getDashboard(readDeps, w, { range: p.range, mode: p.mode, filters: p.filters });
  const [campaigns, creatives, leads, landing] = await Promise.all([
    readDeps.repo.list("campaigns", w.id),
    readDeps.repo.list("creatives", w.id),
    readDeps.repo.list("leads", w.id),
    readDeps.repo.list("landingPages", w.id),
  ]);
  const options = {
    campaigns: campaigns.map((c) => ({ id: c.id, name: c.name })),
    creatives: creatives.map((c) => ({ id: c.id, name: c.name })),
    landingPages: landing.map((l) => l.slug),
    sources: [...new Set(leads.map((l) => l.source))],
    niches: [...new Set([w.industry, ...campaigns.map((c) => c.niche).filter((n): n is string => !!n)])],
  };
  const k = d.kpis;
  const maxFunnel = Math.max(1, ...d.funnel.filter((s) => !["spend", "revenue"].includes(s.key)).map((s) => s.value));
  const cacTone = k.cac === null ? undefined : k.cac <= w.targetCac ? "good" : k.cac <= d.maxCac ? "warn" : "bad";
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-ink-soft">Are the ads making money?</p>
          <h1 className="flex flex-wrap items-center gap-2 text-xl font-semibold">
            <Chip tone={profitTone(d.headline.status)}>{profitLabel[d.headline.status]}</Chip>
            <span className="text-base font-normal">{d.headline.text}</span>
          </h1>
        </div>
        <Filters options={options} />
      </div>
      {p.error && <p role="alert" className="rounded-md bg-bad-bg px-3 py-2 text-sm text-bad">{p.error}. Showing the last 30 days.</p>}
      {!d.spendAttributable && <p className="rounded-md bg-warn-bg px-3 py-2 text-sm text-warn">Spend is account-level for this filter, so cost metrics are hidden when filtering by landing page, source or niche.</p>}

      <dl className="grid grid-cols-2 divide-x divide-y divide-line overflow-hidden rounded-lg border border-line bg-panel sm:grid-cols-5 [&>*]:border-line">
        <Kpi label="Ad spend" value={formatMoney(k.spend)} />
        <Kpi label="Leads" value={String(k.leads)} sub={`CPL ${formatMoney(k.cpl, 2)}`} />
        <Kpi label="Qualified" value={String(k.qualified)} sub={`${formatMoney(k.costPerQualified)} each`} />
        <Kpi label="Booked calls" value={String(k.booked)} sub={`${formatMoney(k.costPerBooked)} each`} />
        <Kpi label="Showed" value={String(k.shows)} sub={`${formatMoney(k.costPerShow)} each`} />
        <Kpi label="Clients won" value={String(k.won)} sub={formatPct(k.rates.showToWon) + " of shows"} />
        <Kpi label="Revenue" value={formatMoney(k.revenue)} />
        <Kpi label="CAC" value={formatMoney(k.cac)} sub={`Target ${formatMoney(w.targetCac)} · max ${formatMoney(d.maxCac)}`} tone={cacTone} />
        <Kpi label="ROAS" value={formatX(k.roas)} sub={`Target ${formatX(w.targetRoas)}`} tone={k.roas === null ? undefined : k.roas >= w.targetRoas ? "good" : k.roas >= 1 ? "warn" : "bad"} />
        <Kpi label="Profit after spend" value={formatMoney(k.revenue * w.grossMargin - k.spend)} sub={`ROI ${formatPct(k.roi)}`} tone={k.revenue * w.grossMargin - k.spend >= 0 ? "good" : "bad"} />
      </dl>

      <div className="grid gap-4 xl:grid-cols-[1.3fr_1fr]">
        <Panel title="Funnel" aside={<span className="text-xs text-ink-soft">{d.mode === "cohort" ? "Leads created in range, followed through" : "Events that happened in range"}</span>}>
          <ol className="space-y-2">
            {d.funnel.filter((s) => !["spend", "revenue"].includes(s.key)).map((s) => (
              <li key={s.key} className="grid grid-cols-[5.5rem_1fr_6rem] items-center gap-3">
                <span className="text-sm">{s.label}</span>
                <div className="h-6 rounded bg-slate-100" role="img" aria-label={`${s.label}: ${s.value}`}>
                  <div className="funnel-bar h-6 rounded bg-tide" style={{ width: `${Math.max(2, (s.value / maxFunnel) * 100)}%` }} />
                </div>
                <span className="num text-right text-sm"><strong>{s.value}</strong>{s.rateFromPrevious !== null && <span className="ml-1.5 text-xs text-ink-soft">{formatPct(s.rateFromPrevious)}</span>}</span>
              </li>
            ))}
          </ol>
          <p className="mt-3 text-xs text-ink-soft">Percentages are conversion from the stage above. Targets: qualified {formatPct(w.qualifiedRate)}, booked {formatPct(w.bookedRate)}, show {formatPct(w.showRate)}, close {formatPct(w.closeRate)}.</p>
        </Panel>

        <Panel title="Needs attention">
          {d.attention.length === 0 && d.alerts.length === 0 ? (
            <Empty title="Nothing urgent">Alerts appear here when a campaign, creative or lead needs action.</Empty>
          ) : (
            <ul className="space-y-2">
              {d.attention.map((a) => <li key={a} className="text-sm font-medium">{a}</li>)}
              {d.alerts.slice(0, 6).map((a) => (
                <li key={a.id} className="text-sm"><Chip tone={sevTone[a.severity]}>{a.severity}</Chip> <span className="font-medium">{a.title}</span><p className="text-ink-soft">{a.detail}{a.action ? ` ${a.action}` : ""}</p></li>
              ))}
            </ul>
          )}
          {d.waiting.length > 0 && (
            <div className="mt-3 border-t border-line pt-3">
              <p className="mb-1 text-xs font-medium text-ink-soft">Waiting for a first response</p>
              <ul>{d.waiting.slice(0, 5).map((l) => <li key={l.id} className="flex justify-between text-sm"><Link className="text-tide hover:underline" href={`/app/${w.slug}/leads/${l.id}`}>{l.name}</Link><span className="num text-ink-soft">{Math.round(l.waitingMinutes)} min</span></li>)}</ul>
            </div>
          )}
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Campaigns" aside={d.topCampaign && <span className="text-xs text-ink-soft">Best: {d.topCampaign.campaign.name}</span>}>
          {d.campaigns.length === 0 ? <Empty title="No campaign data in range" /> : (
            <div className="-m-4 overflow-x-auto"><table className="w-full"><thead><tr><th className={th}>Campaign</th><th className={th}>Spend</th><th className={th}>Leads</th><th className={th}>Booked</th><th className={th}>Won</th><th className={th}>CAC</th><th className={th}>ROAS</th></tr></thead>
              <tbody>{d.campaigns.map((c) => (
                <tr key={c.campaign.id} className="border-t border-line"><td className="px-3 py-2 text-sm"><span className="font-medium">{c.campaign.name}</span> <Chip tone={profitTone(c.status)}>{profitLabel[c.status]}</Chip></td><td className={td}>{formatMoney(c.metrics.spend)}</td><td className={td}>{c.metrics.leads}</td><td className={td}>{c.metrics.booked}</td><td className={td}>{c.metrics.won}</td><td className={td}>{formatMoney(c.metrics.cac)}</td><td className={td}>{formatX(c.metrics.roas)}</td></tr>
              ))}</tbody></table></div>
          )}
        </Panel>
        <Panel title="Creatives" aside={<Link href={`/app/${w.slug}/creatives`} className="text-xs text-tide hover:underline">Manage</Link>}>
          {d.creatives.length === 0 ? <Empty title="No creative data in range">Creatives appear once ads with spend or leads are linked.</Empty> : (
            <div className="-m-4 overflow-x-auto"><table className="w-full"><thead><tr><th className={th}>Creative</th><th className={th}>Spend</th><th className={th}>Cost / qualified</th><th className={th}>Won</th><th className={th}>Advice</th></tr></thead>
              <tbody>{d.creatives.map((c) => (
                <tr key={c.creative.id} className="border-t border-line"><td className="px-3 py-2 text-sm font-medium">{c.creative.name}</td><td className={td}>{formatMoney(c.metrics.spend)}</td><td className={td}>{formatMoney(c.metrics.costPerQualified)}</td><td className={td}>{c.metrics.won}</td>
                  <td className="px-3 py-2 text-sm" title={c.recommendation.reason}><Chip tone={c.recommendation.action === "SCALE" ? "good" : c.recommendation.action === "KILL" ? "bad" : "neutral"}>{c.recommendation.action.replace("_", " ").toLowerCase()}</Chip></td></tr>
              ))}</tbody></table></div>
          )}
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_1.3fr]">
        <Panel title="Speed to lead">
          {d.speed.count === 0 ? <p className="text-sm text-ink-soft">No first responses recorded in this range.</p> : (
            <dl className="grid grid-cols-3 gap-2"><Kpi label="Median" value={`${Math.round(d.speed.medianMinutes ?? 0)} min`} /><Kpi label="Average" value={`${Math.round(d.speed.averageMinutes ?? 0)} min`} /><Kpi label={`Within ${w.speedTargetMinutes} min`} value={formatPct(d.speed.withinTargetShare)} tone={(d.speed.withinTargetShare ?? 0) >= 0.8 ? "good" : "warn"} /></dl>
          )}
          <p className="mt-2 text-xs text-ink-soft">Counts the first human reply (call, text or email you send), not automatic acknowledgements.</p>
        </Panel>
        <Panel title="Analyst" aside={<Link href={`/app/${w.slug}/analyst`} className="text-xs text-tide hover:underline">Ask a question</Link>}>
          <p className="text-sm font-medium">{d.analysis.headline}</p>
          <p className="mt-1 text-sm text-ink-soft">Budget: <strong className="text-ink">{d.analysis.budgetGuidance.action.replace(/_/g, " ").toLowerCase()}</strong>. {d.analysis.budgetGuidance.reason}</p>
          <ul className="mt-2 space-y-1.5">{d.analysis.findings.slice(0, 3).map((f, i) => <li key={i} className="text-sm"><Chip tone={f.severity === "critical" ? "bad" : f.severity === "warning" ? "warn" : "neutral"}>{f.area.replace("_", " ").toLowerCase()}</Chip> {f.summary} <span className="text-ink-soft">({f.confidence} confidence)</span></li>)}</ul>
          {d.analysis.sampleNotes.map((n) => <p key={n} className="mt-1 text-xs text-ink-soft">{n}</p>)}
        </Panel>
      </div>

      <TrendCharts rows={d.daily} />
    </div>
  );
}
