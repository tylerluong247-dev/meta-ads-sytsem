import { clamp } from "./math";

/** Standard normal CDF (Abramowitz & Stegun 7.1.26 via erf). */
export function normalCdf(z: number): number {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

export interface RateSample {
  successes: number;
  trials: number;
}

export interface Comparison {
  rateA: number | null;
  rateB: number | null;
  /** Relative lift of B over A, e.g. 0.25 = B converts 25% better. */
  lift: number | null;
  pValue: number | null;
  significant: boolean;
  enoughData: boolean;
  verdict: "B_WINS" | "A_WINS" | "NO_DIFFERENCE_YET" | "INSUFFICIENT_DATA";
  reason: string;
}

export interface CompareOptions {
  alpha?: number; // two-sided significance level
  minTrialsPerArm?: number;
  minSuccessesTotal?: number;
}

/**
 * Two-proportion z-test with sample-size guards. A "winner" is only declared when each arm has at
 * least minTrialsPerArm trials, there are at least minSuccessesTotal conversions overall, AND p < alpha.
 * Everything else is reported as INSUFFICIENT_DATA or NO_DIFFERENCE_YET so tiny samples never crown a winner.
 */
export function compareRates(a: RateSample, b: RateSample, opts: CompareOptions = {}): Comparison {
  const alpha = opts.alpha ?? 0.05;
  const minTrials = opts.minTrialsPerArm ?? 100;
  const minSuccesses = opts.minSuccessesTotal ?? 20;

  const rateA = a.trials > 0 ? a.successes / a.trials : null;
  const rateB = b.trials > 0 ? b.successes / b.trials : null;
  const lift = rateA && rateB !== null ? (rateB - rateA) / rateA : null;

  const enoughData = a.trials >= minTrials && b.trials >= minTrials && a.successes + b.successes >= minSuccesses;
  if (!enoughData || rateA === null || rateB === null) {
    return {
      rateA,
      rateB,
      lift,
      pValue: null,
      significant: false,
      enoughData: false,
      verdict: "INSUFFICIENT_DATA",
      reason: `Need at least ${minTrials} trials per arm and ${minSuccesses} total conversions (have ${a.trials}/${b.trials} trials, ${a.successes + b.successes} conversions).`,
    };
  }

  const pooled = (a.successes + b.successes) / (a.trials + b.trials);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / a.trials + 1 / b.trials));
  if (se === 0) {
    return { rateA, rateB, lift, pValue: 1, significant: false, enoughData: true, verdict: "NO_DIFFERENCE_YET", reason: "Both arms have identical, degenerate rates." };
  }
  const z = (rateB - rateA) / se;
  const pValue = clamp(2 * (1 - normalCdf(Math.abs(z))), 0, 1);
  const significant = pValue < alpha;
  const verdict = !significant ? "NO_DIFFERENCE_YET" : rateB > rateA ? "B_WINS" : "A_WINS";
  return {
    rateA,
    rateB,
    lift,
    pValue,
    significant,
    enoughData: true,
    verdict,
    reason: significant ? `p = ${pValue.toFixed(3)} (< ${alpha}).` : `p = ${pValue.toFixed(3)} — difference could be noise; keep collecting data.`,
  };
}

/** Wilson score interval, better than the normal approximation for small counts. */
export function wilsonInterval(successes: number, trials: number, z = 1.96): { low: number; high: number } | null {
  if (trials <= 0) return null;
  const p = successes / trials;
  const denom = 1 + (z * z) / trials;
  const centre = p + (z * z) / (2 * trials);
  const margin = z * Math.sqrt((p * (1 - p)) / trials + (z * z) / (4 * trials * trials));
  return { low: Math.max(0, (centre - margin) / denom), high: Math.min(1, (centre + margin) / denom) };
}
