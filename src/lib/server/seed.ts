import { mergeTouches } from "@/lib/core/attribution";
import { scoreLead } from "@/lib/core/scoring";
import type { PipelineStage } from "@/lib/core/types";
import type { BudgetRange, RevenueRange, Timeline } from "@/lib/core/validation";
import { dedupeKey } from "@/lib/core/validation";
import { MemoryRepo } from "./memory-repo";
import type { Ad, AdSet, Appointment, Campaign, Creative, Lead, Workspace } from "./entities";
import type { Repo } from "./repo";
import { ensureDefaultRules } from "./services/followup";
import type { Deps } from "./services/common";

export const DEMO_USER_ID = "demo-user";
export const DEMO_USER_EMAIL = "demo@scalewaves.local";

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = ["Mike", "Dave", "Chris", "Jason", "Tony", "Brian", "Kevin", "Steve", "Mark", "Ryan", "Eric", "Adam", "Greg", "Paul", "Sean", "Jeff", "Todd", "Nick", "Luis", "Carlos", "Dan", "Rob", "Tim", "Andre", "Pete", "Gary", "Frank", "Derek", "Hector", "Shane", "Wes", "Cody", "Brett", "Lance", "Vince", "Marcus", "Ray", "Neil", "Ian", "Owen", "Kyle", "Troy", "Glen", "Hank", "Jared", "Cole", "Reid", "Bo", "Dean", "Ross", "Rick", "Sam", "Joel", "Abe", "Lou", "Gus", "Hugh", "Ned"];
const LAST = ["Reynolds", "Castillo", "Brennan", "Okafor", "Delgado", "Whitaker", "Nowak", "Foster", "Ibarra", "Sullivan", "Park", "Hughes", "Moreno", "Becker", "Lindqvist", "Tanaka", "Rowe", "Kowalski", "Mendez", "Pruitt", "Hale", "Santos", "Dunn", "Vega", "Cho", "Barlow", "Quinn", "Ortega", "Marsh", "Pike"];
const BIZ = ["Summit Roofing", "Ridgeline Exteriors", "Bluebird Roofing Co", "Keystone Roof & Repair", "Oakridge Roofers", "Pinnacle Roofing", "Hammerstone Roofing", "Redwood Roof Systems", "Cardinal Roofing", "Ironclad Roofing", "Northstar Exteriors", "Beacon Roofing", "Granite State Roofing", "Lakeside Roofing", "Trusty Roof Pros", "Harbor Roofing", "Prairie Roof & Gutter", "Cobalt Roofing", "Sterling Roofing", "Evergreen Exteriors"];
const CITIES: Array<[string, string]> = [["Tampa", "FL"], ["Orlando", "FL"], ["Dallas", "TX"], ["Austin", "TX"], ["Charlotte", "NC"], ["Atlanta", "GA"], ["Phoenix", "AZ"], ["Denver", "CO"], ["Nashville", "TN"], ["Columbus", "OH"]];

export interface SeedOptions {
  now: Date;
  /** Demo user who owns the seeded workspaces (memory repo only). */
  ownerId?: string;
}

interface CreativePlan {
  name: string;
  angle: Creative["angle"];
  format: Creative["format"];
  hook: string;
  headline: string;
  leads: number;
  qualified: number;
  booked: number;
  shows: number;
  won: number;
  spend: number;
  adSet: 0 | 1;
  /** Outcomes for shown-but-not-won leads, in order. */
  otherShownOutcomes: PipelineStage[];
  /** Booked-but-not-shown: "noshow" (past) or "upcoming" (future). */
  notShown: Array<"noshow" | "upcoming">;
  metaAdId: string;
  metaCreativeId: string;
}

