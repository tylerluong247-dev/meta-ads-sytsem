import { checkAdCopy, type ComplianceIssue } from "./compliance";

export const CREATIVE_ANGLES = ["problem", "outcome", "educational", "case_study", "offer", "local_credibility", "objection"] as const;
export type CreativeAngle = (typeof CREATIVE_ANGLES)[number];

export interface CampaignBrief {
  niche: string;
  city: string;
  offer: string;
  targetCustomer: string;
  painPoint: string;
  desiredOutcome: string;
  monthlyBudget: number;
  landingPage: string;
  conversionEvent: "lead" | "schedule" | "complete_registration";
  /** Restrict to specific angles; defaults to all seven. */
  angles?: CreativeAngle[];
  /** Only angles you have real proof for should use the case-study angle. */
  hasVerifiedCaseStudy?: boolean;
  avgClientValue?: number;
  targetCpl?: number;
}

export interface AdConcept {
  angle: CreativeAngle;
  name: string;
  hook: string;
  primaryText: string;
  headline: string;
  description: string;
  cta: "Learn More" | "Book Now" | "Sign Up" | "Get Quote" | "Apply Now";
  format: "image" | "video" | "carousel";
  budgetShare: number;
  complianceIssues: ComplianceIssue[];
}

export interface AdSetPlan {
  name: string;
  audience: string;
  placements: string;
  dailyBudget: number;
  optimization: string;
  notes: string;
}

