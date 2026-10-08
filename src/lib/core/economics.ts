import { clamp, round, safeDiv } from "./math";

export interface EconomicsInput {
  clientValue: number; // revenue per closed client (first-term contract value)
  grossMargin: number; // 0..1, share of revenue left after delivery cost
  desiredProfitMargin: number; // 0..1, share of revenue you want left AFTER delivery + acquisition
  leadToQualified: number; // 0..1
  qualifiedToBooked: number;
  bookedToShow: number;
  showToClose: number;
  expectedCpl: number;
  expectedAdSpend: number; // if 0, spend is derived from monthlyTargetClients
  monthlyTargetClients: number;
}

export type Viability = "GREEN" | "YELLOW" | "RED";

export interface EconomicsResult {
  leadToClient: number;
  grossProfitPerClient: number;
  maxCac: number;
  maxCpl: number;
  maxCostPerQualified: number;
  maxCostPerBooked: number;
  maxCostPerShow: number;
  /** Funnel volumes for the spend used. */
  spend: number;
  leads: number;
  qualified: number;
  booked: number;
  shows: number;
  clients: number;
  revenue: number;
  grossProfit: number;
  netContribution: number; // gross profit - ad spend
  expectedCac: number | null;
  expectedCostPerQualified: number | null;
  expectedCostPerBooked: number | null;
  roas: number | null;
  /** What it takes to hit monthlyTargetClients. */
  requiredLeads: number;
  requiredSpend: number;
  viability: Viability;
  viabilityReason: string;
  /** Expected CPL as a fraction of the max allowable CPL (<=1 is viable). */
  cplHeadroom: number | null;
}

const RATE_KEYS = ["grossMargin", "desiredProfitMargin", "leadToQualified", "qualifiedToBooked", "bookedToShow", "showToClose"] as const;

export function validateEconomicsInput(i: EconomicsInput): string[] {
  const errors: string[] = [];
  for (const k of RATE_KEYS) {
    const v = i[k];
    if (!Number.isFinite(v) || v < 0 || v > 1) errors.push(`${k} must be a fraction between 0 and 1`);
  }
  for (const k of ["clientValue", "expectedCpl", "expectedAdSpend", "monthlyTargetClients"] as const) {
    const v = i[k];
    if (!Number.isFinite(v) || v < 0) errors.push(`${k} must be zero or greater`);
  }
  return errors;
}

/**
 * Pre-launch funnel economics.
 *
 * maxCac = grossProfitPerClient - desiredProfit, where desiredProfit = clientValue * desiredProfitMargin.
 * Every "max cost per stage" is maxCac multiplied by the probability that stage becomes a client,
 * so a lead that costs exactly maxCpl yields exactly maxCac per client at the modeled rates.
 *
 * Viability (on expected CPL vs max allowable CPL):
 *   GREEN  <= 80% of max      (20%+ cushion for variance)
 *   YELLOW <= 100% of max     (borderline)
 *   RED    >  100%, or maxCac <= 0 or no client can be produced
 */
