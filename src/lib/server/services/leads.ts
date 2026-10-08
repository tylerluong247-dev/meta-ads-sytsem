import { mergeTouches, parseTouch, type Touch } from "@/lib/core/attribution";
import { DEFAULT_SCORING_CONFIG, isQualified, mergeScoringConfig, scoreLead, type ScoringConfig } from "@/lib/core/scoring";
import { dedupeKey, leadInputSchema, normalizeEmail, normalizePhone, type LeadInput } from "@/lib/core/validation";
import { nextAction } from "@/lib/core/pipeline";
import { assignArm } from "@/lib/core/experiments";
import type { Lead, Workspace } from "../entities";
import { UniqueViolation } from "../repo";
import { audit, logEvent, NotFoundError, ValidationError, type Deps } from "./common";
import { enrollInSequences } from "./followup";

export interface CreateLeadResult {
  ok: true;
  /** Null when the submission was silently dropped (honeypot). */
  leadId: string | null;
  duplicate: boolean;
  /** Capability token for the public booking page. */
  token: string | null;
  tier: Lead["tier"] | null;
}

export function scoringConfigFor(ws: Workspace): ScoringConfig {
  return mergeScoringConfig(DEFAULT_SCORING_CONFIG, ws.scoringConfig as Partial<ScoringConfig>);
}

/** Map Meta IDs from attribution to internal campaign/ad/creative rows so revenue rolls up correctly. */
async function resolveMetaEntities(deps: Deps, workspaceId: string, touch: Touch) {
  const out: { campaignId?: string; adSetId?: string; adId?: string; creativeId?: string } = {};
  if (touch.meta_ad_id) {
    const [ad] = await deps.repo.list("ads", workspaceId, { where: { metaAdId: touch.meta_ad_id }, limit: 1 });
    if (ad) {
      out.adId = ad.id;
      out.adSetId = ad.adSetId;
      out.campaignId = ad.campaignId;
      out.creativeId = ad.creativeId;
    }
  }
  if (!out.campaignId && touch.meta_campaign_id) {
    const [c] = await deps.repo.list("campaigns", workspaceId, { where: { metaCampaignId: touch.meta_campaign_id }, limit: 1 });
    if (c) out.campaignId = c.id;
  }
  if (!out.adSetId && touch.meta_adset_id) {
    const [s] = await deps.repo.list("adSets", workspaceId, { where: { metaAdsetId: touch.meta_adset_id }, limit: 1 });
    if (s) {
      out.adSetId = s.id;
      out.campaignId ??= s.campaignId;
    }
  }
  return out;
}

export interface CaptureMeta {
  ip?: string;
  landingUrl?: string; // full URL incl. query string where the form was submitted
  referrer?: string;
  consentText?: string;
  source?: Lead["source"];
  visitorId?: string;
  experimentId?: string;
}

/**
 * Public lead capture. Validation happens here (not just in the route) so every entry point — landing form,
 * Meta lead-ad webhook, manual add — gets identical dedupe, scoring, attribution, audit and follow-up behavior.
 */
