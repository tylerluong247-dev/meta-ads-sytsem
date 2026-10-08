import { generateAlerts, type Alert } from "@/lib/core/alerts";
import { analyzeCampaign, type Analysis } from "@/lib/core/analyst";
import { recommendCreative, type CreativeRecommendation } from "@/lib/core/creatives";
import { previousRange, type DateRange } from "@/lib/core/dates";
import { calculateEconomics } from "@/lib/core/economics";
import { buildFunnel, computeMetrics, profitStatus, type FunnelMetrics, type FunnelStep, type ProfitStatus } from "@/lib/core/metrics";
import { overdueLeads, responseMinutes, speedStats, type SpeedStats } from "@/lib/core/speed";
import type { Targets } from "@/lib/core/types";
import { tzOffsetMinutes } from "@/lib/core/booking";
import type { Campaign, Creative, Workspace } from "../entities";
import type { Deps } from "./common";
import { buildRollup, type DailyPoint, type RollupFilters, type RollupMode } from "./rollup";

export function targetsFor(ws: Workspace): Targets {
  return {
    targetCac: ws.targetCac,
    targetCpl: ws.targetCpl,
    targetBookedCallCost: ws.targetBookedCallCost,
    targetRoas: ws.targetRoas,
    closeRate: ws.closeRate,
    showRate: ws.showRate,
    qualifiedRate: ws.qualifiedRate,
    bookedRate: ws.bookedRate,
  };
}

/** The most you can spend to acquire a client and still hit the desired profit margin. */
export function maxAllowableCac(ws: Workspace): number {
  return Math.max(0, ws.avgClientValue * ws.grossMargin - ws.avgClientValue * ws.desiredProfitMargin);
}

export interface CampaignRow {
  campaign: Campaign | { id: string; name: string };
  metrics: FunnelMetrics;
  status: ProfitStatus;
}
export interface CreativeRow {
  creative: Creative | { id: string; name: string; status: Creative["status"] };
  metrics: FunnelMetrics;
  recommendation: CreativeRecommendation;
}

export interface DashboardData {
  workspace: Workspace;
  range: DateRange;
  mode: RollupMode;
  headline: { status: ProfitStatus; text: string };
  kpis: FunnelMetrics;
  funnel: FunnelStep[];
  campaigns: CampaignRow[];
  creatives: CreativeRow[];
  daily: DailyPoint[];
  alerts: Alert[];
  analysis: Analysis;
  speed: SpeedStats;
  waiting: Array<{ id: string; name: string; waitingMinutes: number; band: string }>;
  topCampaign?: CampaignRow;
  topCreative?: CreativeRow;
  attention: string[];
  spendAttributable: boolean;
  maxCac: number;
}

