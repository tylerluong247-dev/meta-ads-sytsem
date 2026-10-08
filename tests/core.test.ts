import { describe, expect, it } from "vitest";
import { analyzeCampaign } from "@/lib/core/analyst";
import { mergeTouches, parseTouch, contractValue } from "@/lib/core/attribution";
import { checkAdCopy, publishableProof, emailFooter, escapeHtml } from "@/lib/core/compliance";
import { calculateEconomics, checkTargetsViability, type EconomicsInput } from "@/lib/core/economics";
import { evaluateExperiment, assignArm } from "@/lib/core/experiments";
import { isOptOutMessage, nextAllowedSend, renderTemplate, stopReason, withinQuietHours, type FollowUpLead, type SequenceStep } from "@/lib/core/followup";
import { buildFunnel, computeMetrics, profitStatus } from "@/lib/core/metrics";
import { assertTransition, canTransition, InvalidTransitionError, applyCallOutcome } from "@/lib/core/pipeline";
import { DEFAULT_SCORING_CONFIG, scoreLead } from "@/lib/core/scoring";
import { compareRates } from "@/lib/core/stats";
import { leadInputSchema, normalizeEmail, normalizePhone, dedupeKey } from "@/lib/core/validation";
import { generateSlots, isSlotAvailable, tzOffsetMinutes } from "@/lib/core/booking";
import { PIPELINE_STAGES } from "@/lib/core/types";
import { validLead } from "./helpers";

const econ = (over: Partial<EconomicsInput> = {}): EconomicsInput => ({
  clientValue: 3497, grossMargin: 0.85, desiredProfitMargin: 0.25,
  leadToQualified: 0.35, qualifiedToBooked: 0.5, bookedToShow: 0.7, showToClose: 0.25,
  expectedCpl: 30, expectedAdSpend: 2000, monthlyTargetClients: 0, ...over,
});

describe("economics calculator", () => {
  it("derives max CAC and per-stage ceilings from client value, margin and desired profit", () => {
    const r = calculateEconomics(econ());
    expect(r.grossProfitPerClient).toBeCloseTo(2972.45, 2);
    expect(r.maxCac).toBeCloseTo(2972.45 - 874.25, 2);
    expect(r.leadToClient).toBeCloseTo(0.35 * 0.5 * 0.7 * 0.25, 6);
    // A lead that costs exactly maxCpl produces exactly maxCac per client at the modeled rates.
    expect(r.maxCpl / r.leadToClient).toBeCloseTo(r.maxCac, 6);
    expect(r.maxCostPerShow).toBeCloseTo(r.maxCac * 0.25, 6);
  });

  it("classifies GREEN / YELLOW / RED on expected CPL vs max allowable CPL", () => {
    const base = calculateEconomics(econ());
    expect(calculateEconomics(econ({ expectedCpl: base.maxCpl * 0.5 })).viability).toBe("GREEN");
    expect(calculateEconomics(econ({ expectedCpl: base.maxCpl * 0.9 })).viability).toBe("YELLOW");
    expect(calculateEconomics(econ({ expectedCpl: base.maxCpl * 1.2 })).viability).toBe("RED");
  });

  it("is RED when margin leaves nothing to spend, or when a funnel rate is zero", () => {
    expect(calculateEconomics(econ({ grossMargin: 0.2, desiredProfitMargin: 0.3 })).viability).toBe("RED");
    expect(calculateEconomics(econ({ showToClose: 0 })).viability).toBe("RED");
  });

  it("sizes leads and spend for a client goal when spend is not given", () => {
    const r = calculateEconomics(econ({ expectedAdSpend: 0, monthlyTargetClients: 3 }));
    expect(r.clients).toBeCloseTo(3, 6);
    expect(r.spend).toBeCloseTo(r.requiredSpend, 6);
  });

  it("rejects rates outside 0..1 and negative money", () => {
    expect(() => calculateEconomics(econ({ grossMargin: 85 }))).toThrow(/grossMargin/);
    expect(() => calculateEconomics(econ({ clientValue: -1 }))).toThrow(/clientValue/);
  });

  it("flags targets that contradict the stated funnel rates", () => {
    const r = checkTargetsViability({ clientValue: 3497, grossMargin: 0.85, targetCac: 300, targetCpl: 40, targetBookedCallCost: 50, qualifiedRate: 0.35, bookedRate: 0.5, showRate: 0.7, closeRate: 0.25 });
    expect(r.consistent).toBe(false);
    expect(r.issues.length).toBeGreaterThanOrEqual(2);
  });
});

