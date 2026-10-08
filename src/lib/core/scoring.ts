import { clamp } from "./math";
import type { LeadTier } from "./types";
import type { BudgetRange, RevenueRange, Timeline } from "./validation";

export interface ScoringConfig {
  /** Industries you actively serve; matches are case-insensitive substrings. */
  targetIndustries: string[];
  /** Industries you will never serve (instant disqualification). */
  excludedIndustries: string[];
  /** Cities / states you serve. Empty array = serve anywhere. */
  serviceAreas: string[];
  /** Max points per factor. They should sum to 100. */
  weights: {
    industry: number;
    geography: number;
    revenue: number;
    urgency: number;
    problem: number;
    budget: number;
    timeline: number;
    engagement: number;
    booking: number;
  };
  /** Total-score thresholds for tiers. */
  hotMin: number;
  warmMin: number;
  /** Disqualify when budget AND revenue are both the lowest band. */
  disqualifyMicroBusiness: boolean;
}

export const DEFAULT_SCORING_CONFIG: ScoringConfig = {
  targetIndustries: ["roof", "hvac", "contractor", "remodel", "epoxy", "med spa", "medspa", "law", "attorney", "plumb", "solar", "landscap"],
  excludedIndustries: [],
  serviceAreas: [],
  weights: { industry: 15, geography: 10, revenue: 15, urgency: 10, problem: 10, budget: 15, timeline: 10, engagement: 5, booking: 10 },
  hotMin: 70,
  warmMin: 40,
  disqualifyMicroBusiness: true,
};

export interface ScoringInput {
  industry?: string;
  city?: string;
  state?: string;
  monthlyRevenue?: RevenueRange;
  budgetRange?: BudgetRange;
  timeline?: Timeline;
  readyToInvest?: boolean;
  primaryProblem?: string;
  businessName?: string;
  website?: string;
  /** 0..5 — emails opened/clicked, replies, page revisits. */
  engagementEvents?: number;
  hasBookedCall?: boolean;
}

export interface ScoreFactor {
  factor: keyof ScoringConfig["weights"];
  points: number;
  max: number;
  note: string;
}

export interface ScoreResult {
  score: number;
  tier: LeadTier;
  factors: ScoreFactor[];
  disqualifiedReason?: string;
}

const REVENUE_FRACTION: Record<RevenueRange, number> = { under_10k: 0.1, "10k_30k": 0.45, "30k_100k": 0.8, over_100k: 1 };
const BUDGET_FRACTION: Record<BudgetRange, number> = { under_1k: 0.05, "1k_3k": 0.5, "3k_10k": 0.85, over_10k: 1 };
const TIMELINE_FRACTION: Record<Timeline, number> = { asap: 1, within_30_days: 0.8, within_90_days: 0.4, exploring: 0.1 };

function includesAny(haystack: string | undefined, needles: string[]): boolean {
  if (!haystack) return false;
  const h = haystack.toLowerCase();
  return needles.some((n) => n.trim() !== "" && h.includes(n.toLowerCase()));
}

/** Problem severity from free text: longer, specific answers with pain keywords score higher. */
export function problemSeverity(text?: string): number {
  if (!text) return 0;
  const t = text.toLowerCase();
  let s = 0;
  if (t.length >= 40) s += 0.4;
  else if (t.length >= 15) s += 0.2;
  const pain = ["no leads", "not enough", "inconsistent", "slow", "wasting", "waste", "dry", "empty", "need more", "behind", "losing", "can't fill", "cannot fill", "calendar"];
  if (pain.some((p) => t.includes(p))) s += 0.4;
  if (/\d/.test(t)) s += 0.2;
  return clamp(s, 0, 1);
}

export function scoreLead(input: ScoringInput, config: ScoringConfig = DEFAULT_SCORING_CONFIG): ScoreResult {
  const w = config.weights;
  const factors: ScoreFactor[] = [];
  const add = (factor: ScoreFactor["factor"], fraction: number, note: string) => {
    const max = w[factor];
    factors.push({ factor, max, points: Math.round(clamp(fraction, 0, 1) * max * 10) / 10, note });
  };

  // Hard disqualifiers first.
  if (includesAny(input.industry, config.excludedIndustries)) {
    return { score: 0, tier: "DISQUALIFIED", factors, disqualifiedReason: "Industry is on the excluded list" };
  }
  if (config.serviceAreas.length > 0 && (input.city || input.state)) {
    const inArea = includesAny(`${input.city ?? ""} ${input.state ?? ""}`, config.serviceAreas);
    if (!inArea) return { score: 0, tier: "DISQUALIFIED", factors, disqualifiedReason: "Outside service area" };
  }
  if (
    config.disqualifyMicroBusiness &&
    input.monthlyRevenue === "under_10k" &&
    input.budgetRange === "under_1k" &&
    !input.businessName
  ) {
    return { score: 0, tier: "DISQUALIFIED", factors, disqualifiedReason: "No meaningful business: lowest revenue and budget bands, no business name" };
  }
  if (input.readyToInvest === false) {
    return { score: 0, tier: "DISQUALIFIED", factors, disqualifiedReason: "Not prepared to invest in a marketing system" };
  }

  add("industry", includesAny(input.industry, config.targetIndustries) ? 1 : input.industry ? 0.3 : 0.1, input.industry ? `Industry: ${input.industry}` : "Industry not provided");
  const geoKnown = Boolean(input.city || input.state);
  add("geography", config.serviceAreas.length === 0 ? (geoKnown ? 0.8 : 0.5) : 1, geoKnown ? "Location provided" : "Location not provided");
  add("revenue", input.monthlyRevenue ? REVENUE_FRACTION[input.monthlyRevenue] : 0.2, input.monthlyRevenue ? `Revenue band ${input.monthlyRevenue}` : "Revenue not provided");
  add("urgency", input.timeline ? TIMELINE_FRACTION[input.timeline] : 0.2, "Derived from stated timeline");
  add("problem", problemSeverity(input.primaryProblem), input.primaryProblem ? "Problem described" : "No problem described");
  add("budget", input.budgetRange ? BUDGET_FRACTION[input.budgetRange] : 0.2, input.budgetRange ? `Budget band ${input.budgetRange}` : "Budget not provided");
  add("timeline", input.timeline ? TIMELINE_FRACTION[input.timeline] : 0.2, input.timeline ? `Timeline ${input.timeline}` : "Timeline not provided");
  add("engagement", clamp((input.engagementEvents ?? 0) / 5, 0, 1), `${input.engagementEvents ?? 0} engagement events`);
  add("booking", input.hasBookedCall ? 1 : 0, input.hasBookedCall ? "Booked a call" : "No call booked yet");

  const total = factors.reduce((a, f) => a + f.points, 0);
  const max = factors.reduce((a, f) => a + f.max, 0) || 100;
  const score = Math.round((total / max) * 100);
  const tier: LeadTier = score >= config.hotMin ? "HOT" : score >= config.warmMin ? "WARM" : "COLD";
  return { score, tier, factors };
}

/** Qualified = WARM or better AND a human-checkable minimum of fit data. Used for the funnel's "Qualified" stage. */
export function isQualified(tier: LeadTier): boolean {
  return tier === "HOT" || tier === "WARM";
}

export function mergeScoringConfig(base: ScoringConfig, overrides: Partial<ScoringConfig> | null | undefined): ScoringConfig {
  if (!overrides) return base;
  return { ...base, ...overrides, weights: { ...base.weights, ...(overrides.weights ?? {}) } };
}
