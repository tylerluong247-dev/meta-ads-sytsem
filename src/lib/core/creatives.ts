import { computeMetrics } from "./metrics";
import { compareRates } from "./stats";
import type { CreativeStatus, FunnelCounts, Targets } from "./types";

export interface CreativeRow {
  id: string;
  name: string;
  status: CreativeStatus;
  counts: FunnelCounts;
}

export type CreativeAction = "SCALE" | "KEEP_TESTING" | "KILL" | "HOLD";

export interface CreativeRecommendation {
  id: string;
  action: CreativeAction;
  reason: string;
}

export interface CreativeRuleConfig {
  /** Spend before we judge on lead metrics at all. */
  minSpendToJudge: number; // as a multiple of targetCpl
  /** Spend with zero qualified leads before kill, as multiple of target CPL. */
  killSpendNoQualifiedMultiple: number;
  /** Minimum closed deals before we trust CAC enough to scale on it. */
  minLeadsToScale: number;
}

export const DEFAULT_CREATIVE_RULES: CreativeRuleConfig = {
  minSpendToJudge: 3,
  killSpendNoQualifiedMultiple: 6,
  minLeadsToScale: 15,
};

/**
 * Budget guidance per creative, ordered by what matters: revenue/CAC first when there are wins,
 * then cost per qualified lead / booked call, never raw CPL or CTR alone.
 */
export function recommendCreative(
  c: CreativeRow,
  all: CreativeRow[],
  targets: Targets,
  rules: CreativeRuleConfig = DEFAULT_CREATIVE_RULES,
): CreativeRecommendation {
  const m = computeMetrics(c.counts);
  if (c.status === "PAUSED") return { id: c.id, action: "HOLD", reason: "Paused." };

  const judgeSpend = targets.targetCpl * rules.minSpendToJudge;
  if (c.counts.spend < judgeSpend) {
    return { id: c.id, action: "KEEP_TESTING", reason: `Only $${c.counts.spend.toFixed(0)} spent; wait for at least $${judgeSpend.toFixed(0)} before judging.` };
  }

  // Strong, closed-loop evidence beats everything.
  if (m.won > 0 && m.cac !== null) {
    if (m.cac <= targets.targetCac && (m.roas ?? 0) >= targets.targetRoas && m.leads >= rules.minLeadsToScale) {
      return { id: c.id, action: "SCALE", reason: `CAC $${m.cac.toFixed(0)} is within target ($${targets.targetCac}) with ${m.won} client(s). Scale gradually (20-30% per step).` };
    }
    if (m.cac > targets.targetCac * 1.5 && m.won >= 2) {
      return { id: c.id, action: "KILL", reason: `CAC $${m.cac.toFixed(0)} is over 1.5x the target with ${m.won} clients — enough evidence it is too expensive.` };
    }
  }

  // No qualified leads after meaningful spend.
  if (m.qualified === 0 && c.counts.spend >= targets.targetCpl * rules.killSpendNoQualifiedMultiple) {
    return { id: c.id, action: "KILL", reason: `$${c.counts.spend.toFixed(0)} spent with zero qualified leads.` };
  }

  // Compare quality-adjusted cost to the best peer; use significance on the qualified rate.
  const peers = all.filter((p) => p.id !== c.id && p.status !== "PAUSED" && p.counts.leads > 0);
  const best = peers
    .map((p) => ({ p, cpq: computeMetrics(p.counts).costPerQualified }))
    .filter((x): x is { p: CreativeRow; cpq: number } => x.cpq !== null)
    .sort((a, b) => a.cpq - b.cpq)[0];

  if (m.costPerQualified !== null && best) {
    const cmp = compareRates(
      { successes: best.p.counts.qualified, trials: best.p.counts.leads },
      { successes: c.counts.qualified, trials: c.counts.leads },
      { minTrialsPerArm: 40, minSuccessesTotal: 10 },
    );
    if (cmp.verdict === "A_WINS" && m.costPerQualified > best.cpq * 1.5) {
      return { id: c.id, action: "KILL", reason: `Statistically worse qualification rate than ${best.p.name}, and ${((m.costPerQualified / best.cpq - 1) * 100).toFixed(0)}% more per qualified lead.` };
    }
    if (cmp.verdict === "B_WINS") {
      return { id: c.id, action: "SCALE", reason: `Statistically better qualification rate than ${best.p.name} (${cmp.reason})` };
    }
  }

  if (m.costPerBooked !== null && m.costPerBooked <= targets.targetBookedCallCost) {
    return { id: c.id, action: "KEEP_TESTING", reason: `Booked-call cost $${m.costPerBooked.toFixed(0)} is within target; needs more sales outcomes before scaling.` };
  }
  return { id: c.id, action: "KEEP_TESTING", reason: "Not enough evidence to scale or kill yet." };
}

export function suggestStatus(action: CreativeAction): CreativeStatus {
  return action === "SCALE" ? "WINNER" : action === "KILL" ? "UNDERPERFORMER" : "TESTING";
}