describe("metrics: CAC, ROAS, ROI, funnel", () => {
  const spec = { spend: 2000, impressions: 90000, clicks: 1500, leads: 58, qualified: 24, booked: 14, shows: 10, won: 3, revenue: 10491 };
  it("matches the worked example from the brief", () => {
    const m = computeMetrics(spec);
    expect(m.cpl).toBeCloseTo(34.48, 2);
    expect(m.costPerQualified).toBeCloseTo(83.33, 2);
    expect(m.costPerBooked).toBeCloseTo(142.86, 2);
    expect(m.costPerShow).toBe(200);
    expect(Math.round(m.cac!)).toBe(667);
    expect(m.roas).toBeCloseTo(5.2455, 4);
    expect(m.roi).toBeCloseTo(4.2455, 4);
    expect(m.profit).toBe(8491);
    expect(m.ctr).toBeCloseTo(1500 / 90000, 6);
  });
  it("returns null, not NaN or Infinity, when a denominator is zero", () => {
    const m = computeMetrics({ spend: 100, leads: 0, qualified: 0, booked: 0, shows: 0, won: 0, revenue: 0 });
    expect([m.cpl, m.cac, m.roas, m.cpm, m.ctr, m.rates.leadToQualified]).toEqual([null, null, 0, null, null, null]);
    expect(m.roi).toBe(-1);
  });
  it("builds funnel steps with conversion from the previous stage", () => {
    const f = buildFunnel(spec);
    expect(f.find((s) => s.key === "booked")?.rateFromPrevious).toBeCloseTo(14 / 24, 6);
    expect(f.find((s) => s.key === "won")?.rateFromPrevious).toBeCloseTo(0.3, 6);
  });
  it("profit status accounts for margin and ignores noise near break-even", () => {
    expect(profitStatus(spec, 0.85)).toBe("PROFITABLE");
    expect(profitStatus({ ...spec, revenue: 1000 }, 0.85)).toBe("LOSING");
    expect(profitStatus({ ...spec, revenue: 2000 }, 1)).toBe("BREAKEVEN");
    expect(profitStatus({ ...spec, spend: 0, revenue: 0 })).toBe("NO_DATA");
  });
});

describe("lead scoring", () => {
  const strong = { industry: "Roofing", city: "Tampa", state: "FL", monthlyRevenue: "30k_100k" as const, budgetRange: "3k_10k" as const, timeline: "asap" as const, readyToInvest: true, primaryProblem: "Inconsistent calendar, wasting money on lead lists", businessName: "Rivera Roofing", website: "https://rivera.example" };
  it("scores a strong lead HOT with explainable factors", () => {
    const s = scoreLead(strong);
    expect(s.tier).toBe("HOT");
    expect(s.score).toBeGreaterThanOrEqual(70);
    expect(s.factors.length).toBeGreaterThan(3);
  });
  it("scores a vague, slow, low-budget lead lower", () => {
    const s = scoreLead({ industry: "Roofing", monthlyRevenue: "under_10k", budgetRange: "1k_3k", timeline: "exploring" });
    expect(["COLD", "WARM"]).toContain(s.tier);
    expect(s.score).toBeLessThan(scoreLead(strong).score);
  });
  it("hard-disqualifies excluded industries and micro-businesses", () => {
    expect(scoreLead({ ...strong, industry: "Payday loans" }, { ...DEFAULT_SCORING_CONFIG, excludedIndustries: ["payday"] }).tier).toBe("DISQUALIFIED");
    const micro = scoreLead({ industry: "Roofing", monthlyRevenue: "under_10k", budgetRange: "under_1k" });
    expect(scoreLead({ ...strong, readyToInvest: false }).tier).toBe("DISQUALIFIED");
    expect(micro.tier).toBe("DISQUALIFIED");
    expect(micro.disqualifiedReason).toBeTruthy();
  });
  it("respects configured thresholds and service areas", () => {
    const strict = scoreLead(strong, { ...DEFAULT_SCORING_CONFIG, hotMin: 101 });
    expect(strict.tier).not.toBe("HOT");
    const out = scoreLead({ ...strong, state: "AK", city: "Anchorage" }, { ...DEFAULT_SCORING_CONFIG, serviceAreas: ["FL"] });
    expect(out.score).toBeLessThan(scoreLead(strong).score);
  });
});

