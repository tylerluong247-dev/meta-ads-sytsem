import { computeMetrics, profitStatus } from "./metrics";
import { compareRates, wilsonInterval } from "./stats";
import type { FunnelCounts, Targets } from "./types";

export type ProblemArea =
  | "TRAFFIC"
  | "CREATIVE"
  | "OFFER"
  | "LANDING_PAGE"
  | "LEAD_QUALITY"
  | "SALES"
  | "FOLLOW_UP"
  | "SHOW_RATE"
  | "TRACKING";

export interface Finding {
  area: ProblemArea;
  severity: "info" | "warning" | "critical";
  confidence: "low" | "medium" | "high";
  summary: string;
  evidence: string;
  recommendation: string;
}

export interface AnalysisInput {
  current: FunnelCounts;
  previous?: FunnelCounts; // prior period for "why did CPL increase"
  targets: Targets;
  maxAllowableCac: number;
  grossMargin?: number;
  avgResponseMinutes?: number | null;
  avgSalesCycleDays?: number;
}

export interface Analysis {
  verdict: "PROFITABLE" | "UNPROVEN" | "LOSING" | "NO_DATA";
  headline: string;
  findings: Finding[];
  budgetGuidance: { action: "INCREASE" | "HOLD" | "DECREASE" | "PAUSE_AND_FIX"; reason: string };
  sampleNotes: string[];
}

function confidenceFor(n: number, lowAt = 20, highAt = 100): Finding["confidence"] {
  return n >= highAt ? "high" : n >= lowAt ? "medium" : "low";
}

/**
 * Deterministic, auditable funnel diagnosis. Walks the funnel top to bottom and flags the stage that is
 * furthest below target, but only when the sample is big enough to mean something. Budget increases require
 * profitability evidence, not just good top-of-funnel numbers.
 */