export function calculateEconomics(input: EconomicsInput): EconomicsResult {
  const errors = validateEconomicsInput(input);
  if (errors.length) throw new Error(`Invalid economics input: ${errors.join("; ")}`);

  const { clientValue, grossMargin, desiredProfitMargin } = input;
  const q2c = input.qualifiedToBooked * input.bookedToShow * input.showToClose;
  const b2c = input.bookedToShow * input.showToClose;
  const leadToClient = input.leadToQualified * q2c;

  const grossProfitPerClient = clientValue * grossMargin;
  const maxCac = grossProfitPerClient - clientValue * desiredProfitMargin;
  const maxCpl = Math.max(0, maxCac) * leadToClient;
  const maxCostPerQualified = Math.max(0, maxCac) * q2c;
  const maxCostPerBooked = Math.max(0, maxCac) * b2c;
  const maxCostPerShow = Math.max(0, maxCac) * input.showToClose;

  const requiredLeads = leadToClient > 0 ? input.monthlyTargetClients / leadToClient : Infinity;
  const requiredSpend = requiredLeads * input.expectedCpl;

  let spend = input.expectedAdSpend;
  let leads: number;
  if (spend > 0) {
    leads = input.expectedCpl > 0 ? spend / input.expectedCpl : 0;
  } else {
    leads = Number.isFinite(requiredLeads) ? requiredLeads : 0;
    spend = Number.isFinite(requiredSpend) ? requiredSpend : 0;
  }

  const qualified = leads * input.leadToQualified;
  const booked = qualified * input.qualifiedToBooked;
  const shows = booked * input.bookedToShow;
  const clients = shows * input.showToClose;
  const revenue = clients * clientValue;
  const grossProfit = revenue * grossMargin;
  const netContribution = grossProfit - spend;

  const cplHeadroom = safeDiv(input.expectedCpl, maxCpl);

  let viability: Viability;
  let viabilityReason: string;
  if (maxCac <= 0) {
    viability = "RED";
    viabilityReason = "Gross profit per client does not cover your desired profit margin, so no acquisition cost is affordable.";
  } else if (leadToClient <= 0) {
    viability = "RED";
    viabilityReason = "At least one funnel rate is zero, so the funnel cannot produce clients.";
  } else if (cplHeadroom === null) {
    viability = "RED";
    viabilityReason = "Max allowable CPL is zero.";
  } else if (cplHeadroom > 1) {
    viability = "RED";
    viabilityReason = `Expected CPL is ${round(cplHeadroom * 100, 0)}% of the maximum allowable CPL — each client would cost more than you can afford.`;
  } else if (cplHeadroom > 0.8) {
    viability = "YELLOW";
    viabilityReason = `Expected CPL uses ${round(cplHeadroom * 100, 0)}% of the allowable CPL. Viable on paper, but little room for variance.`;
  } else {
    viability = "GREEN";
    viabilityReason = `Expected CPL uses ${round(cplHeadroom * 100, 0)}% of the allowable CPL, leaving a cushion for variance.`;
  }

  return {
    leadToClient,
    grossProfitPerClient,
    maxCac,
    maxCpl,
    maxCostPerQualified,
    maxCostPerBooked,
    maxCostPerShow,
    spend,
    leads,
    qualified,
    booked,
    shows,
    clients,
    revenue,
    grossProfit,
    netContribution,
    expectedCac: safeDiv(spend, clients),
    expectedCostPerQualified: safeDiv(spend, qualified),
    expectedCostPerBooked: safeDiv(spend, booked),
    roas: safeDiv(revenue, spend),
    requiredLeads,
    requiredSpend,
    viability,
    viabilityReason,
    cplHeadroom,
  };
}

/** Workspace-level check: do the user's stated targets agree with the funnel rates they also stated? */
export function checkTargetsViability(args: {
  clientValue: number;
  grossMargin: number;
  targetCac: number;
  targetCpl: number;
  targetBookedCallCost: number;
  qualifiedRate: number;
  bookedRate: number;
  showRate: number;
  closeRate: number;
}): { consistent: boolean; issues: string[]; impliedCac: number | null; impliedBookedCallCost: number | null } {
  const b2c = clamp(args.showRate, 0, 1) * clamp(args.closeRate, 0, 1);
  const leadToBooked = args.qualifiedRate * args.bookedRate;
  const leadToClient = leadToBooked * b2c;
  const impliedCac = safeDiv(args.targetCpl, leadToClient);
  const impliedBookedCallCost = safeDiv(args.targetCpl, leadToBooked);
  const issues: string[] = [];
  const gp = args.clientValue * args.grossMargin;

  if (impliedCac !== null && impliedCac > args.targetCac) {
    issues.push(`A $${round(args.targetCpl, 0)} CPL at these rates implies a $${round(impliedCac, 0)} CAC, above your $${round(args.targetCac, 0)} target.`);
  }
  if (impliedBookedCallCost !== null && impliedBookedCallCost > args.targetBookedCallCost) {
    issues.push(`A $${round(args.targetCpl, 0)} CPL implies a $${round(impliedBookedCallCost, 0)} cost per booked call, above your $${round(args.targetBookedCallCost, 0)} target.`);
  }
  if (args.targetCac >= gp) {
    issues.push(`Target CAC ($${round(args.targetCac, 0)}) is at or above gross profit per client ($${round(gp, 0)}).`);
  }
  return { consistent: issues.length === 0, issues, impliedCac, impliedBookedCallCost };
}