describe("lead input validation", () => {
  it("normalizes email and phone and builds a stable dedupe key", () => {
    expect(normalizeEmail("  Jamie@Rivera.EXAMPLE ")).toBe("jamie@rivera.example");
    expect(normalizePhone("(813) 555-0142")).toBe(normalizePhone("813.555.0142"));
    expect(dedupeKey("w1", "A@b.co", "(813) 555-0142")).toBe(dedupeKey("w1", "a@b.co", "813-555-0142"));
    expect(dedupeKey("w1", "a@b.co")).not.toBe(dedupeKey("w2", "a@b.co"));
  });
  it("accepts a complete valid lead", () => {
    expect(leadInputSchema.safeParse(validLead("roofing")).success).toBe(true);
  });
  it.each([
    ["missing consent", { contactConsent: false }],
    ["bad email", { email: "not-an-email" }],
    ["empty name", { firstName: "  " }],
    ["unknown budget option", { budgetRange: "a lot" }],
    ["absurdly long text", { primaryProblem: "x".repeat(5000) }],
  ])("rejects %s", (_n, over) => {
    expect(leadInputSchema.safeParse(validLead("roofing", over)).success).toBe(false);
  });
});

describe("attribution", () => {
  const now = new Date("2026-10-01T12:00:00Z");
  it("parses UTMs and Meta ids; ignores templated junk ids", () => {
    const t = parseTouch("https://x.test/roofing?utm_source=meta&utm_campaign=storm&utm_content=ad7&meta_campaign_id=1234567890&meta_ad_id={{ad.id}}&fbclid=abc", now);
    expect(t).toMatchObject({ utm_source: "meta", utm_campaign: "storm", utm_content: "ad7", meta_campaign_id: "1234567890", fbclid: "abc", landing_page: "/roofing" });
    expect(t.meta_ad_id).toBeUndefined();
  });
  it("keeps first touch immutable and moves last touch", () => {
    const a = mergeTouches(null, { utm_source: "meta", utm_campaign: "one", at: "2026-10-01T00:00:00Z" });
    const b = mergeTouches(a, { utm_source: "meta", utm_campaign: "two", at: "2026-10-02T00:00:00Z" });
    expect(b.first.utm_campaign).toBe("one");
    expect(b.last.utm_campaign).toBe("two");
  });
  it("does not let an empty return visit erase the last touch", () => {
    const a = mergeTouches(null, { utm_campaign: "one", at: "2026-10-01T00:00:00Z" });
    const b = mergeTouches(a, { at: "2026-10-03T00:00:00Z" });
    expect(b.last.utm_campaign).toBe("one");
  });
  it("computes contract value from initial, recurring and one-time amounts", () => {
    expect(contractValue({ initialPayment: 1000, recurringPayment: 500, recurringMonths: 3, oneTimeFees: 200 })).toBe(2700);
    expect(contractValue({ initialPayment: 3497, recurringPayment: 0, recurringMonths: 0, oneTimeFees: 0 })).toBe(3497);
  });
});

describe("pipeline transitions", () => {
  it("allows the forward path and blocks skipping to WON from early stages", () => {
    expect(canTransition("NEW_LEAD", "QUALIFIED")).toBe(true);
    expect(canTransition("BOOKED", "CONFIRMED")).toBe(true);
    expect(canTransition("SHOWED", "WON")).toBe(true);
    expect(canTransition("NEW_LEAD", "WON")).toBe(false);
    expect(canTransition("BOOKED", "WON")).toBe(false);
  });
  it("WON is terminal and LOST can only be reopened to QUALIFIED", () => {
    for (const s of PIPELINE_STAGES) expect(canTransition("WON", s)).toBe(false);
    expect(PIPELINE_STAGES.filter((s) => canTransition("LOST", s))).toEqual(["QUALIFIED"]);
  });
  it("throws a typed error on illegal moves", () => {
    expect(() => assertTransition("NEW_LEAD", "SHOWED")).toThrow(InvalidTransitionError);
    expect(() => assertTransition("QUALIFIED", "QUALIFIED")).not.toThrow();
  });
  it("call outcomes map to stages: no-show goes back to QUALIFIED and is not a show", () => {
    expect(applyCallOutcome("BOOKED", "NO_SHOW")).toMatchObject({ stage: "QUALIFIED", appointmentStatus: "NO_SHOW", countsAsShow: false });
    expect(applyCallOutcome("CONFIRMED", "SHOWED")).toMatchObject({ stage: "SHOWED", countsAsShow: true });
    expect(() => applyCallOutcome("NEW_LEAD", "SHOWED")).toThrow(InvalidTransitionError);
  });
});