export function analyzeCampaign(input: AnalysisInput): Analysis {
  const { current: c, previous, targets } = input;
  const m = computeMetrics(c);
  const findings: Finding[] = [];
  const sampleNotes: string[] = [];

  if (c.spend <= 0 && c.leads === 0) {
    return { verdict: "NO_DATA", headline: "No spend or leads in this period yet.", findings: [], budgetGuidance: { action: "HOLD", reason: "Nothing to analyze." }, sampleNotes: [] };
  }

  const qualifiedTarget = targets.qualifiedRate ?? 0.3;
  const bookedTarget = targets.bookedRate ?? 0.5;

  // Tracking sanity: spend with clicks but zero leads is usually a tracking/form problem, not a market problem.
  if ((c.clicks ?? 0) >= 100 && c.leads === 0) {
    findings.push({ area: "TRACKING", severity: "critical", confidence: "high", summary: "Clicks but zero leads", evidence: `${c.clicks} clicks and no leads recorded.`, recommendation: "Test the landing page and form end to end, and confirm webhook/pixel events are arriving before changing creative." });
  }

  // Traffic: CPL / CTR / CPC.
  if (m.cpl !== null && m.leads >= 10 && m.cpl > targets.targetCpl * 1.3) {
    const ctrLow = m.ctr !== null && m.ctr < 0.008;
    const cvr = c.clicks && c.clicks > 0 ? c.leads / c.clicks : null;
    if (ctrLow) {
      findings.push({ area: "CREATIVE", severity: "warning", confidence: confidenceFor(c.clicks ?? 0, 100, 500), summary: "CPL is high because few people click", evidence: `CPL $${m.cpl.toFixed(0)} vs $${targets.targetCpl} target; CTR ${(m.ctr! * 100).toFixed(2)}%.`, recommendation: "Test new hooks and first-line copy before touching the landing page." });
    } else if (cvr !== null && cvr < 0.08) {
      findings.push({ area: "LANDING_PAGE", severity: "warning", confidence: confidenceFor(c.clicks ?? 0, 100, 500), summary: "Clicks are fine but few become leads", evidence: `CPL $${m.cpl.toFixed(0)} vs $${targets.targetCpl}; click-to-lead ${(cvr * 100).toFixed(1)}%.`, recommendation: "Check page speed on mobile, shorten the form and match the page headline to the ad promise." });
    } else {
      findings.push({ area: "TRAFFIC", severity: "warning", confidence: confidenceFor(m.leads), summary: "CPL is above target", evidence: `CPL $${m.cpl.toFixed(0)} vs $${targets.targetCpl} target.`, recommendation: "Audience or placement may be saturated or too narrow. Review frequency and broaden or refresh the audience." });
    }
  }

  // Lead quality: lead -> qualified.
  if (m.leads >= 20 && m.rates.leadToQualified !== null) {
    const ci = wilsonInterval(c.qualified, c.leads);
    if (ci && ci.high < qualifiedTarget * 0.8) {
      findings.push({ area: "LEAD_QUALITY", severity: "warning", confidence: confidenceFor(m.leads), summary: "Too few leads qualify", evidence: `${(m.rates.leadToQualified * 100).toFixed(0)}% qualified (95% CI up to ${(ci.high * 100).toFixed(0)}%) vs ${(qualifiedTarget * 100).toFixed(0)}% expected.`, recommendation: "Add a budget or revenue question to the form, exclude low-fit audiences and align the ad's promise with who you actually serve." });
    }
  } else if (m.leads > 0) {
    sampleNotes.push(`Only ${m.leads} leads — too few to judge lead quality (need 20+).`);
  }

  // Booking: qualified -> booked, and follow-up speed.
  if (m.qualified >= 15 && m.rates.qualifiedToBooked !== null) {
    const ci = wilsonInterval(c.booked, c.qualified);
    if (ci && ci.high < bookedTarget * 0.8) {
      const slow = (input.avgResponseMinutes ?? 0) > 15;
      findings.push({
        area: slow ? "FOLLOW_UP" : "OFFER",
        severity: "warning",
        confidence: confidenceFor(m.qualified, 15, 60),
        summary: slow ? "Qualified leads are not booking and response time is slow" : "Qualified leads are not booking",
        evidence: `${(m.rates.qualifiedToBooked * 100).toFixed(0)}% book vs ${(bookedTarget * 100).toFixed(0)}% expected${slow ? `; average first response ${Math.round(input.avgResponseMinutes!)} min` : ""}.`,
        recommendation: slow ? "Fix speed-to-lead first: instant confirmation email, then a human reply inside 5 minutes." : "Make the call offer clearer on the page, embed the calendar earlier and reduce steps to book.",
      });
    }
  } else if (m.qualified > 0) {
    sampleNotes.push(`Only ${m.qualified} qualified leads — too few to judge booking rate (need 15+).`);
  }

  // Show rate.
  if (m.booked >= 8 && m.rates.bookedToShow !== null) {
    const ci = wilsonInterval(c.shows, c.booked);
    if (ci && ci.high < targets.showRate * 0.85) {
      findings.push({ area: "SHOW_RATE", severity: "warning", confidence: confidenceFor(m.booked, 8, 40), summary: "Booked calls are not showing up", evidence: `${(m.rates.bookedToShow * 100).toFixed(0)}% show vs ${(targets.showRate * 100).toFixed(0)}% target.`, recommendation: "Send reminders 24h and 1h before, ask for a one-click confirmation and shorten the lead-to-call gap." });
    }
  } else if (m.booked > 0) {
    sampleNotes.push(`Only ${m.booked} booked calls — too few to judge show rate (need 8+).`);
  }

  // Sales: show -> won.
  if (m.shows >= 10 && m.rates.showToWon !== null) {
    const ci = wilsonInterval(c.won, c.shows);
    if (ci && ci.high < targets.closeRate * 0.7) {
      findings.push({ area: "SALES", severity: "warning", confidence: confidenceFor(m.shows, 10, 40), summary: "Calls show up but do not close", evidence: `${(m.rates.showToWon * 100).toFixed(0)}% close vs ${(targets.closeRate * 100).toFixed(0)}% target on ${m.shows} calls.`, recommendation: "Review call recordings and loss reasons. If prospects say price or fit, revisit qualification and the offer; if they stall, tighten the proposal follow-up." });
    }
  } else if (m.shows > 0) {
    sampleNotes.push(`Only ${m.shows} sales calls held — too few to judge close rate (need 10+). A few results can swing this wildly.`);
  }

  // Period-over-period CPL change.
  if (previous && previous.leads >= 10 && c.leads >= 10) {
    const prev = computeMetrics(previous);
    if (prev.cpl !== null && m.cpl !== null && m.cpl > prev.cpl * 1.25) {
      const cpmUp = prev.cpm !== null && m.cpm !== null && m.cpm > prev.cpm * 1.15;
      const ctrDown = prev.ctr !== null && m.ctr !== null && m.ctr < prev.ctr * 0.85;
      const why = cpmUp ? "CPM rose (auction costs or audience saturation)" : ctrDown ? "CTR fell (creative fatigue)" : "click-to-lead conversion fell";
      findings.push({ area: cpmUp ? "TRAFFIC" : ctrDown ? "CREATIVE" : "LANDING_PAGE", severity: "info", confidence: "medium", summary: `CPL rose ${(((m.cpl / prev.cpl) - 1) * 100).toFixed(0)}% vs the previous period`, evidence: `$${prev.cpl.toFixed(0)} → $${m.cpl.toFixed(0)}; most likely driver: ${why}.`, recommendation: cpmUp ? "Refresh the audience and rotate in new creatives." : ctrDown ? "Rotate fresh creatives; check frequency." : "Audit the landing page and form for regressions." });
    }
  }

  // Verdict.
  const gm = input.grossMargin ?? 1;
  const status = profitStatus(c, gm);
  const net = c.revenue * gm - c.spend;
  let verdict: Analysis["verdict"];
  let headline: string;
  if (status === "PROFITABLE" && c.won >= 2) {
    verdict = "PROFITABLE";
    headline = `Profitable so far: $${Math.round(c.revenue).toLocaleString()} revenue on $${Math.round(c.spend).toLocaleString()} spend (${m.roas?.toFixed(2)}x).`;
  } else if (c.won === 0 || c.won === 1) {
    verdict = "UNPROVEN";
    headline = `${c.won} closed client${c.won === 1 ? "" : "s"} so far — profitability is not proven yet.`;
    sampleNotes.push("With so few closed deals, CAC and ROAS are dominated by luck. Judge on cost per qualified lead and cost per booked call until more deals close.");
  } else {
    verdict = net > 0 ? "PROFITABLE" : "LOSING";
    headline = net > 0 ? "Profitable." : `Losing about $${Math.round(-net).toLocaleString()} after delivery cost so far.`;
  }

  // Budget guidance: never "increase" on thin evidence.
  let budgetGuidance: Analysis["budgetGuidance"];
  const critical = findings.some((f) => f.severity === "critical");
  if (critical) {
    budgetGuidance = { action: "PAUSE_AND_FIX", reason: "A critical problem (such as broken tracking) makes spend unreliable until it's fixed." };
  } else if (verdict === "PROFITABLE" && m.cac !== null && m.cac <= input.maxAllowableCac * 0.8 && c.won >= 3 && findings.filter((f) => f.severity === "warning").length === 0) {
    budgetGuidance = { action: "INCREASE", reason: `CAC $${m.cac.toFixed(0)} is well under the $${Math.round(input.maxAllowableCac)} ceiling across ${c.won} clients and no funnel stage is flagged. Increase 20-30% and re-check in a week.` };
  } else if (verdict === "LOSING" && m.cac !== null && m.cac > input.maxAllowableCac * 1.25 && c.won >= 3) {
    budgetGuidance = { action: "DECREASE", reason: "CAC is over 125% of the maximum allowable across enough clients to trust it." };
  } else {
    budgetGuidance = { action: "HOLD", reason: c.won < 3 ? "Fewer than 3 closed clients — not enough evidence to scale or cut on revenue metrics." : "Mixed signals; fix flagged stages before changing budget." };
  }

  const order = { critical: 0, warning: 1, info: 2 } as const;
  findings.sort((a, b) => order[a.severity] - order[b.severity]);
  return { verdict, headline, findings, budgetGuidance, sampleNotes };
}

export { compareRates };
