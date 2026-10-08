import { dayKey, type DateRange } from "@/lib/core/dates";
import { emptyCounts, sumCounts } from "@/lib/core/metrics";
import type { FunnelCounts } from "@/lib/core/types";
import type { Deal, Lead, MetricRow } from "../entities";
import type { Repo } from "../repo";

export type RollupMode = "cohort" | "period";

export interface RollupFilters {
  campaignId?: string;
  adSetId?: string;
  adId?: string;
  creativeId?: string;
  landingPage?: string; // landing path of first touch, e.g. "/roofing"
  source?: string; // utm_source of first touch
  niche?: string; // campaign niche
}

export interface RollupParams {
  range: DateRange;
  mode?: RollupMode;
  filters?: RollupFilters;
  /** Reporting timezone offset in minutes, for daily bucketing of timestamps. */
  utcOffsetMinutes?: number;
}

export interface DailyPoint extends FunnelCounts {
  date: string;
}

export interface Rollup {
  total: FunnelCounts;
  byCampaign: Record<string, FunnelCounts>;
  byCreative: Record<string, FunnelCounts>;
  byLandingPage: Record<string, FunnelCounts>;
  bySource: Record<string, FunnelCounts>;
  daily: DailyPoint[];
  leads: Lead[];
  deals: Deal[];
  /** False when a landing-page/source filter is active: ad spend isn't tracked at that granularity. */
  spendAttributable: boolean;
}

const UNATTRIBUTED = "unattributed";

function bump(map: Record<string, FunnelCounts>, key: string): FunnelCounts {
  return (map[key] ??= emptyCounts());
}