describe("follow-up rules", () => {
  const lead = (o: Partial<FollowUpLead> = {}): FollowUpLead => ({ id: "l", email: "a@b.co", phone: "+18135550142", optedOutEmail: false, optedOutSms: false, smsConsent: false, stage: "QUALIFIED", hasBooked: false, replied: false, createdAt: new Date(), ...o });
  const email: SequenceStep = { id: "s", delayMinutes: 0, channel: "email", subject: "s", body: "b" };
  const sms: SequenceStep = { ...email, channel: "sms" };
  it("stops on booking, reply, opt-out, disqualification, win/loss", () => {
    expect(stopReason(lead(), email)).toBeNull();
    expect(stopReason(lead({ hasBooked: true }), email)).toBe("BOOKED");
    expect(stopReason(lead({ replied: true }), email)).toBe("REPLIED");
    expect(stopReason(lead({ optedOutEmail: true }), email)).toBe("OPTED_OUT");
    expect(stopReason(lead(), email, "DISQUALIFIED")).toBe("DISQUALIFIED");
    expect(stopReason(lead({ stage: "WON" }), email)).toBe("WON_OR_LOST");
    expect(stopReason(lead({ stage: "LOST" }), email)).toBe("WON_OR_LOST");
  });
  it("never texts without recorded SMS consent", () => {
    expect(stopReason(lead(), sms)).toBe("NO_CONSENT");
    expect(stopReason(lead({ smsConsent: true }), sms)).toBeNull();
    expect(stopReason(lead({ smsConsent: true, optedOutSms: true }), sms)).toBe("OPTED_OUT");
  });
  it("recognizes opt-out keywords and nothing else", () => {
    for (const w of ["STOP", "stop", "Unsubscribe", "  cancel ", "END", "QUIT"]) expect(isOptOutMessage(w)).toBe(true);
    for (const w of ["Please don't stop the quote", "yes", "next tuesday works"]) expect(isOptOutMessage(w)).toBe(false);
  });
  it("applies SMS quiet hours in the recipient's time zone", () => {
    const offset = -240; // EDT
    expect(withinQuietHours(new Date("2026-10-08T14:00:00Z"), offset)).toBe(false); // 10:00 local
    expect(withinQuietHours(new Date("2026-10-09T02:00:00Z"), offset)).toBe(true); // 22:00 local
    const next = nextAllowedSend(new Date("2026-10-09T02:00:00Z"), offset);
    expect(next.toISOString()).toBe("2026-10-09T12:00:00.000Z"); // 8:00 local next morning
  });
  it("renders merge fields and leaves no raw template tokens", () => {
    expect(renderTemplate("Hi {{firstName}} at {{ businessName }}{{missing}}", { firstName: "Jamie", businessName: "Rivera" })).toBe("Hi Jamie at Rivera");
  });
});

describe("compliance helpers", () => {
  it("flags guarantees, unrealistic speed and income claims; passes plain factual copy", () => {
    expect(checkAdCopy("Guaranteed results in 7 days!").length).toBeGreaterThanOrEqual(2);
    expect(checkAdCopy("We run Meta ads for roofers and book estimate calls. Results vary.")).toEqual([]);
  });
  it("only publishes case studies marked verified", () => {
    const r = publishableProof([{ title: "A", body: "real", verified: true }, { title: "B", body: "made up", verified: false }]);
    expect(r.publishable.map((x) => x.title)).toEqual(["A"]);
    expect(r.blocked.map((x) => x.title)).toEqual(["B"]);
  });
  it("email footer carries the postal address and unsubscribe link, escaped", () => {
    const f = emailFooter({ businessName: "Acme <b>", postalAddress: "1 Main St", unsubscribeUrl: "https://x.test/u/1" });
    expect(f.text).toContain("1 Main St");
    expect(f.text).toContain("https://x.test/u/1");
    expect(f.html).not.toContain("<b>");
    expect(escapeHtml(`<script>"&'`)).toBe("&lt;script&gt;&quot;&amp;&#39;");
  });
});

describe("statistics never crown a winner on small samples", () => {
  it("INSUFFICIENT_DATA with tiny arms even if the lift looks huge", () => {
    const c = compareRates({ successes: 1, trials: 10 }, { successes: 5, trials: 10 });
    expect(c.verdict).toBe("INSUFFICIENT_DATA");
    expect(c.significant).toBe(false);
  });
  it("calls a clear winner with enough data, and NO_DIFFERENCE when rates are close", () => {
    expect(compareRates({ successes: 40, trials: 1000 }, { successes: 90, trials: 1000 }).verdict).toBe("B_WINS");
    expect(compareRates({ successes: 50, trials: 1000 }, { successes: 52, trials: 1000 }).verdict).toBe("NO_DIFFERENCE_YET");
  });
  it("experiments judge on qualified-lead rate, not raw lead count", () => {
    const arm = (leads: number, qualified: number) => ({ label: "x", spend: 0, visitors: 1000, conversions: leads, qualified, booked: 0, revenue: 0 });
    const r = evaluateExperiment(arm(100, 20), arm(180, 21)); // variant gets many more leads but not more qualified ones
    expect(r.winner).toBeNull();
    expect(evaluateExperiment({ ...arm(10, 2), visitors: 30 }, { ...arm(15, 6), visitors: 30 }).winner).toBeNull();
  });
  it("assigns a stable arm per visitor and splits roughly evenly", () => {
    expect(assignArm("e1", "v1")).toBe(assignArm("e1", "v1"));
    const variants = Array.from({ length: 2000 }, (_, i) => assignArm("e1", `v${i}`)).filter((a) => a === "variant").length;
    expect(variants).toBeGreaterThan(900);
    expect(variants).toBeLessThan(1100);
  });
});

