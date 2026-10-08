"use client";

import { Bar, CartesianGrid, ComposedChart, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface DayRow {
  date: string;
  spend: number;
  leads: number;
  qualified: number;
  booked: number;
  won: number;
  revenue: number;
}

const C = { spend: "#14212b", leads: "#0e5a63", qualified: "#1a7f4b", booked: "#a15c00", rev: "#1a7f4b", grid: "#e6ebe8" };
const short = (d: string) => d.slice(5);
const usd = (v: number) => `$${Math.round(v).toLocaleString("en-US")}`;

function Box({ title, children, caption }: { title: string; children: React.ReactNode; caption: string }) {
  return (
    <figure className="rounded-lg border border-line bg-panel p-3">
      <figcaption className="mb-1 text-sm font-semibold">{title}</figcaption>
      <div className="h-48" role="img" aria-label={`${title}. ${caption}`}>{children}</div>
    </figure>
  );
}

/** Cumulative series so sparse days (few leads) don't make CPL/CAC jump around meaninglessly. */
function cumulative(rows: DayRow[]) {
  let s = 0, l = 0, q = 0, b = 0, w = 0, r = 0;
  return rows.map((d) => {
    s += d.spend; l += d.leads; q += d.qualified; b += d.booked; w += d.won; r += d.revenue;
    return { date: d.date, spend: d.spend, leads: d.leads, qualified: d.qualified, booked: d.booked, revenue: d.revenue, cumRevenue: r, cumSpend: s, cpl: l ? s / l : null, cpq: q ? s / q : null, cpb: b ? s / b : null, cac: w ? s / w : null, roas: s ? r / s : null };
  });
}

export function TrendCharts({ rows }: { rows: DayRow[] }) {
  if (rows.length < 2) return <p className="text-sm text-ink-soft">Charts appear once there are two or more days of data in range.</p>;
  const d = cumulative(rows);
  const common = { margin: { top: 6, right: 8, bottom: 0, left: 0 } };
  const tip = { contentStyle: { fontSize: 12, borderRadius: 6, border: "1px solid #d8dfdc" } };
  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <Box title="Spend and leads per day" caption="Bars show daily ad spend, lines show leads and qualified leads.">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={d} {...common}>
            <CartesianGrid stroke={C.grid} vertical={false} />
            <XAxis dataKey="date" tickFormatter={short} fontSize={11} tickLine={false} minTickGap={24} />
            <YAxis yAxisId="l" fontSize={11} tickLine={false} axisLine={false} tickFormatter={usd} width={48} />
            <YAxis yAxisId="r" orientation="right" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} width={28} />
            <Tooltip {...tip} formatter={(v, n) => (n === "Spend" ? usd(Number(v)) : v)} labelFormatter={(l) => String(l)} />
            <Legend iconType="plainline" wrapperStyle={{ fontSize: 12 }} />
            <Bar yAxisId="l" dataKey="spend" name="Spend" fill="#c9d3ce" radius={[2, 2, 0, 0]} />
            <Line yAxisId="r" dataKey="leads" name="Leads" stroke={C.leads} strokeWidth={2} dot={false} />
            <Line yAxisId="r" dataKey="qualified" name="Qualified" stroke={C.qualified} strokeWidth={2} strokeDasharray="4 3" dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </Box>
      <Box title="Cost per result (cumulative)" caption="Lines show running cost per lead, per qualified lead, per booked call and CAC.">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={d} {...common}>
            <CartesianGrid stroke={C.grid} vertical={false} />
            <XAxis dataKey="date" tickFormatter={short} fontSize={11} tickLine={false} minTickGap={24} />
            <YAxis fontSize={11} tickLine={false} axisLine={false} tickFormatter={usd} width={52} />
            <Tooltip {...tip} formatter={(v) => (v == null ? "—" : usd(Number(v)))} />
            <Legend iconType="plainline" wrapperStyle={{ fontSize: 12 }} />
            <Line dataKey="cpl" name="CPL" stroke={C.leads} strokeWidth={2} dot={false} connectNulls />
            <Line dataKey="cpq" name="Per qualified" stroke={C.qualified} strokeWidth={2} dot={false} connectNulls />
            <Line dataKey="cpb" name="Per booked call" stroke={C.booked} strokeWidth={2} dot={false} connectNulls />
            <Line dataKey="cac" name="CAC" stroke={C.spend} strokeWidth={2} strokeDasharray="4 3" dot={false} connectNulls />
          </LineChart>
        </ResponsiveContainer>
      </Box>
      <Box title="Revenue vs spend (cumulative)" caption="Running revenue against running ad spend. Revenue above spend means profit before delivery cost.">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={d} {...common}>
            <CartesianGrid stroke={C.grid} vertical={false} />
            <XAxis dataKey="date" tickFormatter={short} fontSize={11} tickLine={false} minTickGap={24} />
            <YAxis fontSize={11} tickLine={false} axisLine={false} tickFormatter={usd} width={52} />
            <Tooltip {...tip} formatter={(v) => usd(Number(v))} />
            <Legend iconType="plainline" wrapperStyle={{ fontSize: 12 }} />
            <Line dataKey="cumRevenue" name="Revenue" stroke={C.rev} strokeWidth={2} dot={false} />
            <Line dataKey="cumSpend" name="Spend" stroke={C.spend} strokeWidth={2} strokeDasharray="4 3" dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </Box>
    </div>
  );
}
