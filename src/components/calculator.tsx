"use client";

import { useMemo, useState } from "react";
import { calculateEconomics, validateEconomicsInput, type EconomicsInput } from "@/lib/core/economics";
import { formatMoney, formatPct, formatX } from "@/lib/core/metrics";
import { Chip, Kpi, Panel } from "./ui/kit";

type Field = { key: keyof EconomicsInput; label: string; pct?: boolean; hint?: string };
const FIELDS: Field[] = [
  { key: "clientValue", label: "Revenue per client ($)" },
  { key: "grossMargin", label: "Gross margin (%)", pct: true, hint: "What's left after delivering the work" },
  { key: "desiredProfitMargin", label: "Profit you want after acquisition (%)", pct: true },
  { key: "expectedCpl", label: "Expected cost per lead ($)" },
  { key: "expectedAdSpend", label: "Monthly ad spend ($)", hint: "Leave 0 to size spend from the client goal" },
  { key: "monthlyTargetClients", label: "Clients wanted per month" },
  { key: "leadToQualified", label: "Lead → qualified (%)", pct: true },
  { key: "qualifiedToBooked", label: "Qualified → booked (%)", pct: true },
  { key: "bookedToShow", label: "Booked → showed (%)", pct: true },
  { key: "showToClose", label: "Showed → closed (%)", pct: true },
];
const TONE = { GREEN: "good", YELLOW: "warn", RED: "bad" } as const;
const WORD = { GREEN: "Green: launch", YELLOW: "Yellow: tight", RED: "Red: don't launch yet" } as const;

export function Calculator({ initial }: { initial: EconomicsInput }) {
  const [v, setV] = useState(initial);
  const show = (f: Field) => String(f.pct ? Math.round(v[f.key] * 10000) / 100 : v[f.key]);
  const errors = useMemo(() => validateEconomicsInput(v), [v]);
  const r = useMemo(() => (errors.length ? null : calculateEconomics(v)), [v, errors]);
  return (
    <div className="grid gap-4 xl:grid-cols-[22rem_1fr]">
      <Panel title="Your numbers">
        <form className="space-y-2.5" onSubmit={(e) => e.preventDefault()}>
          {FIELDS.map((f) => (
            <label key={f.key} className="block text-sm">{f.label}
              <input type="number" inputMode="decimal" min={0} max={f.pct ? 100 : undefined} step="any" value={show(f)} onChange={(e) => { const n = Number(e.target.value); setV({ ...v, [f.key]: f.pct ? n / 100 : n }); }} className="num mt-1 block w-full rounded-md border border-line px-2 py-1.5" />
              {f.hint && <span className="text-xs text-ink-soft">{f.hint}</span>}
            </label>
          ))}
        </form>
      </Panel>
      <div className="space-y-4">
        {errors.length > 0 || !r ? <p role="alert" className="rounded-md bg-bad-bg px-3 py-2 text-sm text-bad">{errors.join(". ")}</p> : (
          <>
            <div className={`rounded-lg border p-4 ${r.viability === "GREEN" ? "border-good bg-good-bg" : r.viability === "YELLOW" ? "border-warn bg-warn-bg" : "border-bad bg-bad-bg"}`} role="status">
              <p className="flex items-center gap-2 text-lg font-semibold"><Chip tone={TONE[r.viability]}>{r.viability}</Chip>{WORD[r.viability]}</p>
              <p className="mt-1 text-sm">{r.viabilityReason}</p>
            </div>
            <Panel title="What you can afford to pay">
              <dl className="grid grid-cols-2 divide-x divide-y divide-line sm:grid-cols-5 [&>*]:border-line">
                <Kpi label="Max cost per client" value={formatMoney(r.maxCac)} />
                <Kpi label="Max cost per show" value={formatMoney(r.maxCostPerShow)} />
                <Kpi label="Max cost per booked call" value={formatMoney(r.maxCostPerBooked)} />
                <Kpi label="Max cost per qualified lead" value={formatMoney(r.maxCostPerQualified)} />
                <Kpi label="Max cost per lead" value={formatMoney(r.maxCpl, 2)} sub={`You expect ${formatMoney(v.expectedCpl, 2)}`} tone={v.expectedCpl <= r.maxCpl ? "good" : "bad"} />
              </dl>
            </Panel>
            <Panel title="What the funnel produces">
              <dl className="grid grid-cols-2 divide-x divide-y divide-line sm:grid-cols-4 [&>*]:border-line">
                <Kpi label="Spend" value={formatMoney(r.spend)} />
                <Kpi label="Leads" value={r.leads.toFixed(0)} />
                <Kpi label="Qualified" value={r.qualified.toFixed(0)} />
                <Kpi label="Booked calls" value={r.booked.toFixed(0)} />
                <Kpi label="Showed" value={r.shows.toFixed(1)} />
                <Kpi label="Clients" value={r.clients.toFixed(1)} sub={`${formatPct(r.leadToClient, 1)} of leads`} />
                <Kpi label="Revenue" value={formatMoney(r.revenue)} sub={`ROAS ${formatX(r.roas)}`} />
                <Kpi label="Profit after spend" value={formatMoney(r.netContribution)} tone={r.netContribution >= 0 ? "good" : "bad"} sub={`Expected CAC ${formatMoney(r.expectedCac)}`} />
              </dl>
              {v.monthlyTargetClients > 0 && <p className="mt-3 text-sm text-ink-soft">To win {v.monthlyTargetClients} clients a month at these rates you need about <strong className="num text-ink">{Number.isFinite(r.requiredLeads) ? Math.ceil(r.requiredLeads) : "∞"}</strong> leads and <strong className="num text-ink">{formatMoney(Number.isFinite(r.requiredSpend) ? r.requiredSpend : null)}</strong> in ad spend.</p>}
            </Panel>
            <p className="text-xs text-ink-soft">Estimates only. They depend on your funnel rates holding up; early data can differ a lot, so replace these with real numbers as leads come in.</p>
          </>
        )}
      </div>
    </div>
  );
}