describe("campaign analyst", () => {
  const targets = { targetCac: 1000, targetCpl: 40, targetBookedCallCost: 150, targetRoas: 3, closeRate: 0.25, showRate: 0.7, qualifiedRate: 0.35, bookedRate: 0.5 };
  it("does not recommend more budget off a tiny, lucky sample", () => {
    const a = analyzeCampaign({ current: { spend: 300, leads: 9, qualified: 6, booked: 4, shows: 3, won: 1, revenue: 3497 }, targets, maxAllowableCac: 2100 });
    expect(a.budgetGuidance.action).not.toBe("INCREASE");
    expect(a.sampleNotes.length).toBeGreaterThan(0);
  });
  it("allows INCREASE only with 3+ closed clients, CAC well under the ceiling and no flagged stage", () => {
    const a = analyzeCampaign({ current: { spend: 2000, leads: 58, qualified: 24, booked: 14, shows: 10, won: 3, revenue: 10491 }, targets, maxAllowableCac: 2100, grossMargin: 0.85 });
    expect(["INCREASE", "HOLD"]).toContain(a.budgetGuidance.action);
  });
  it("tells a lead-quality problem from a traffic problem", () => {
    const quality = analyzeCampaign({ current: { spend: 1500, impressions: 100000, clicks: 2000, leads: 60, qualified: 2, booked: 1, shows: 1, won: 0, revenue: 0 }, targets, maxAllowableCac: 2100 });
    expect(quality.findings.some((f) => f.area === "LEAD_QUALITY")).toBe(true);
    expect(quality.budgetGuidance.action).not.toBe("INCREASE");
  });
  it("reports NO_DATA without inventing findings", () => {
    const a = analyzeCampaign({ current: { spend: 0, leads: 0, qualified: 0, booked: 0, shows: 0, won: 0, revenue: 0 }, targets, maxAllowableCac: 2100 });
    expect(a.verdict).toBe("NO_DATA");
    expect(a.findings).toEqual([]);
  });
});

describe("availability slots and time zones", () => {
  it("computes DST-aware offsets", () => {
    expect(tzOffsetMinutes("America/New_York", new Date("2026-07-01T12:00:00Z"))).toBe(-240);
    expect(tzOffsetMinutes("America/New_York", new Date("2026-12-01T12:00:00Z"))).toBe(-300);
  });
  it("generates weekday business-hour slots after the minimum notice, skipping busy times", () => {
    const from = new Date("2026-10-08T18:00:00Z"); // Thu 2pm ET
    const base = { hostTimeZone: "America/New_York", rules: { weekdays: [1, 2, 3, 4, 5], startHour: 9, endHour: 17 }, from, days: 5, durationMinutes: 30, minNoticeMinutes: 120 };
    const slots = generateSlots(base);
    expect(slots.length).toBeGreaterThan(0);
    expect(slots.every((s) => new Date(s.startUtc).getTime() >= from.getTime() + 120 * 60000)).toBe(true);
    const localDay = (iso: string) => new Date(new Date(iso).getTime() + tzOffsetMinutes("America/New_York", new Date(iso)) * 60000).getUTCDay();
    expect(slots.every((s) => localDay(s.startUtc) !== 0 && localDay(s.startUtc) !== 6)).toBe(true);
    const localHour = (iso: string) => new Date(new Date(iso).getTime() + tzOffsetMinutes("America/New_York", new Date(iso)) * 60000).getUTCHours();
    expect(slots.every((s) => localHour(s.startUtc) >= 9 && localHour(s.startUtc) < 17)).toBe(true);
    const after = generateSlots({ ...base, busy: [slots[0]!] });
    expect(isSlotAvailable(slots[0]!, after)).toBe(false);
    expect(after.length).toBe(slots.length - 1);
  });
});