// Totals: 58 leads, 24 qualified, 14 booked, 10 shows, 3 won, $2,000 spend, 3 x $3,497 = $10,491 revenue.
const PLANS: CreativePlan[] = [
  { name: "Problem | Slow weeks? (video)", angle: "problem", format: "video", hook: "Are slow weeks hurting your roofing business?", headline: "More Booked Estimates for Roofers", leads: 20, qualified: 10, booked: 6, shows: 4, won: 2, spend: 640, adSet: 0, otherShownOutcomes: ["PROPOSAL", "SHOWED"], notShown: ["noshow", "upcoming"], metaAdId: "120210000000001", metaCreativeId: "220210000000001" },
  { name: "Outcome | Estimates on the calendar (image)", angle: "outcome", format: "image", hook: "Open Monday with estimates already booked", headline: "Qualified Estimates, No Door-Knocking", leads: 16, qualified: 8, booked: 5, shows: 4, won: 1, spend: 600, adSet: 0, otherShownOutcomes: ["PROPOSAL", "LOST", "LOST"], notShown: ["upcoming"], metaAdId: "120210000000002", metaCreativeId: "220210000000002" },
  { name: "Educational | 3 reasons leads go cold (carousel)", angle: "educational", format: "carousel", hook: "3 reasons roofing leads go cold", headline: "Why Roofing Leads Go Cold", leads: 14, qualified: 4, booked: 2, shows: 1, won: 0, spend: 520, adSet: 1, otherShownOutcomes: ["SHOWED"], notShown: ["noshow"], metaAdId: "120210000000003", metaCreativeId: "220210000000003" },
  { name: "Objection | \"Marketing never worked\" (video)", angle: "objection", format: "video", hook: "\"I've tried marketing before and it didn't work.\"", headline: "Marketing You Can Measure", leads: 8, qualified: 2, booked: 1, shows: 1, won: 0, spend: 240, adSet: 1, otherShownOutcomes: ["LOST"], notShown: [], metaAdId: "120210000000004", metaCreativeId: "220210000000004" },
];

const DAY = 86400000;
const iso = (d: Date) => d.toISOString();

