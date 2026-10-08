import { compareRates, type Comparison } from "./stats";

export const EXPERIMENT_TYPES = ["headline", "offer", "landing_page", "creative_hook", "media", "cta", "qualification_question"] as const;
export type ExperimentType = (typeof EXPERIMENT_TYPES)[number];

export interface ArmResult {
  label: string;
  spend: number;
  visitors: number;
  conversions: number; // leads
  qualified: number;
  booked: number;
  revenue: number;
}

export interface ExperimentReport {
  /** Primary comparison: qualified-lead rate per visitor. Cheap leads are not the goal. */
  qualifiedRate: Comparison;
  conversionRate: Comparison;
  bookedRate: Comparison;
  winner: "control" | "variant" | null;
  summary: string;
}

export function evaluateExperiment(control: ArmResult, variant: ArmResult): ExperimentReport {
  const opts = { minTrialsPerArm: 200, minSuccessesTotal: 20 };
  const qualifiedRate = compareRates({ successes: control.qualified, trials: control.visitors }, { successes: variant.qualified, trials: variant.visitors }, { ...opts, minSuccessesTotal: 15 });
  const conversionRate = compareRates({ successes: control.conversions, trials: control.visitors }, { successes: variant.conversions, trials: variant.visitors }, opts);
  const bookedRate = compareRates({ successes: control.booked, trials: control.visitors }, { successes: variant.booked, trials: variant.visitors }, { ...opts, minSuccessesTotal: 10 });

  let winner: ExperimentReport["winner"] = null;
  let summary: string;
  if (qualifiedRate.verdict === "B_WINS") {
    winner = "variant";
    summary = `Variant wins on qualified-lead rate (+${((qualifiedRate.lift ?? 0) * 100).toFixed(0)}%). ${qualifiedRate.reason}`;
  } else if (qualifiedRate.verdict === "A_WINS") {
    winner = "control";
    summary = `Control wins on qualified-lead rate. ${qualifiedRate.reason}`;
  } else if (qualifiedRate.verdict === "INSUFFICIENT_DATA") {
    summary = `No winner yet: ${qualifiedRate.reason}`;
  } else {
    summary = `No significant difference yet. ${qualifiedRate.reason}`;
  }
  if (winner === "variant" && conversionRate.verdict === "A_WINS") {
    summary += " Note: the variant has a lower raw lead rate, so it trades volume for quality.";
  }
  return { qualifiedRate, conversionRate, bookedRate, winner, summary };
}

/** Deterministic, sticky 50/50 split by visitor id so a person always sees the same arm. */
export function assignArm(experimentId: string, visitorId: string, variantShare = 0.5): "control" | "variant" {
  let h = 2166136261;
  const s = `${experimentId}:${visitorId}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296 < variantShare ? "variant" : "control";
}