export async function getDashboard(
  deps: Deps,
  ws: Workspace,
  args: { range: DateRange; mode?: RollupMode; filters?: RollupFilters },
): Promise<DashboardData> {
  const offset = tzOffsetMinutes(ws.timezone, deps.now());
  const mode = args.mode ?? "cohort";
  const base = { mode, filters: args.filters, utcOffsetMinutes: offset };
  const [roll, prev, campaigns, creatives] = await Promise.all([
    buildRollup(deps.repo, ws.id, { range: args.range, ...base }),
    buildRollup(deps.repo, ws.id, { range: previousRange(args.range), ...base }),
    deps.repo.list("campaigns", ws.id),
    deps.repo.list("creatives", ws.id),
  ]);

  const targets = targetsFor(ws);
  const maxCac = maxAllowableCac(ws);
  const kpis = computeMetrics(roll.total);

  const campaignRows: CampaignRow[] = Object.entries(roll.byCampaign)
    .filter(([, c]) => c.spend > 0 || c.leads > 0)
    .map(([id, counts]) => ({
      campaign: campaigns.find((c) => c.id === id) ?? { id, name: id === "unattributed" ? "Unattributed" : id },
      metrics: computeMetrics(counts),
      status: profitStatus(counts, ws.grossMargin),
    }))
    .sort((a, b) => b.metrics.profit - a.metrics.profit);

  const creativeSlices = Object.entries(roll.byCreative)
    .filter(([id, c]) => id !== "unattributed" && (c.spend > 0 || c.leads > 0))
    .map(([id, counts]) => ({ id, name: creatives.find((c) => c.id === id)?.name ?? id, status: creatives.find((c) => c.id === id)?.status ?? "TESTING", counts }));
  const creativeRows: CreativeRow[] = creativeSlices
    .map((s) => ({
      creative: creatives.find((c) => c.id === s.id) ?? { id: s.id, name: s.name, status: s.status },
      metrics: computeMetrics(s.counts),
      recommendation: recommendCreative({ id: s.id, name: s.name, status: s.status, counts: s.counts }, creativeSlices.map((x) => ({ id: x.id, name: x.name, status: x.status, counts: x.counts })), targets),
    }))
    .sort((a, b) => (b.metrics.roas ?? -1) - (a.metrics.roas ?? -1) || (a.metrics.costPerQualified ?? 1e12) - (b.metrics.costPerQualified ?? 1e12));

  // Speed to lead over the selected window.
  const minutes = roll.leads
    .map((l) => responseMinutes(l.createdAt, l.firstResponseAt))
    .filter((m): m is number => m !== null);
  const thresholds = { targetMinutes: ws.speedTargetMinutes, warningMinutes: ws.speedTargetMinutes, criticalMinutes: ws.speedCriticalMinutes };
  const speed = speedStats(minutes, thresholds);
  const allLeads = await deps.repo.list("leads", ws.id);
  const waiting = overdueLeads(
    allLeads.filter((l) => !l.firstResponseAt && l.tier !== "DISQUALIFIED" && l.stage !== "LOST" && l.stage !== "WON").map((l) => ({ id: l.id, name: `${l.firstName} ${l.lastName ?? ""}`.trim(), createdAt: l.createdAt })),
    deps.now(),
    thresholds,
  );

  const alerts = generateAlerts({
    targets,
    maxAllowableCac: maxCac,
    campaigns: Object.entries(roll.byCampaign)
      .filter(([id, c]) => id !== "unattributed" && (c.spend > 0 || c.leads > 0))
      .map(([id, counts]) => ({ id, name: campaigns.find((c) => c.id === id)?.name ?? id, counts, grossMargin: ws.grossMargin })),
    creatives: creativeSlices.map((s) => ({ id: s.id, name: s.name, campaignId: creatives.find((c) => c.id === s.id)?.campaignId ?? "", counts: s.counts })),
    waitingLeads: waiting.map((w) => ({ id: w.id, name: w.name, waitingMinutes: w.waitingMinutes })),
    speed: thresholds,
  });

  const analysis = analyzeCampaign({
    current: roll.total,
    previous: prev.total,
    targets,
    maxAllowableCac: maxCac,
    grossMargin: ws.grossMargin,
    avgResponseMinutes: speed.averageMinutes,
    avgSalesCycleDays: ws.avgSalesCycleDays,
  });

  const status = profitStatus(roll.total, ws.grossMargin);
  const headline = {
    status,
    text:
      status === "NO_DATA"
        ? "No spend or revenue in this period yet."
        : status === "PROFITABLE"
          ? `Profitable: ${kpis.roas?.toFixed(2)}x ROAS, $${Math.round(roll.total.revenue * ws.grossMargin - roll.total.spend).toLocaleString()} after spend.`
          : status === "BREAKEVEN"
            ? "About break-even so far."
            : `Losing money so far: $${Math.round(roll.total.spend - roll.total.revenue * ws.grossMargin).toLocaleString()} below break-even${mode === "cohort" ? " (recent leads may still close)" : ""}.`,
  };

  const attention: string[] = [];
  for (const a of alerts.filter((a) => a.severity === "critical").slice(0, 3)) attention.push(a.title);
  if (waiting.length > 0) attention.push(`${waiting.length} lead${waiting.length === 1 ? "" : "s"} waiting for a first response`);
  const today = deps.now().toISOString().slice(0, 10);
  const todays = (await deps.repo.list("appointments", ws.id)).filter((a) => a.startAt.slice(0, 10) === today && ["SCHEDULED", "CONFIRMED"].includes(a.status));
  if (todays.length) attention.push(`${todays.length} sales call${todays.length === 1 ? "" : "s"} today`);

  return {
    workspace: ws,
    range: args.range,
    mode,
    headline,
    kpis,
    funnel: buildFunnel(roll.total),
    campaigns: campaignRows,
    creatives: creativeRows,
    daily: roll.daily,
    alerts,
    analysis,
    speed,
    waiting,
    topCampaign: campaignRows.find((c) => c.campaign.id !== "unattributed" && c.metrics.revenue > 0),
    topCreative: creativeRows.find((c) => c.metrics.won > 0 || c.recommendation.action === "SCALE"),
    attention,
    spendAttributable: roll.spendAttributable,
    maxCac,
  };
}

/** Economics check for the workspace's own stated targets. */
export function workspaceEconomics(ws: Workspace) {
  return calculateEconomics({
    clientValue: ws.avgClientValue,
    grossMargin: ws.grossMargin,
    desiredProfitMargin: ws.desiredProfitMargin,
    leadToQualified: ws.qualifiedRate,
    qualifiedToBooked: ws.bookedRate,
    bookedToShow: ws.showRate,
    showToClose: ws.closeRate,
    expectedCpl: ws.targetCpl,
    expectedAdSpend: ws.monthlyAdBudget,
    monthlyTargetClients: ws.monthlyRevenueTarget > 0 && ws.avgClientValue > 0 ? Math.ceil(ws.monthlyRevenueTarget / ws.avgClientValue) : 0,
  });
}
