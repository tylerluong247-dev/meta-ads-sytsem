import { computeMetrics } from "./metrics";
import { classifySpeed, DEFAULT_SPEED_THRESHOLDS, type SpeedThresholds } from "./speed";
import { compareRates } from "./stats";
import type { FunnelCounts, Severity, Targets } from "./types";

export interface Alert {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
  entityType: "campaign" | "creative" | "workspace" | "lead";
  entityId?: string;
  /** What to do about it. */
  action?: string;
}

export interface CampaignSlice {
  id: string;
  name: string;
  counts: FunnelCounts;
  grossMargin?: number;
}

export interface CreativeSlice {
  id: string;
  name: string;
  campaignId: string;
  counts: FunnelCounts;
}

export interface AlertContext {
  targets: Targets;
  maxAllowableCac: number;
  campaigns: CampaignSlice[];
  creatives?: CreativeSlice[];
  /** Median/avg response minutes for recent leads (null = no data). */
  recentResponseMinutes?: number[];
  waitingLeads?: Array<{ id: string; name: string; waitingMinutes: number }>;
  speed?: SpeedThresholds;
  /** Spend with zero qualified leads that triggers a warning. */
  noQualifiedSpendThreshold?: number;
  minShowsForShowRate?: number;
}

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

export function generateAlerts(ctx: AlertContext): Alert[] {
  const alerts: Alert[] = [];
  const { targets } = ctx;
  const noQualThreshold = ctx.noQualifiedSpendThreshold ?? 300;

  for (const c of ctx.campaigns) {
    const m = computeMetrics(c.counts);
    const gm = c.grossMargin ?? 1;

    if (m.qualified === 0 && m.spend >= noQualThreshold) {
      alerts.push({
        id: `noqual:${c.id}`,
        severity: "critical",
        title: `${c.name} has spent ${money(m.spend)} with 0 qualified leads`,
        detail: m.leads === 0 ? "No leads at all — check tracking, the form and the ad delivery." : `${m.leads} leads came in but none qualified — suspect targeting, offer or lead-form quality.`,
        entityType: "campaign",
        entityId: c.id,
        action: m.leads === 0 ? "Verify pixel/CAPI and lead form, then pause if broken." : "Tighten audience or add qualification questions.",
      });
    }

    if (m.costPerBooked !== null && m.booked >= 3 && m.costPerBooked > targets.targetBookedCallCost * 1.5) {
      const mult = m.costPerBooked / targets.targetBookedCallCost;
      alerts.push({
        id: `cpbc:${c.id}`,
        severity: mult >= 2 ? "critical" : "warning",
        title: `${c.name}: cost per booked call is ${mult.toFixed(1)}x target`,
        detail: `${money(m.costPerBooked)} per booked call vs ${money(targets.targetBookedCallCost)} target across ${m.booked} booked calls.`,
        entityType: "campaign",
        entityId: c.id,
        action: "Find the leak: lead quality (qualified rate) or booking friction (qualified-to-booked).",
      });
    }

    if (m.won > 0 && m.cac !== null) {
      const ratio = m.cac / ctx.maxAllowableCac;
      if (ratio > 1) {
        alerts.push({ id: `cac-over:${c.id}`, severity: "critical", title: `${c.name}: CAC ${money(m.cac)} exceeds your maximum allowable ${money(ctx.maxAllowableCac)}`, detail: "Each new client is costing more than you can afford.", entityType: "campaign", entityId: c.id, action: "Pause the weakest creatives and review the offer and close rate." });
      } else if (ratio >= 0.85) {
        alerts.push({ id: `cac-near:${c.id}`, severity: "warning", title: `${c.name} is approaching maximum allowable CAC`, detail: `CAC ${money(m.cac)} is ${(ratio * 100).toFixed(0)}% of the ${money(ctx.maxAllowableCac)} ceiling.`, entityType: "campaign", entityId: c.id, action: "Hold budget flat until more sales results come in." });
      }
    }

    if (m.booked >= 5) {
      const show = m.rates.bookedToShow;
      if (show !== null && show < targets.showRate * 0.85) {
        alerts.push({
          id: `show:${c.id}`,
          severity: "warning",
          title: `${c.name}: show rate dropped to ${(show * 100).toFixed(0)}%`,
          detail: `Target is ${(targets.showRate * 100).toFixed(0)}%. ${m.booked - m.shows} of ${m.booked} booked calls did not show.`,
          entityType: "campaign",
          entityId: c.id,
          action: "Add a same-day reminder and a short confirmation step.",
        });
      }
    }

    const net = m.revenue * gm - m.spend;
    if (m.spend >= noQualThreshold && m.won > 0) {
      if (net > 0) {
        alerts.push({ id: `profit:${c.id}`, severity: "success", title: `${c.name} is profitable`, detail: `${money(m.revenue)} revenue on ${money(m.spend)} spend (${m.roas?.toFixed(2)}x ROAS, ${money(net)} after spend${gm < 1 ? " and delivery cost" : ""}).`, entityType: "campaign", entityId: c.id });
      } else {
        alerts.push({ id: `loss:${c.id}`, severity: "warning", title: `${c.name} is losing money so far`, detail: `${money(-net)} below break-even. Sales cycles can lag spend — check the pipeline before pausing.`, entityType: "campaign", entityId: c.id, action: "Review open proposals and the average sales cycle before cutting spend." });
      }
    }
  }

  // Creative vs creative on cost per qualified lead, only with significant qualification-rate evidence.
  const byCampaign = new Map<string, CreativeSlice[]>();
  for (const cr of ctx.creatives ?? []) byCampaign.set(cr.campaignId, [...(byCampaign.get(cr.campaignId) ?? []), cr]);
  for (const list of byCampaign.values()) {
    const scored = list
      .map((cr) => ({ cr, m: computeMetrics(cr.counts) }))
      .filter((x) => x.m.costPerQualified !== null && x.cr.counts.leads >= 20);
    if (scored.length < 2) continue;
    scored.sort((a, b) => (a.m.costPerQualified as number) - (b.m.costPerQualified as number));
    const best = scored[0];
    const worst = scored[scored.length - 1];
    if (!best || !worst || best === worst) continue;
    const cheaper = 1 - (best.m.costPerQualified as number) / (worst.m.costPerQualified as number);
    const cmp = compareRates(
      { successes: worst.cr.counts.qualified, trials: worst.cr.counts.leads },
      { successes: best.cr.counts.qualified, trials: best.cr.counts.leads },
      { minTrialsPerArm: 20, minSuccessesTotal: 8 },
    );
    if (cheaper >= 0.25) {
      alerts.push({
        id: `creative:${best.cr.id}:${worst.cr.id}`,
        severity: "info",
        title: `${best.cr.name} generates ${(cheaper * 100).toFixed(0)}% cheaper qualified leads than ${worst.cr.name}`,
        detail: cmp.verdict === "B_WINS" ? `Statistically significant (${cmp.reason})` : `Not yet statistically significant (${cmp.reason}). Treat as a lead, not a verdict.`,
        entityType: "creative",
        entityId: best.cr.id,
        action: cmp.verdict === "B_WINS" ? `Shift budget toward ${best.cr.name}.` : "Keep both running until the sample grows.",
      });
    }
  }

  // Speed to lead.
  const speed = ctx.speed ?? DEFAULT_SPEED_THRESHOLDS;
  for (const l of ctx.waitingLeads ?? []) {
    const band = classifySpeed(l.waitingMinutes, speed);
    if (band === "ON_TARGET") continue;
    alerts.push({
      id: `speed:${l.id}`,
      severity: band === "CRITICAL" ? "critical" : "warning",
      title: `Lead response time exceeded ${band === "CRITICAL" ? speed.criticalMinutes : speed.warningMinutes} minutes`,
      detail: `${l.name} has been waiting ${Math.round(l.waitingMinutes)} minutes for a first response.`,
      entityType: "lead",
      entityId: l.id,
      action: "Respond now — odds of contact fall sharply after the first few minutes.",
    });
  }

  const order: Record<Severity, number> = { critical: 0, warning: 1, info: 2, success: 3 };
  return alerts.sort((a, b) => order[a.severity] - order[b.severity]);
}