export async function seedRoofingWorkspace(repo: Repo, ws: Workspace, deps: Deps): Promise<void> {
  const now = deps.now();
  const r = rng(7);
  const pick = <T,>(arr: T[]): T => arr[Math.floor(r() * arr.length)]!;
  const between = (lo: number, hi: number) => lo + r() * (hi - lo);

  const campaign = await repo.insert("campaigns", ws.id, { name: "Roofing Lead Generation", niche: "roofing", objective: "OUTCOME_LEADS", status: "active", dailyBudget: 75, metaCampaignId: "120200000000001", metaAdAccountId: "act_1000000000001", createdAt: iso(new Date(now.getTime() - 30 * DAY)) } as Omit<Campaign, "id" | "workspaceId">);
  const adSets: AdSet[] = [];
  for (const [i, name] of ["Roofing | Broad Tampa Bay +20mi", "Roofing | Business owners interest"].entries()) {
    adSets.push(await repo.insert("adSets", ws.id, { campaignId: campaign.id, name, audience: i === 0 ? "Broad, 30-65" : "Interest: small business owners", status: "active", dailyBudget: 37.5, metaAdsetId: `1203000000000${i + 1}`, createdAt: iso(new Date(now.getTime() - 30 * DAY)) } as Omit<AdSet, "id" | "workspaceId">));
  }

  // Creatives + ads.
  const creatives: Creative[] = [];
  const ads: Ad[] = [];
  for (const p of PLANS) {
    const creative = await repo.insert("creatives", ws.id, { campaignId: campaign.id, name: p.name, hook: p.hook, angle: p.angle, format: p.format, headline: p.headline, audience: p.adSet === 0 ? "Broad" : "Interest", launchDate: iso(new Date(now.getTime() - 28 * DAY)).slice(0, 10), status: "TESTING", metaCreativeId: p.metaCreativeId, createdAt: iso(new Date(now.getTime() - 28 * DAY)) } as Omit<Creative, "id" | "workspaceId">);
    creatives.push(creative);
    ads.push(await repo.insert("ads", ws.id, { adSetId: adSets[p.adSet]!.id, campaignId: campaign.id, creativeId: creative.id, name: p.name, status: "active", metaAdId: p.metaAdId, createdAt: creative.createdAt } as Omit<Ad, "id" | "workspaceId">));
  }

  // Daily metrics: spread each ad's spend over 28 days with noise, then fix rounding so totals are exact.
  for (const [i, p] of PLANS.entries()) {
    const days = 28;
    const weights = Array.from({ length: days }, () => 0.6 + r() * 0.8);
    const wsum = weights.reduce((a, b) => a + b, 0);
    let remaining = Math.round(p.spend * 100);
    const clicksTotal = Math.round(p.leads / between(0.085, 0.11));
    const imprTotal = Math.round(clicksTotal / between(0.011, 0.016));
    for (let d = 0; d < days; d++) {
      const cents = d === days - 1 ? remaining : Math.round(((weights[d]! / wsum) * p.spend) * 100);
      remaining -= d === days - 1 ? remaining : cents;
      const share = weights[d]! / wsum;
      const date = iso(new Date(now.getTime() - (days - d) * DAY)).slice(0, 10);
      await repo.insert("metrics", ws.id, { date, campaignId: campaign.id, adSetId: ads[i]!.adSetId, adId: ads[i]!.id, creativeId: creatives[i]!.id, spend: cents / 100, impressions: Math.round(imprTotal * share), reach: Math.round(imprTotal * share * 0.8), clicks: Math.round(clicksTotal * share), platformLeads: 0, source: "meta" });
    }
  }

  await ensureDefaultRules(deps, ws);

  // Experiment: headline A/B on the roofing landing page. Deliberately small so it shows "not enough data".
  const experiment = await repo.insert("experiments", ws.id, { name: "Headline: outcome vs. problem", type: "headline", status: "running", controlLabel: "Control: outcome headline", variantLabel: "Variant: problem headline", config: { landingSlug: "roofing", control: {}, variant: { headline: "Slow weeks? Fill the calendar with qualified roofing estimates." } }, startedAt: iso(new Date(now.getTime() - 14 * DAY)), createdAt: iso(new Date(now.getTime() - 14 * DAY)) });
  await repo.insert("experimentArms", ws.id, { experimentId: experiment.id, arm: "control", visitors: 238, spend: 410 });
  await repo.insert("experimentArms", ws.id, { experimentId: experiment.id, arm: "variant", visitors: 226, spend: 396 });

  // Leads, one creative at a time.
  let n = 0;
  let waitingPlaced = 0;
  for (const [ci, p] of PLANS.entries()) {
    const creative = creatives[ci]!;
    const ad = ads[ci]!;
    type Role = "won" | "shownOther" | "notShown" | "qualifiedOnly" | "unqualified";
    const roles: Array<{ role: Role; outcome?: PipelineStage; notShown?: "noshow" | "upcoming" }> = [];
    for (let i = 0; i < p.won; i++) roles.push({ role: "won" });
    for (const o of p.otherShownOutcomes) roles.push({ role: "shownOther", outcome: o });
    for (const ns of p.notShown) roles.push({ role: "notShown", notShown: ns });
    for (let i = 0; i < p.qualified - p.booked; i++) roles.push({ role: "qualifiedOnly" });
    for (let i = 0; i < p.leads - p.qualified; i++) roles.push({ role: "unqualified" });
    if (roles.length !== p.leads) throw new Error(`Seed plan for ${p.name} is inconsistent (${roles.length} roles, ${p.leads} leads)`);

    for (const [ri, role] of roles.entries()) {
      n++;
      const first = FIRST[(n * 7) % FIRST.length]!;
      const last = LAST[(n * 11) % LAST.length]!;
      const [city, state] = pick(CITIES);
      const business = BIZ[(n * 3) % BIZ.length]!;

      // Created-at window per role so the sales cycle looks real (won leads are oldest).
      let ageDays: number;
      switch (role.role) {
        case "won": ageDays = between(14, 26); break;
        case "shownOther": ageDays = between(7, 22); break;
        case "notShown": ageDays = role.notShown === "upcoming" ? between(1, 3) : between(6, 14); break;
        case "qualifiedOnly": ageDays = between(1, 20); break;
        default: ageDays = between(0.5, 27);
      }
      let createdAt = new Date(now.getTime() - ageDays * DAY);

      // Two fresh leads still waiting for a first response, to exercise speed-to-lead alerts.
      let waiting = false;
      if (role.role === "unqualified" && waitingPlaced < 2 && ci === 0) {
        createdAt = new Date(now.getTime() - (waitingPlaced === 0 ? 7 : 22) * 60000);
        waiting = true;
        waitingPlaced++;
      }

      const qualifiedFlow = role.role !== "unqualified";
      const disqualified = role.role === "unqualified" && ri % 4 === 1 && !waiting;
      const revenueBand: RevenueRange = qualifiedFlow ? (ri % 3 === 0 ? "over_100k" : "30k_100k") : disqualified ? "under_10k" : ri % 2 ? "10k_30k" : "under_10k";
      const budget: BudgetRange = qualifiedFlow ? (ri % 2 ? "3k_10k" : "1k_3k") : disqualified ? "under_1k" : "under_1k";
      const timeline: Timeline = qualifiedFlow ? (ri % 2 ? "asap" : "within_30_days") : "exploring";
      const problem = qualifiedFlow ? "Our calendar is inconsistent — some weeks we have 10 estimates, others none, and we're wasting money on lead lists." : "";

      const scored = scoreLead({ industry: "Roofing", city, state, monthlyRevenue: revenueBand, budgetRange: budget, timeline, primaryProblem: problem, businessName: business, readyToInvest: disqualified ? false : undefined, hasBookedCall: role.role === "won" || role.role === "shownOther" || role.role === "notShown" });

      const email = `${first}.${last}${n}@${business.toLowerCase().replace(/[^a-z]/g, "").slice(0, 14)}.example`.toLowerCase();
      const phone = `813555${String(1000 + n).slice(-4)}`;
      const touch = { utm_source: "meta", utm_medium: "paid", utm_campaign: "roofing-lead-generation", utm_content: creative.name, meta_campaign_id: campaign.metaCampaignId, meta_adset_id: adSets[p.adSet]!.metaAdsetId, meta_ad_id: p.metaAdId, landing_page: "/roofing", at: iso(createdAt) };

      // Timeline stamps.
      const qualifiedAt = qualifiedFlow ? new Date(createdAt.getTime() + between(2, 60) * 60000) : undefined;
      const bookedAt = ["won", "shownOther", "notShown"].includes(role.role) ? new Date(createdAt.getTime() + between(0.2, 2) * DAY) : undefined;
      const showedAt = role.role === "won" || role.role === "shownOther" ? new Date(bookedAt!.getTime() + between(1, 3) * DAY) : undefined;

      let stage: PipelineStage;
      let tier = scored.tier;
      let lostReason: string | undefined;
      let lostAt: Date | undefined;
      let wonAt: Date | undefined;
      if (role.role === "won") { stage = "WON"; wonAt = new Date(showedAt!.getTime() + between(0.5, 3) * DAY); }
      else if (role.role === "shownOther") { stage = role.outcome!; if (stage === "LOST") { lostReason = "Chose a competitor"; lostAt = new Date(showedAt!.getTime() + 2 * DAY); } }
      else if (role.role === "notShown") stage = role.notShown === "upcoming" ? "BOOKED" : "QUALIFIED";
      else if (role.role === "qualifiedOnly") stage = "QUALIFIED";
      else if (disqualified) { stage = "LOST"; tier = "DISQUALIFIED"; lostReason = "Disqualified: Not prepared to invest in a marketing system"; lostAt = new Date(createdAt.getTime() + 60000); }
      else stage = "NEW_LEAD";
      if (stage === "BOOKED" && ri % 2 === 0) stage = "CONFIRMED";

      // Human first response: most within minutes, a few slow.
      const respMin = waiting || disqualified ? undefined : ri % 9 === 4 ? between(25, 70) : between(1.5, 9);
      const firstResponseAt = respMin !== undefined ? new Date(createdAt.getTime() + respMin * 60000) : undefined;

      const experimentArm = ageDays < 14 && !waiting ? (n % 2 === 0 ? "variant" : "control") : undefined;
      const lead = await repo.insert("leads", ws.id, {
        dedupeKey: dedupeKey(ws.id, email, phone), firstName: first, lastName: last, email, phone, businessName: business, industry: "Roofing", city, state,
        monthlyRevenue: revenueBand, budgetRange: budget, timeline, primaryProblem: problem || undefined, readyToInvest: disqualified ? false : undefined,
        currentLeadGenMethod: qualifiedFlow ? "Referrals and Angi" : undefined,
        stage, tier, score: scored.score, disqualifiedReason: disqualified ? "Not prepared to invest" : undefined, lostReason,
        campaignId: campaign.id, adSetId: adSets[p.adSet]!.id, adId: ad.id, creativeId: creative.id, source: "landing_page",
        experimentId: experimentArm ? experiment.id : undefined, experimentArm,
        contactConsentAt: iso(createdAt), consentText: "I agree to be contacted about my request.", optedOutEmail: false, optedOutSms: false, unsubscribeToken: crypto.randomUUID(),
        attribution: mergeTouches(null, touch),
        qualifiedAt: qualifiedAt && iso(qualifiedAt), bookedAt: bookedAt && iso(bookedAt), showedAt: showedAt && iso(showedAt), wonAt: wonAt && iso(wonAt), lostAt: lostAt && iso(lostAt),
        firstResponseAt: firstResponseAt && iso(firstResponseAt), lastActivityAt: iso(wonAt ?? showedAt ?? bookedAt ?? qualifiedAt ?? createdAt),
        nextAction: undefined, createdAt: iso(createdAt),
      } as Omit<Lead, "id" | "workspaceId">);

      await repo.insert("leadEvents", ws.id, { leadId: lead.id, type: "created", data: { source: "landing_page", tier, score: scored.score }, createdAt: iso(createdAt) });
      await repo.insert("communications", ws.id, { leadId: lead.id, channel: "email", direction: "outbound", stepId: "instant", subject: "Thanks for reaching out — here's the next step", status: "sent", sentAt: iso(createdAt), createdAt: iso(createdAt) });
      if (qualifiedAt) await repo.insert("pipelineEvents", ws.id, { leadId: lead.id, fromStage: "NEW_LEAD", toStage: "QUALIFIED", createdAt: iso(qualifiedAt) });

      // Appointments.
      if (bookedAt) {
        let start: Date;
        let status: Appointment["status"];
        if (role.role === "notShown" && role.notShown === "upcoming") { start = new Date(now.getTime() + between(0.3, 2) * DAY); status = stage === "CONFIRMED" ? "CONFIRMED" : "SCHEDULED"; }
        else if (role.role === "notShown") { start = new Date(bookedAt.getTime() + between(1, 3) * DAY); status = "NO_SHOW"; }
        else { start = new Date(showedAt!.getTime() - 10 * 60000); status = "SHOWED"; }
        start.setMinutes(Math.round(start.getMinutes() / 30) * 30, 0, 0);
        try {
          const appt = await repo.insert("appointments", ws.id, { leadId: lead.id, provider: "internal", startAt: iso(start), endAt: iso(new Date(start.getTime() + 30 * 60000)), timezone: "America/New_York", status, createdAt: iso(bookedAt) } as Omit<Appointment, "id" | "workspaceId">);
          void appt;
        } catch {
          /* two seeded leads picked the same half-hour slot: skip the duplicate, unique index would reject it in Postgres too */
        }
        await repo.insert("pipelineEvents", ws.id, { leadId: lead.id, fromStage: "QUALIFIED", toStage: "BOOKED", createdAt: iso(bookedAt) });
      }

      if (role.role === "won") {
        const customer = await repo.insert("customers", ws.id, { leadId: lead.id, name: `${first} ${last}`, company: business, email, startedOn: iso(wonAt!).slice(0, 10) });
        const deal = await repo.insert("deals", ws.id, { leadId: lead.id, customerId: customer.id, status: "won", clientValue: 3497, initialPayment: 3497, recurringPayment: 0, recurringMonths: 0, oneTimeFees: 0, contractValue: 3497, closeDate: iso(wonAt!).slice(0, 10), salesperson: "Logan", campaignId: campaign.id, adId: ad.id, creativeId: creative.id, createdAt: iso(wonAt!) });
        await repo.insert("revenue", ws.id, { dealId: deal.id, customerId: customer.id, kind: "initial", amount: 3497, receivedOn: iso(wonAt!).slice(0, 10), createdAt: iso(wonAt!) });
        await repo.insert("pipelineEvents", ws.id, { leadId: lead.id, fromStage: "PROPOSAL", toStage: "WON", createdAt: iso(wonAt!) });
      }
    }
  }

  await repo.insert("auditLogs", ws.id, { actorType: "user", actorId: DEMO_USER_ID, action: "insert", entityType: "campaigns", entityId: campaign.id, campaignId: campaign.id, after: { name: campaign.name, status: "active" }, createdAt: iso(new Date(now.getTime() - 30 * DAY)) });
  await repo.insert("auditLogs", ws.id, { actorType: "user", actorId: DEMO_USER_ID, action: "update", entityType: "creatives", entityId: creatives[0]!.id, campaignId: campaign.id, before: { status: "TESTING" }, after: { status: "WINNER" }, createdAt: iso(new Date(now.getTime() - 2 * DAY)) });
}