export async function createLead(deps: Deps, rawInput: unknown, meta: CaptureMeta = {}): Promise<CreateLeadResult> {
  const parsed = leadInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) fields[issue.path.join(".") || "form"] = issue.message;
    throw new ValidationError("Please check the highlighted fields", fields);
  }
  const input: LeadInput = parsed.data;

  // Honeypot: bots fill hidden fields. Pretend success, store nothing.
  if (input.company_website_url) return { ok: true, leadId: null, duplicate: false, token: null, tier: null };

  const ws = await deps.repo.getWorkspaceBySlug(input.workspaceSlug);
  if (!ws) throw new NotFoundError("Unknown workspace");

  const now = deps.now();
  const nowIso = now.toISOString();
  const email = normalizeEmail(input.email);
  const key = dedupeKey(ws.id, email, input.phone);

  // Attribution: prefer what the page captured from the URL, fall back to the submission's URL.
  const fromUrl = meta.landingUrl ? parseTouch(meta.landingUrl, now, meta.referrer) : { at: nowIso };
  const incoming: Touch = { ...fromUrl, ...(input.attribution ?? {}), at: nowIso };

  // Duplicate: same workspace + email + phone. Record the touch, don't create a second lead.
  const [existing] = await deps.repo.list("leads", ws.id, { where: { dedupeKey: key }, limit: 1 });
  if (existing) return handleDuplicate(deps, ws, existing, incoming);

  const ids = await resolveMetaEntities(deps, ws.id, incoming);
  const scored = scoreLead(
    {
      industry: input.industry,
      city: input.city,
      state: input.state,
      monthlyRevenue: input.monthlyRevenue,
      budgetRange: input.budgetRange,
      timeline: input.timeline,
      readyToInvest: input.readyToInvest,
      primaryProblem: input.primaryProblem,
      businessName: input.businessName,
      website: input.website,
    },
    scoringConfigFor(ws),
  );

  const disqualified = scored.tier === "DISQUALIFIED";
  const qualified = isQualified(scored.tier);
  const stage: Lead["stage"] = disqualified ? "LOST" : qualified ? "QUALIFIED" : "NEW_LEAD";

  let experimentArm: Lead["experimentArm"];
  if (meta.experimentId && meta.visitorId) experimentArm = assignArm(meta.experimentId, meta.visitorId);

  let lead: Lead;
  try {
    lead = await deps.repo.insert("leads", ws.id, {
      dedupeKey: key,
      firstName: input.firstName,
      lastName: input.lastName,
      email,
      phone: input.phone ? normalizePhone(input.phone) : undefined,
      businessName: input.businessName,
      industry: input.industry ?? ws.industry,
      website: input.website,
      city: input.city,
      state: input.state,
      monthlyRevenue: input.monthlyRevenue,
      currentLeadGenMethod: input.currentLeadGenMethod,
      primaryProblem: input.primaryProblem,
      desiredOutcome: input.desiredOutcome,
      budgetRange: input.budgetRange,
      timeline: input.timeline,
      readyToInvest: input.readyToInvest,
      stage,
      tier: scored.tier,
      score: scored.score,
      disqualifiedReason: scored.disqualifiedReason,
      lostReason: disqualified ? `Disqualified: ${scored.disqualifiedReason}` : undefined,
      ...ids,
      source: meta.source ?? "landing_page",
      experimentId: meta.experimentId,
      experimentArm,
      contactConsentAt: nowIso,
      smsConsentAt: input.smsConsent && input.phone ? nowIso : undefined,
      consentText: meta.consentText,
      optedOutEmail: false,
      optedOutSms: false,
      unsubscribeToken: crypto.randomUUID(),
      attribution: mergeTouches(null, incoming),
      qualifiedAt: qualified ? nowIso : undefined,
      lostAt: disqualified ? nowIso : undefined,
      lastActivityAt: nowIso,
      nextAction: nextAction(stage, false),
      createdAt: nowIso,
    });
  } catch (e) {
    // Two identical submissions racing past the pre-check: the unique index wins; treat the loser as a duplicate.
    if (e instanceof UniqueViolation) {
      const [again] = await deps.repo.list("leads", ws.id, { where: { dedupeKey: key }, limit: 1 });
      if (again) return handleDuplicate(deps, ws, again, incoming);
    }
    throw e;
  }

  await deps.repo.insert("leadScores", ws.id, { leadId: lead.id, score: scored.score, tier: scored.tier, factors: scored.factors, createdAt: nowIso });
  await logEvent(deps, ws.id, lead.id, "created", { source: lead.source, tier: lead.tier, score: lead.score, factors: scored.factors });
  await audit(deps, ws.id, { type: "public" }, { action: "lead_created", entityType: "leads", entityId: lead.id, campaignId: lead.campaignId, after: { tier: lead.tier, stage: lead.stage, source: lead.source } });

  if (!disqualified) await enrollInSequences(deps, ws, lead, "lead_created");

  return { ok: true, leadId: lead.id, duplicate: false, token: lead.unsubscribeToken, tier: lead.tier };
}

async function handleDuplicate(deps: Deps, ws: Workspace, existing: Lead, incoming: Touch): Promise<CreateLeadResult> {
  const merged = mergeTouches(existing.attribution, incoming);
  await deps.repo.update("leads", ws.id, existing.id, { attribution: merged, lastActivityAt: deps.now().toISOString() });
  await logEvent(deps, ws.id, existing.id, "duplicate_submission", { touch: incoming });
  return { ok: true, leadId: existing.id, duplicate: true, token: existing.unsubscribeToken, tier: existing.tier };
}

/** Record the first human contact for speed-to-lead. Auto-acknowledgement emails do not count. */
export async function recordFirstResponse(deps: Deps, workspaceId: string, leadId: string, actorId?: string, channel: "call" | "email" | "sms" | "note" = "note"): Promise<Lead> {
  const lead = await deps.repo.get("leads", workspaceId, leadId);
  if (!lead) throw new NotFoundError("Lead not found");
  const nowIso = deps.now().toISOString();
  await deps.repo.insert("communications", workspaceId, { leadId, channel, direction: "outbound", status: "sent", sentAt: nowIso, body: "Manual first response", createdAt: nowIso });
  if (lead.firstResponseAt) return lead;
  const updated = await deps.repo.update("leads", workspaceId, leadId, { firstResponseAt: nowIso, lastActivityAt: nowIso });
  const minutes = (new Date(nowIso).getTime() - new Date(lead.createdAt).getTime()) / 60000;
  await logEvent(deps, workspaceId, leadId, "first_response", { minutes: Math.round(minutes * 10) / 10, channel }, actorId);
  return updated;
}
