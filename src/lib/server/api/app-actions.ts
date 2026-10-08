import { z } from "zod";
import { buildCampaignPlan, CREATIVE_ANGLES } from "@/lib/core/campaign-plan";
import { checkAdCopy } from "@/lib/core/compliance";
import { resolveRange, DATE_PRESETS } from "@/lib/core/dates";
import { CREATIVE_STATUSES, PIPELINE_STAGES } from "@/lib/core/types";
import { workspaceSettingsSchema } from "@/lib/core/validation";
import { EXPERIMENT_TYPES } from "@/lib/core/experiments";
import type { Role } from "../entities";
import { ValidationError, NotFoundError, audit, type Deps } from "../services/common";
import { closeDeal } from "../services/deals";
import { createLead, recordFirstResponse } from "../services/leads";
import { markCallOutcome, moveLead } from "../services/pipeline";
import { getDashboard } from "../services/dashboard";
import { askAnalyst } from "../services/analyst-ai";
import { createMetaCampaign, MetaClient, setMetaDailyBudget, setMetaStatus, syncMeta, getMetaIntegration } from "../services/meta";
import { getSecretStore, type Access } from "../context";
import { env } from "../env";

export interface ActionCtx {
  access: Access;
  body: unknown;
  params: Record<string, string>;
}

interface Action {
  method: "POST" | "GET";
  pattern: string; // e.g. "leads/:id/move"
  minRole: Role;
  run: (c: ActionCtx) => Promise<unknown>;
}

const actor = (c: ActionCtx) => ({ type: "user" as const, id: c.access.user.id });

const moveSchema = z.object({ to: z.enum(PIPELINE_STAGES), lostReason: z.string().max(300).optional() });
const dealSchema = z.object({
  initialPayment: z.number().min(0),
  recurringPayment: z.number().min(0).optional(),
  recurringMonths: z.number().int().min(0).max(120).optional(),
  oneTimeFees: z.number().min(0).optional(),
  clientValue: z.number().min(0).optional(),
  closeDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  salesperson: z.string().max(80).optional(),
});
const briefSchema = z.object({
  niche: z.string().min(2).max(80),
  city: z.string().min(2).max(80),
  offer: z.string().max(300).default(""),
  targetCustomer: z.string().max(200).default(""),
  painPoint: z.string().max(300).default(""),
  desiredOutcome: z.string().max(300).default(""),
  monthlyBudget: z.number().min(0).max(1_000_000),
  landingPage: z.string().max(200).default(""),
  conversionEvent: z.enum(["lead", "schedule", "complete_registration"]).default("lead"),
  angles: z.array(z.enum(CREATIVE_ANGLES)).optional(),
  hasVerifiedCaseStudy: z.boolean().optional(),
});
const stepSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/),
  delayMinutes: z.number().int().min(0).max(60 * 24 * 60),
  channel: z.enum(["email", "sms"]),
  subject: z.string().max(200).optional(),
  body: z.string().min(1).max(5000),
});