export interface CampaignPlan {
  objective: string;
  structure: string[];
  adSets: AdSetPlan[];
  audienceStrategy: string[];
  concepts: AdConcept[];
  landingPageMessaging: { headline: string; subheadline: string; bullets: string[] };
  qualificationQuestions: Array<{ question: string; why: string; conditional?: string }>;
  followUp: Array<{ when: string; message: string }>;
  testingPlan: string[];
  warnings: string[];
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Deterministic campaign plan from a brief. It produces clean, policy-aware starting copy (no guarantees,
 * no personal-attribute targeting, no fabricated proof). The AI endpoint can refine wording, but every
 * output, AI or template, passes through the same compliance checker.
 */
export function buildCampaignPlan(brief: CampaignBrief): CampaignPlan {
  const niche = brief.niche.trim().toLowerCase();
  const city = brief.city.trim();
  const selected = (brief.angles?.length ? brief.angles : [...CREATIVE_ANGLES]).filter((a) => a !== "case_study" || brief.hasVerifiedCaseStudy);
  const warnings: string[] = [];
  if ((brief.angles ?? CREATIVE_ANGLES).includes("case_study") && !brief.hasVerifiedCaseStudy) {
    warnings.push("Case-study angle skipped: add a real, documented client result you are allowed to publish before enabling it. No placeholder or invented case studies.");
  }

  const copy: Record<CreativeAngle, Omit<AdConcept, "angle" | "budgetShare" | "complianceIssues" | "name">> = {
    problem: {
      hook: `Are slow weeks hurting your ${niche} business in ${city}?`,
      primaryText: `Many ${niche} owners in ${city} depend on referrals and ${brief.painPoint.toLowerCase() || "word of mouth"}, which makes the calendar hard to predict.\n\nWe build a lead system that brings in people who are actively asking for a quote, and screens them before they reach your phone.\n\nBook a short call to see whether it fits your business.`,
      headline: `More Booked Estimates for ${cap(niche)} Companies`,
      description: "Short call. No obligation.",
      cta: "Learn More",
      format: "image",
    },
    outcome: {
      hook: `${cap(brief.desiredOutcome || "A steadier calendar of qualified estimates")} for ${niche} companies in ${city}`,
      primaryText: `Imagine opening Monday with estimates already on the calendar from homeowners who asked for them.\n\nWe help ${brief.targetCustomer || `${niche} companies`} build a predictable stream of qualified inquiries. Results vary by market, offer and follow-up, so we start with a call to check fit.`,
      headline: "Qualified Estimates, Without Door-Knocking",
      description: "See if your market is a fit.",
      cta: "Book Now",
      format: "video",
    },
    educational: {
      hook: `3 reasons ${niche} leads go cold (and what to do about it)`,
      primaryText: `1. Slow response. Most inquiries go to whoever replies first.\n2. Vague offers. People ignore "free quotes" and respond to specific next steps.\n3. No follow-up. Most jobs are won on the 3rd-5th touch.\n\nWe walk through each fix on a short call.`,
      headline: `Why ${cap(niche)} Leads Go Cold`,
      description: "Free 20-minute walkthrough.",
      cta: "Learn More",
      format: "carousel",
    },
    case_study: {
      hook: `How one ${niche} company changed how it gets estimates`,
      primaryText: `[Replace with a real, documented client result you have written permission to publish.]\n\nWe'll walk through exactly what was done and what was not.`,
      headline: "A Real Client Result",
      description: "See the breakdown.",
      cta: "Learn More",
      format: "video",
    },
    offer: {
      hook: `${brief.offer || "Get a clear plan for more qualified estimates"}`,
      primaryText: `${brief.offer || "A custom plan for generating qualified estimates"}.\n\nWe'll review your market in ${city}, your current lead sources and what a realistic target looks like. If we are not a fit, we'll tell you.`,
      headline: brief.offer ? brief.offer.slice(0, 40) : "Your Custom Lead Plan",
      description: "Limited to businesses we can help.",
      cta: "Book Now",
      format: "image",
    },
    local_credibility: {
      hook: `Built for ${city} ${niche} companies`,
      primaryText: `We work with local service businesses, not national chains. We know how ${city} homeowners search, what they expect from a ${niche} company and how to reach them.\n\nTalk to us about what is working locally right now.`,
      headline: `Marketing for ${city} ${cap(niche)} Teams`,
      description: "Local market, local focus.",
      cta: "Learn More",
      format: "image",
    },
    objection: {
      hook: `"I've tried marketing before and it didn't work."`,
      primaryText: `That is the most common thing we hear, and it's usually fair. Typical reasons: leads were not screened, follow-up was slow, or nobody tracked what happened after the click.\n\nWe show you the numbers at every step so you know what is working and what is not. If it is not working, you'll see that too.`,
      headline: "Marketing You Can Actually Measure",
      description: "Every lead tracked to revenue.",
      cta: "Learn More",
      format: "video",
    },
  };

  const share = 1 / Math.max(1, selected.length);
  const concepts: AdConcept[] = selected.map((angle) => {
    const c = copy[angle];
    const text = `${c.hook}\n${c.primaryText}\n${c.headline}\n${c.description}`;
    return { angle, name: `${cap(niche)} | ${angle.replace("_", " ")} v1`, budgetShare: Math.round(share * 100) / 100, complianceIssues: checkAdCopy(text), ...c };
  });

  const daily = Math.max(5, Math.round((brief.monthlyBudget / 30) * 100) / 100);
  const setCount = 2;
  const adSets: AdSetPlan[] = [
    { name: `${cap(niche)} | Broad ${city} +radius`, audience: "Location-based (city + 15-25 mile radius), age 30-65, no interest stacking. Let Meta's delivery find buyers.", placements: "Advantage+ placements", dailyBudget: Math.round((daily / setCount) * 100) / 100, optimization: brief.conversionEvent === "schedule" ? "Optimize for Schedule" : "Optimize for Leads", notes: "Primary scaling ad set once creatives are proven." },
    { name: `${cap(niche)} | Interest: business owners`, audience: "Location-based, interests such as small business ownership and your niche's trade associations. Keep it broad; avoid personal-attribute targeting.", placements: "Advantage+ placements", dailyBudget: Math.round((daily / setCount) * 100) / 100, optimization: "Optimize for Leads", notes: "Control audience for comparison against broad." },
  ];

  return {
    objective: "Leads (website conversions via your landing page). Move to Schedule events once you have 50+ booked calls of data.",
    structure: [
      "1 campaign, Advantage campaign budget off while testing (budget set per ad set)",
      `${adSets.length} ad sets (audiences) x ${concepts.length} creative angles`,
      "Pixel and Conversions API both firing; UTM + Meta ID parameters on every ad URL",
    ],
    adSets,
    audienceStrategy: [
      "Start broad. Meta's delivery typically does better than heavy manual targeting.",
      "Use location targeting by service area only; no targeting that implies personal attributes.",
      "Build a custom audience from qualified leads and booked calls (with consent) only after 100+ records, then test a lookalike.",
    ],
    concepts,
    landingPageMessaging: {
      headline: `Qualified ${cap(niche)} Estimates in ${city}, Without Door-Knocking`,
      subheadline: brief.desiredOutcome ? `${cap(brief.desiredOutcome)} — with every lead screened before it reaches you.` : "Every inquiry screened before it reaches you.",
      bullets: ["We tell you up front if we're not a fit", "Every lead tracked from ad to revenue", "No long-term lock-in claims we can't back up"],
    },
    qualificationQuestions: [
      { question: "What type of work do you do, and where?", why: "Confirms niche and service area." },
      { question: "Roughly what is your monthly revenue?", why: "Sizes the business without asking for exact figures." },
      { question: "How do you get new customers today?", why: "Reveals current channels and pain." },
      { question: "If we determine that we can help, are you prepared to invest in a marketing system?", why: "Budget intent, asked politely.", conditional: "Show only after the three questions above." },
      { question: "How soon would you like to get started?", why: "Urgency." },
    ],
    followUp: [
      { when: "Immediately", message: "Thanks for reaching out — here's the next step: book a short call." },
      { when: "+24 hours", message: "Still want to talk? Here's the booking link." },
      { when: "+3 days", message: "One quick question about your business." },
      { when: "+7 days", message: "Closing the loop — book any time." },
    ],
    testingPlan: [
      "Run all angles at equal budget for the first learning window; do not judge on fewer than 3x your target CPL in spend.",
      "Judge on cost per qualified lead and cost per booked call, not CPL or CTR.",
      "Only kill an ad with zero qualified leads after ~6x target CPL, or when it is statistically worse than the best.",
      "Scale winners 20-30% at a time.",
    ],
    warnings,
  };
}