/** Second workspace: a niche test that is burning money with no qualified leads, so the alerts have something to say. */
export async function seedHvacWorkspace(repo: Repo, ws: Workspace, deps: Deps): Promise<void> {
  const now = deps.now();
  const r = rng(21);
  const campaign = await repo.insert("campaigns", ws.id, { name: "HVAC Spring Tune-Up Test", niche: "hvac", objective: "OUTCOME_LEADS", status: "active", dailyBudget: 50, metaCampaignId: "120200000000002", metaAdAccountId: "act_1000000000001", createdAt: iso(new Date(now.getTime() - 8 * DAY)) } as Omit<Campaign, "id" | "workspaceId">);
  const adSet = await repo.insert("adSets", ws.id, { campaignId: campaign.id, name: "HVAC | Broad Dallas", audience: "Broad", status: "active", dailyBudget: 50, metaAdsetId: "120300000000003", createdAt: campaign.createdAt } as Omit<AdSet, "id" | "workspaceId">);
  const creative = await repo.insert("creatives", ws.id, { campaignId: campaign.id, name: "HVAC | Offer: free tune-up estimate", angle: "offer", format: "image", hook: "Free tune-up estimate", status: "TESTING", metaCreativeId: "220210000000010", launchDate: iso(new Date(now.getTime() - 7 * DAY)).slice(0, 10), createdAt: campaign.createdAt } as Omit<Creative, "id" | "workspaceId">);
  const ad = await repo.insert("ads", ws.id, { adSetId: adSet.id, campaignId: campaign.id, creativeId: creative.id, name: creative.name, status: "active", metaAdId: "120210000000010", createdAt: campaign.createdAt } as Omit<Ad, "id" | "workspaceId">);
  for (let d = 7; d >= 1; d--) {
    await repo.insert("metrics", ws.id, { date: iso(new Date(now.getTime() - d * DAY)).slice(0, 10), campaignId: campaign.id, adSetId: adSet.id, adId: ad.id, creativeId: creative.id, spend: d === 1 ? 49.8 : 48.4, impressions: 4000 + Math.round(r() * 800), reach: 3200, clicks: 40 + Math.round(r() * 15), platformLeads: 1, source: "meta" });
  }
  for (let i = 0; i < 9; i++) {
    const createdAt = new Date(now.getTime() - (1 + i * 0.7) * DAY);
    const email = `hvac.lead${i}@example.test`;
    await repo.insert("leads", ws.id, {
      dedupeKey: dedupeKey(ws.id, email), firstName: ["Ann", "Bo", "Cy", "Di", "Ed", "Flo", "Gus", "Hal", "Ivy"][i]!, lastName: "Homeowner", email, industry: "Residential", monthlyRevenue: "under_10k", budgetRange: "under_1k", timeline: "exploring",
      stage: "NEW_LEAD", tier: "COLD", score: 12, campaignId: campaign.id, adSetId: adSet.id, adId: ad.id, creativeId: creative.id, source: "landing_page", contactConsentAt: iso(createdAt),
      optedOutEmail: false, optedOutSms: false, unsubscribeToken: crypto.randomUUID(), attribution: mergeTouches(null, { utm_source: "meta", utm_medium: "paid", meta_ad_id: "120210000000010", landing_page: "/hvac", at: iso(createdAt) }),
      firstResponseAt: iso(new Date(createdAt.getTime() + 6 * 60000)), lastActivityAt: iso(createdAt), createdAt: iso(createdAt),
    } as Omit<Lead, "id" | "workspaceId">);
  }
}