export async function buildRollup(repo: Repo, workspaceId: string, params: RollupParams): Promise<Rollup> {
  const { range, filters = {}, mode = "cohort", utcOffsetMinutes = 0 } = params;
  const fromIso = range.from.toISOString();
  const toIso = range.to.toISOString();
  const fromDay = dayKey(range.from, utcOffsetMinutes);
  const toDay = dayKey(range.to, utcOffsetMinutes);

  const [allLeads, allDeals, metricRows, campaigns] = await Promise.all([
    repo.list("leads", workspaceId),
    repo.list("deals", workspaceId, { where: { status: "won" } }),
    repo.list("metrics", workspaceId, { range: { field: "date", from: fromDay, to: toDay } }),
    repo.list("campaigns", workspaceId),
  ]);
  const campaignNiche = new Map(campaigns.map((c) => [c.id, c.niche]));
  const leadById = new Map(allLeads.map((l) => [l.id, l]));

  const matchLead = (l: Lead): boolean => {
    if (filters.campaignId && l.campaignId !== filters.campaignId) return false;
    if (filters.adSetId && l.adSetId !== filters.adSetId) return false;
    if (filters.adId && l.adId !== filters.adId) return false;
    if (filters.creativeId && l.creativeId !== filters.creativeId) return false;
    if (filters.landingPage && l.attribution.first.landing_page !== filters.landingPage) return false;
    if (filters.source && l.attribution.first.utm_source !== filters.source) return false;
    if (filters.niche && (l.campaignId ? campaignNiche.get(l.campaignId) : undefined) !== filters.niche) return false;
    return true;
  };
  const matchMetric = (m: MetricRow): boolean => {
    if (filters.campaignId && m.campaignId !== filters.campaignId) return false;
    if (filters.adSetId && m.adSetId !== filters.adSetId) return false;
    if (filters.adId && m.adId !== filters.adId) return false;
    if (filters.creativeId && m.creativeId !== filters.creativeId) return false;
    if (filters.niche && (m.campaignId ? campaignNiche.get(m.campaignId) : undefined) !== filters.niche) return false;
    return true;
  };

  const spendAttributable = !filters.landingPage && !filters.source;
  const inRange = (iso?: string) => iso !== undefined && iso >= fromIso && iso < toIso;

  const byCampaign: Record<string, FunnelCounts> = {};
  const byCreative: Record<string, FunnelCounts> = {};
  const byLandingPage: Record<string, FunnelCounts> = {};
  const bySource: Record<string, FunnelCounts> = {};
  const dailyMap = new Map<string, FunnelCounts>();
  const total = emptyCounts();

  const dayBucket = (date: string) => {
    let d = dailyMap.get(date);
    if (!d) {
      d = emptyCounts();
      dailyMap.set(date, d);
    }
    return d;
  };

  const buckets = (l: Lead | undefined, campaignId?: string, creativeId?: string): FunnelCounts[] => {
    const out = [total, bump(byCampaign, campaignId ?? UNATTRIBUTED), bump(byCreative, creativeId ?? UNATTRIBUTED)];
    if (l) {
      out.push(bump(byLandingPage, l.attribution.first.landing_page ?? UNATTRIBUTED));
      out.push(bump(bySource, l.attribution.first.utm_source ?? UNATTRIBUTED));
    }
    return out;
  };

  // Spend & delivery metrics.
  for (const m of metricRows) {
    if (!matchMetric(m)) continue;
    const day = dayBucket(m.date);
    for (const b of [total, bump(byCampaign, m.campaignId ?? UNATTRIBUTED), bump(byCreative, m.creativeId ?? UNATTRIBUTED), day]) {
      b.spend += m.spend;
      b.impressions = (b.impressions ?? 0) + m.impressions;
      b.clicks = (b.clicks ?? 0) + m.clicks;
    }
  }
  if (!spendAttributable) {
    total.spend = 0;
    total.impressions = 0;
    total.clicks = 0;
  }

  // Lead funnel.
  const leads = allLeads.filter(matchLead);
  const countedLeads: Lead[] = [];
  const dayOf = (iso: string) => dayKey(new Date(iso), utcOffsetMinutes);
  for (const l of leads) {
    const created = inRange(l.createdAt);
    const include = (stamp?: string) => (mode === "cohort" ? created && stamp !== undefined : inRange(stamp));
    if (created) countedLeads.push(l);
    if (created) for (const b of [...buckets(l, l.campaignId, l.creativeId), dayBucket(dayOf(l.createdAt))]) b.leads++;
    if (include(l.qualifiedAt)) for (const b of [...buckets(l, l.campaignId, l.creativeId), dayBucket(dayOf(mode === "cohort" ? l.createdAt : l.qualifiedAt!))]) b.qualified++;
    if (include(l.bookedAt)) for (const b of [...buckets(l, l.campaignId, l.creativeId), dayBucket(dayOf(mode === "cohort" ? l.createdAt : l.bookedAt!))]) b.booked++;
    if (include(l.showedAt)) for (const b of [...buckets(l, l.campaignId, l.creativeId), dayBucket(dayOf(mode === "cohort" ? l.createdAt : l.showedAt!))]) b.shows++;
  }

  // Revenue and wins.
  const dealsCounted: Deal[] = [];
  for (const d of allDeals) {
    const lead = leadById.get(d.leadId);
    if (lead && !matchLead(lead)) continue;
    if (!lead && (filters.landingPage || filters.source)) continue;
    if (filters.campaignId && d.campaignId !== filters.campaignId) continue;
    if (filters.adId && d.adId !== filters.adId) continue;
    if (filters.creativeId && d.creativeId !== filters.creativeId) continue;
    const counted = mode === "cohort" ? (lead ? inRange(lead.createdAt) : false) : inRange(`${d.closeDate}T12:00:00.000Z`);
    if (!counted) continue;
    dealsCounted.push(d);
    const dayStamp = mode === "cohort" && lead ? dayOf(lead.createdAt) : d.closeDate;
    for (const b of [...buckets(lead, d.campaignId, d.creativeId), dayBucket(dayStamp)]) {
      b.won++;
      b.revenue += d.contractValue;
    }
  }

  const daily = [...dailyMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, c]) => ({ date, ...c }));
  return { total, byCampaign, byCreative, byLandingPage, bySource, daily, leads: countedLeads, deals: dealsCounted, spendAttributable };
}

export { sumCounts };