export const ACTIONS: Action[] = [
  {
    method: "POST", pattern: "leads/:id/move", minRole: "member",
    run: async (c) => {
      const b = moveSchema.parse(c.body);
      return { lead: await moveLead(c.access.deps, c.access.ws.id, c.params.id!, b.to, actor(c), { lostReason: b.lostReason }) };
    },
  },
  {
    method: "POST", pattern: "leads/:id/response", minRole: "member",
    run: async (c) => {
      const b = z.object({ channel: z.enum(["call", "email", "sms", "note"]).default("call") }).parse(c.body ?? {});
      return { lead: await recordFirstResponse(c.access.deps, c.access.ws.id, c.params.id!, c.access.user.id, b.channel) };
    },
  },
  {
    method: "POST", pattern: "leads/:id/close", minRole: "member",
    run: async (c) => closeDeal(c.access.deps, c.access.ws.id, c.params.id!, dealSchema.parse(c.body), actor(c)),
  },
  {
    method: "POST", pattern: "leads", minRole: "member",
    run: async (c) => {
      // Manual add: the person adding it attests that the lead asked to be contacted.
      const body = z.record(z.string(), z.unknown()).parse(c.body);
      if (body.contactConsent !== true) throw new ValidationError("Confirm this person asked to be contacted");
      return createLead(c.access.deps, { ...body, workspaceSlug: c.access.ws.slug }, { source: "manual", consentText: `Added manually by ${c.access.user.email}` });
    },
  },
  {
    method: "POST", pattern: "appointments/:id/outcome", minRole: "member",
    run: async (c) => {
      const b = z.object({ outcome: z.enum(["SHOWED", "NO_SHOW", "RESCHEDULED", "LOST"]) }).parse(c.body);
      return { lead: await markCallOutcome(c.access.deps, c.access.ws.id, c.params.id!, b.outcome, actor(c)) };
    },
  },
  {
    method: "POST", pattern: "creatives/:id/status", minRole: "member",
    run: async (c) => {
      const b = z.object({ status: z.enum(CREATIVE_STATUSES) }).parse(c.body);
      const { deps, ws } = c.access;
      const before = await deps.repo.get("creatives", ws.id, c.params.id!);
      if (!before) throw new NotFoundError("Creative not found");
      const updated = await deps.repo.update("creatives", ws.id, before.id, { status: b.status });
      await audit(deps, ws.id, actor(c), { action: "creative_status", entityType: "creatives", entityId: before.id, campaignId: before.campaignId, before: { status: before.status }, after: { status: b.status } });
      return { creative: updated };
    },
  },
  {
    method: "POST", pattern: "campaigns/plan", minRole: "member",
    run: async (c) => ({ plan: buildCampaignPlan(briefSchema.parse(c.body)) }),
  },
  {
    method: "POST", pattern: "campaigns", minRole: "member",
    run: async (c) => {
      const b = z.object({ brief: briefSchema, name: z.string().min(2).max(120) }).parse(c.body);
      const { deps, ws } = c.access;
      const plan = buildCampaignPlan(b.brief);
      // Block saving copy that would get an account in trouble; the user fixes it and retries.
      const blocking = plan.concepts.flatMap((x) => x.complianceIssues.map((i) => `${x.name}: ${i.rule}`));
      if (blocking.length) throw new ValidationError(`Fix compliance issues first: ${blocking.join("; ")}`);
      const campaign = await deps.repo.insert("campaigns", ws.id, { name: b.name, niche: b.brief.niche.toLowerCase(), objective: plan.objective, status: "draft", dailyBudget: Math.round((b.brief.monthlyBudget / 30) * 100) / 100, plan });
      for (const concept of plan.concepts) {
        await deps.repo.insert("creatives", ws.id, { campaignId: campaign.id, name: concept.name, hook: concept.hook, angle: concept.angle, format: concept.format, primaryText: concept.primaryText, headline: concept.headline, description: concept.description, cta: concept.cta, status: "TESTING" });
      }
      await audit(deps, ws.id, actor(c), { action: "campaign_created", entityType: "campaigns", entityId: campaign.id, campaignId: campaign.id, after: { name: b.name, concepts: plan.concepts.length } });
      return { campaign };
    },
  },
  {
    method: "POST", pattern: "copy-check", minRole: "viewer",
    run: async (c) => ({ issues: checkAdCopy(z.object({ text: z.string().max(5000) }).parse(c.body).text) }),
  },
  {
    method: "POST", pattern: "settings", minRole: "admin",
    run: async (c) => {
      const patch = workspaceSettingsSchema.omit({ slug: true }).partial().parse(c.body);
      const { deps, ws } = c.access;
      const before = { ...ws };
      const updated = await deps.repo.updateWorkspace(ws.id, patch as never);
      await audit(deps, ws.id, actor(c), { action: "settings_updated", entityType: "workspaces", entityId: ws.id, before: Object.fromEntries(Object.keys(patch).map((k) => [k, (before as unknown as Record<string, unknown>)[k]])), after: patch });
      return { workspace: updated };
    },
  },
  {
    method: "POST", pattern: "automations/:id", minRole: "admin",
    run: async (c) => {
      const b = z.object({ enabled: z.boolean().optional(), steps: z.array(stepSchema).min(1).max(12).optional() }).parse(c.body);
      if (b.steps && new Set(b.steps.map((s) => s.id)).size !== b.steps.length) throw new ValidationError("Step ids must be unique");
      const { deps, ws } = c.access;
      const rule = await deps.repo.get("automationRules", ws.id, c.params.id!);
      if (!rule) throw new NotFoundError("Automation not found");
      const updated = await deps.repo.update("automationRules", ws.id, rule.id, { enabled: b.enabled ?? rule.enabled, config: { steps: b.steps ?? rule.config.steps } });
      await audit(deps, ws.id, actor(c), { action: "automation_updated", entityType: "automation_rules", entityId: rule.id, before: { enabled: rule.enabled, steps: rule.config.steps.length }, after: { enabled: updated.enabled, steps: updated.config.steps.length } });
      return { rule: updated };
    },
  },
  {
    method: "POST", pattern: "experiments", minRole: "member",
    run: async (c) => {
      const b = z.object({
        name: z.string().min(2).max(120), type: z.enum(EXPERIMENT_TYPES), controlLabel: z.string().max(80).default("Control"), variantLabel: z.string().max(80).default("Variant"),
        landingSlug: z.string().max(60).optional(), variant: z.record(z.string(), z.string().max(500)).default({}),
      }).parse(c.body);
      const { deps, ws } = c.access;
      const exp = await deps.repo.insert("experiments", ws.id, { name: b.name, type: b.type, status: "running", controlLabel: b.controlLabel, variantLabel: b.variantLabel, config: { landingSlug: b.landingSlug, control: {}, variant: b.variant }, startedAt: deps.now().toISOString() });
      await deps.repo.insert("experimentArms", ws.id, { experimentId: exp.id, arm: "control", visitors: 0, spend: 0 });
      await deps.repo.insert("experimentArms", ws.id, { experimentId: exp.id, arm: "variant", visitors: 0, spend: 0 });
      await audit(deps, ws.id, actor(c), { action: "experiment_created", entityType: "experiments", entityId: exp.id, after: { name: b.name, type: b.type } });
      return { experiment: exp };
    },
  },
  {
    method: "POST", pattern: "experiments/:id/arm", minRole: "member",
    run: async (c) => {
      const b = z.object({ arm: z.enum(["control", "variant"]), addVisitors: z.number().int().min(0).max(10_000_000).optional(), addSpend: z.number().min(0).max(10_000_000).optional() }).parse(c.body);
      const { deps, ws } = c.access;
      const [arm] = await deps.repo.list("experimentArms", ws.id, { where: { experimentId: c.params.id!, arm: b.arm }, limit: 1 });
      if (!arm) throw new NotFoundError("Experiment arm not found");
      if (b.addVisitors) await deps.repo.increment("experimentArms", ws.id, arm.id, "visitors", b.addVisitors);
      if (b.addSpend) await deps.repo.increment("experimentArms", ws.id, arm.id, "spend", b.addSpend);
      return { ok: true };
    },
  },
  {
    method: "POST", pattern: "experiments/:id/stop", minRole: "member",
    run: async (c) => {
      const { deps, ws } = c.access;
      const exp = await deps.repo.get("experiments", ws.id, c.params.id!);
      if (!exp) throw new NotFoundError("Experiment not found");
      const updated = await deps.repo.update("experiments", ws.id, exp.id, { status: "completed", endedAt: deps.now().toISOString() });
      await audit(deps, ws.id, actor(c), { action: "experiment_stopped", entityType: "experiments", entityId: exp.id });
      return { experiment: updated };
    },
  },
  {
    method: "POST", pattern: "analyst", minRole: "viewer",
    run: async (c) => {
      const b = z.object({ question: z.string().min(3).max(500), preset: z.enum(DATE_PRESETS).default("last_30_days") }).parse(c.body);
      const range = resolveRange(b.preset === "custom" ? "last_30_days" : b.preset, c.access.deps.now());
      const data = await getDashboard(c.access.readDeps, c.access.ws, { range });
      return askAnalyst(b.question, data);
    },
  },
  // ---- Meta ----
  {
    method: "POST", pattern: "meta/connect", minRole: "admin",
    run: async (c) => {
      const b = z.object({ adAccountId: z.string().regex(/^(act_)?\d{5,20}$/), pageId: z.string().regex(/^\d{5,25}$/).optional(), instagramAccountId: z.string().regex(/^\d{5,25}$/).optional(), accessToken: z.string().min(20).max(2000) }).parse(c.body);
      const { deps, ws } = c.access;
      // Verify the token works before storing anything.
      const client = new MetaClient({ token: b.accessToken, appSecret: env.metaAppSecret || undefined, version: env.metaVersion });
      await client.request("GET", b.adAccountId.startsWith("act_") ? b.adAccountId : `act_${b.adAccountId}`, { fields: "id,name" });
      const existing = await getMetaIntegration(deps, ws);
      const fields = { provider: "meta" as const, status: "connected" as const, metaAdAccountId: b.adAccountId.replace(/^act_/, ""), metaPageId: b.pageId, instagramAccountId: b.instagramAccountId, scopes: ["ads_read", "leads_retrieval"], lastError: undefined };
      const integration = existing ? await deps.repo.update("integrations", ws.id, existing.id, fields) : await deps.repo.insert("integrations", ws.id, fields);
      await getSecretStore().set(ws.id, integration.id, b.accessToken);
      await audit(deps, ws.id, actor(c), { action: "meta_connected", entityType: "integrations", entityId: integration.id, after: { adAccountId: fields.metaAdAccountId, pageId: b.pageId } }); // token is never logged
      return { integration: { ...integration } };
    },
  },
  {
    method: "POST", pattern: "meta/sync", minRole: "admin",
    run: async (c) => {
      const b = z.object({ days: z.number().int().min(1).max(90).default(30) }).parse(c.body ?? {});
      const { deps, ws } = c.access;
      const until = deps.now().toISOString().slice(0, 10);
      const since = new Date(deps.now().getTime() - b.days * 86400000).toISOString().slice(0, 10);
      return syncMeta(deps, ws, { secrets: getSecretStore(), appSecret: env.metaAppSecret || undefined, version: env.metaVersion, since, until });
    },
  },
  {
    method: "POST", pattern: "meta/campaign", minRole: "admin",
    run: async (c) => {
      const b = z.object({ name: z.string().min(2).max(120), objective: z.enum(["OUTCOME_LEADS", "OUTCOME_TRAFFIC", "OUTCOME_SALES", "OUTCOME_AWARENESS", "OUTCOME_ENGAGEMENT"]).default("OUTCOME_LEADS"), specialAdCategories: z.array(z.enum(["NONE", "EMPLOYMENT", "HOUSING", "CREDIT", "ISSUES_ELECTIONS_POLITICS"])).default([]), confirm: z.literal(true) }).parse(c.body);
      const { deps, ws } = c.access;
      const client = await metaClientFor(deps, c);
      const integ = (await getMetaIntegration(deps, ws))!;
      const created = await createMetaCampaign(client, { adAccountId: integ.metaAdAccountId!, name: b.name, objective: b.objective, specialAdCategories: b.specialAdCategories.filter((x) => x !== "NONE") });
      const campaign = await deps.repo.insert("campaigns", ws.id, { name: b.name, status: "paused", objective: b.objective, metaCampaignId: created.id, metaAdAccountId: integ.metaAdAccountId });
      await audit(deps, ws.id, actor(c), { action: "meta_campaign_created", entityType: "campaigns", entityId: campaign.id, campaignId: campaign.id, after: { metaCampaignId: created.id, status: "PAUSED" } });
      return { campaign, note: "Created paused. Add ad sets and ads in Ads Manager, then activate." };
    },
  },
  {
    method: "POST", pattern: "meta/status", minRole: "admin",
    run: async (c) => {
      const b = z.object({ campaignId: z.string().uuid(), status: z.enum(["ACTIVE", "PAUSED"]), confirm: z.literal(true) }).parse(c.body);
      const { deps, ws } = c.access;
      const campaign = await deps.repo.get("campaigns", ws.id, b.campaignId);
      if (!campaign?.metaCampaignId) throw new ValidationError("This campaign isn't linked to Meta");
      await setMetaStatus(await metaClientFor(deps, c), campaign.metaCampaignId, b.status);
      const updated = await deps.repo.update("campaigns", ws.id, campaign.id, { status: b.status === "ACTIVE" ? "active" : "paused" });
      await audit(deps, ws.id, actor(c), { action: "meta_status_changed", entityType: "campaigns", entityId: campaign.id, campaignId: campaign.id, before: { status: campaign.status }, after: { status: updated.status } });
      return { campaign: updated };
    },
  },
  {
    method: "POST", pattern: "meta/budget", minRole: "admin",
    run: async (c) => {
      const b = z.object({ adSetId: z.string().uuid(), dailyBudget: z.number().min(1).max(100_000), confirm: z.literal(true) }).parse(c.body);
      const { deps, ws } = c.access;
      const adSet = await deps.repo.get("adSets", ws.id, b.adSetId);
      if (!adSet?.metaAdsetId) throw new ValidationError("This ad set isn't linked to Meta");
      await setMetaDailyBudget(await metaClientFor(deps, c), adSet.metaAdsetId, b.dailyBudget);
      const updated = await deps.repo.update("adSets", ws.id, adSet.id, { dailyBudget: b.dailyBudget });
      await audit(deps, ws.id, actor(c), { action: "meta_budget_changed", entityType: "ad_sets", entityId: adSet.id, campaignId: adSet.campaignId, before: { dailyBudget: adSet.dailyBudget }, after: { dailyBudget: b.dailyBudget } });
      return { adSet: updated };
    },
  },
  // ---- Landing pages ----
  {
    method: "POST", pattern: "landing-pages/:slug", minRole: "admin",
    run: async (c) => {
      const b = z.object({ niche: z.string().min(2).max(60), published: z.boolean().default(true), content: z.record(z.string(), z.unknown()) }).parse(c.body);
      if (!/^[a-z0-9-]{2,60}$/.test(c.params.slug!)) throw new ValidationError("Invalid page slug");
      // Social proof can only be published when each item is marked as verified (a real result you may publish).
      const proof = (b.content.caseStudies as Array<{ verified?: boolean }> | undefined) ?? [];
      if (proof.some((p) => p.verified !== true) && b.published) throw new ValidationError("Every case study must be marked verified before the page can be published. No placeholder or invented results.");
      const { deps, ws } = c.access;
      const { row } = await deps.repo.upsertBy("landingPages", ws.id, ["slug"], { slug: c.params.slug!, niche: b.niche, published: b.published, content: b.content });
      await audit(deps, ws.id, actor(c), { action: "landing_page_saved", entityType: "landing_pages", entityId: row.id, after: { slug: row.slug, published: row.published } });
      return { page: row };
    },
  },
];

async function metaClientFor(deps: Deps, c: ActionCtx): Promise<MetaClient> {
  const integ = await getMetaIntegration(deps, c.access.ws);
  if (!integ || integ.status === "disconnected" || !integ.metaAdAccountId) throw new ValidationError("Connect Meta first.");
  const token = await getSecretStore().get(c.access.ws.id, integ.id);
  if (!token) throw new ValidationError("Meta token missing. Reconnect Meta.");
  return new MetaClient({ token, appSecret: env.metaAppSecret || undefined, version: env.metaVersion });
}

export function matchAction(method: string, segments: string[]): { action: Action; params: Record<string, string> } | null {
  for (const a of ACTIONS) {
    if (a.method !== method) continue;
    const parts = a.pattern.split("/");
    if (parts.length !== segments.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (const [i, p] of parts.entries()) {
      if (p.startsWith(":")) params[p.slice(1)] = decodeURIComponent(segments[i]!);
      else if (p !== segments[i]) { ok = false; break; }
    }
    if (ok) return { action: a, params };
  }
  return null;
}