export function demoWorkspace(partial: Partial<Workspace> & Pick<Workspace, "id" | "name" | "slug">): Workspace {
  return {
    industry: "roofing", timezone: "America/New_York", avgClientValue: 3497, grossMargin: 0.85, desiredProfitMargin: 0.25,
    targetCac: 1000, targetCpl: 40, targetBookedCallCost: 150, targetRoas: 3, closeRate: 0.25, showRate: 0.7, qualifiedRate: 0.35, bookedRate: 0.5,
    avgSalesCycleDays: 14, monthlyAdBudget: 3000, monthlyRevenueTarget: 10491, scoringConfig: {}, speedTargetMinutes: 5, speedCriticalMinutes: 15,
    senderName: "Logan at ScaleWaves", senderEmail: "hello@scalewaves.example", postalAddress: "123 Main St, Suite 4, Tampa, FL 33602", bookingConfig: {}, createdAt: new Date().toISOString(),
    ...partial,
  };
}

/** Builds the full demo dataset in a MemoryRepo. */
export async function seedDemo(repo: MemoryRepo, deps: Deps): Promise<void> {
  const roofing = demoWorkspace({ id: crypto.randomUUID(), name: "ScaleWaves — Roofing", slug: "roofing", industry: "roofing", location: "Tampa Bay, FL", offer: "Get 10–15 Qualified Roofing Estimates in 90 Days", website: "https://scalewaves.example" });
  const hvac = demoWorkspace({ id: crypto.randomUUID(), name: "ScaleWaves — HVAC test", slug: "hvac-test", industry: "hvac", location: "Dallas, TX", offer: "Free tune-up estimate funnel", avgClientValue: 2500, targetCpl: 35, monthlyAdBudget: 1500, monthlyRevenueTarget: 5000 });
  repo.addWorkspace(roofing, [{ userId: DEMO_USER_ID, role: "owner" }]);
  repo.addWorkspace(hvac, [{ userId: DEMO_USER_ID, role: "owner" }]);
  await repo.insert("integrations", roofing.id, { provider: "meta", status: "disconnected", scopes: [] });
  await seedRoofingWorkspace(repo, roofing, deps);
  await seedHvacWorkspace(repo, hvac, deps);
}
