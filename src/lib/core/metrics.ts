import { round, safeDiv } from "./math";
import type { FunnelCounts, Rate } from "./types";

export interface FunnelMetrics extends FunnelCounts {
  ctr: Rate; // fraction
  cpc: Rate;
  cpm: Rate;
  cpl: Rate;
  costPerQualified: Rate;
  costPerBooked: Rate;
  costPerShow: Rate;
  cac: Rate;
  roas: Rate;
  roi: Rate; // (revenue - spend) / spend
  profit: number; // revenue - spend (cash, not margin-adjusted)
  revenuePerLead: Rate;
  revenuePerQualified: Rate;
  revenuePerBooked: Rate;
  rates: {
    leadToQualified: Rate;
    qualifiedToBooked: Rate;
    bookedToShow: Rate;
    showToWon: Rate;
    leadToWon: Rate;
  };
}

export function emptyCounts(): FunnelCounts {
  return { spend: 0, impressions: 0, clicks: 0, leads: 0, qualified: 0, booked: 0, shows: 0, won: 0, revenue: 0 };
}

export function sumCounts(rows: FunnelCounts[]): FunnelCounts {
  const out = emptyCounts();
  for (const r of rows) {
    out.spend += r.spend;
    out.impressions = (out.impressions ?? 0) + (r.impressions ?? 0);
    out.clicks = (out.clicks ?? 0) + (r.clicks ?? 0);
    out.leads += r.leads;
    out.qualified += r.qualified;
    out.booked += r.booked;
    out.shows += r.shows;
    out.won += r.won;
    out.revenue += r.revenue;
  }
  return out;
}

export function computeMetrics(c: FunnelCounts): FunnelMetrics {
  const impressions = c.impressions ?? 0;
  const clicks = c.clicks ?? 0;
  return {
    ...c,
    ctr: safeDiv(clicks, impressions),
    cpc: safeDiv(c.spend, clicks),
    cpm: impressions > 0 ? (c.spend / impressions) * 1000 : null,
    cpl: safeDiv(c.spend, c.leads),
    costPerQualified: safeDiv(c.spend, c.qualified),
    costPerBooked: safeDiv(c.spend, c.booked),
    costPerShow: safeDiv(c.spend, c.shows),
    cac: safeDiv(c.spend, c.won),
    roas: safeDiv(c.revenue, c.spend),
    roi: c.spend > 0 ? (c.revenue - c.spend) / c.spend : null,
    profit: c.revenue - c.spend,
    revenuePerLead: safeDiv(c.revenue, c.leads),
    revenuePerQualified: safeDiv(c.revenue, c.qualified),
    revenuePerBooked: safeDiv(c.revenue, c.booked),
    rates: {
      leadToQualified: safeDiv(c.qualified, c.leads),
      qualifiedToBooked: safeDiv(c.booked, c.qualified),
      bookedToShow: safeDiv(c.shows, c.booked),
      showToWon: safeDiv(c.won, c.shows),
      leadToWon: safeDiv(c.won, c.leads),
    },
  };
}

export interface FunnelStep {
  key: "spend" | "leads" | "qualified" | "booked" | "shows" | "won" | "revenue";
  label: string;
  value: number;
  /** Conversion from the previous count stage (null for spend/leads/revenue). */
  rateFromPrevious: Rate;
}

export function buildFunnel(c: FunnelCounts): FunnelStep[] {
  return [
    { key: "spend", label: "Ad spend", value: c.spend, rateFromPrevious: null },
    { key: "leads", label: "Leads", value: c.leads, rateFromPrevious: null },
    { key: "qualified", label: "Qualified", value: c.qualified, rateFromPrevious: safeDiv(c.qualified, c.leads) },
    { key: "booked", label: "Booked", value: c.booked, rateFromPrevious: safeDiv(c.booked, c.qualified) },
    { key: "shows", label: "Showed", value: c.shows, rateFromPrevious: safeDiv(c.shows, c.booked) },
    { key: "won", label: "Won", value: c.won, rateFromPrevious: safeDiv(c.won, c.shows) },
    { key: "revenue", label: "Revenue", value: c.revenue, rateFromPrevious: null },
  ];
}

export type ProfitStatus = "PROFITABLE" | "BREAKEVEN" | "LOSING" | "NO_DATA";

/** Cash-profit status. Margin-adjusted profit is computed separately when a gross margin is known. */
export function profitStatus(c: FunnelCounts, grossMargin = 1): ProfitStatus {
  if (c.spend <= 0 && c.revenue <= 0) return "NO_DATA";
  const gp = c.revenue * grossMargin;
  const net = gp - c.spend;
  const tolerance = Math.max(1, c.spend * 0.02);
  if (Math.abs(net) <= tolerance) return "BREAKEVEN";
  return net > 0 ? "PROFITABLE" : "LOSING";
}

/** Helper for the spec example: $3,497 x 3 = $10,491, spend $2,000 -> CAC $667, ROAS 5.25x. */
export function formatMoney(n: number | null, dp = 0): string {
  if (n === null) return "—";
  return `${n < 0 ? "-" : ""}$${Math.abs(round(n, dp)).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
}

export function formatPct(n: number | null, dp = 0): string {
  return n === null ? "—" : `${round(n * 100, dp)}%`;
}

export function formatX(n: number | null): string {
  return n === null ? "—" : `${round(n, 2)}x`;
}
