import type { ReactNode } from "react";
import type { ProfitStatus } from "@/lib/core/metrics";

export function Panel({ title, aside, children, className = "" }: { title?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-line bg-panel ${className}`}>
      {(title || aside) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
          <h2 className="text-sm font-semibold">{title}</h2>
          {aside}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

const TONES = {
  good: "bg-good-bg text-good",
  warn: "bg-warn-bg text-warn",
  bad: "bg-bad-bg text-bad",
  neutral: "bg-slate-100 text-ink-soft",
  brand: "bg-teal-50 text-tide",
} as const;
export type Tone = keyof typeof TONES;

export function Chip({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${TONES[tone]}`}>{children}</span>;
}

export function profitTone(s: ProfitStatus): Tone {
  return s === "PROFITABLE" ? "good" : s === "LOSING" ? "bad" : s === "BREAKEVEN" ? "warn" : "neutral";
}
export const profitLabel: Record<ProfitStatus, string> = { PROFITABLE: "Profitable", LOSING: "Losing money", BREAKEVEN: "Break-even", NO_DATA: "No data" };

export function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: Tone }) {
  return (
    <div className="min-w-0 px-3 py-2.5">
      <dt className="truncate text-xs text-ink-soft">{label}</dt>
      <dd className={`num mt-0.5 text-xl font-semibold ${tone === "bad" ? "text-bad" : tone === "good" ? "text-good" : tone === "warn" ? "text-warn" : ""}`}>{value}</dd>
      {sub && <p className="num truncate text-xs text-ink-soft">{sub}</p>}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-line p-8 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="mt-1 text-sm text-ink-soft">{children}</div>}
    </div>
  );
}

export function PageTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-xl font-semibold">{children}</h1>
      {aside}
    </div>
  );
}

export const th = "px-3 py-2 text-left text-xs font-medium text-ink-soft";
export const td = "px-3 py-2 text-sm num";
