import { applyCallOutcome, assertTransition, nextAction, STAGE_RANK, type CallOutcome } from "@/lib/core/pipeline";
import type { PipelineStage } from "@/lib/core/types";
import { isQualified, scoreLead } from "@/lib/core/scoring";
import type { Lead } from "../entities";
import { audit, logEvent, NotFoundError, ValidationError, type Actor, type Deps } from "./common";
import { cancelPendingRuns } from "./followup";
import { scoringConfigFor } from "./leads";

/** Funnel timestamps filled on first arrival, including stages implicitly passed (a lead that books has qualified). */
function timestampsFor(lead: Lead, to: PipelineStage, nowIso: string): Partial<Lead> {
  const rank = STAGE_RANK[to];
  const patch: Partial<Lead> = {};
  if (rank >= 1 && !lead.qualifiedAt) patch.qualifiedAt = nowIso;
  if (rank >= 2 && !lead.bookedAt) patch.bookedAt = nowIso;
  if (rank >= 4 && !lead.showedAt) patch.showedAt = nowIso;
  if (to === "WON" && !lead.wonAt) patch.wonAt = nowIso;
  if (to === "LOST") patch.lostAt = nowIso;
  return patch;
}

export async function moveLead(
  deps: Deps,
  workspaceId: string,
  leadId: string,
  to: PipelineStage,
  actor: Actor,
  opts: { note?: string; lostReason?: string; allowWon?: boolean } = {},
): Promise<Lead> {
  const lead = await deps.repo.get("leads", workspaceId, leadId);
  if (!lead) throw new NotFoundError("Lead not found");
  if (lead.stage === to) return lead;
  if (to === "WON" && !opts.allowWon) throw new ValidationError("Record the deal details to mark a lead as won (use Close deal).");
  assertTransition(lead.stage, to);

  const nowIso = deps.now().toISOString();
  const patch: Partial<Lead> = {
    stage: to,
    ...timestampsFor(lead, to, nowIso),
    lastActivityAt: nowIso,
    nextAction: nextAction(to, Boolean(lead.bookedAt) && (to === "QUALIFIED" || to === "BOOKED" || to === "CONFIRMED")),
  };
  if (to === "LOST") patch.lostReason = opts.lostReason ?? lead.lostReason ?? "Marked lost";
  if (lead.stage === "LOST" && to === "QUALIFIED") patch.lostReason = undefined;

  const updated = await deps.repo.update("leads", workspaceId, leadId, patch);
  await deps.repo.insert("pipelineEvents", workspaceId, { leadId, fromStage: lead.stage, toStage: to, actorId: actor.id, note: opts.note, createdAt: nowIso });
  await logEvent(deps, workspaceId, leadId, "stage_changed", { from: lead.stage, to }, actor.id);
  await audit(deps, workspaceId, actor, { action: "stage_changed", entityType: "leads", entityId: leadId, campaignId: lead.campaignId, before: { stage: lead.stage }, after: { stage: to } });

  if (to === "BOOKED" || to === "WON" || to === "LOST") await cancelPendingRuns(deps, workspaceId, leadId, `stage_${to.toLowerCase()}`);
  return updated;
}

/** Re-score after new information (e.g. the lead booked). Keeps a history row and never un-disqualifies. */
export async function rescoreLead(deps: Deps, workspaceId: string, leadId: string, extra: { hasBookedCall?: boolean; engagementEvents?: number } = {}): Promise<Lead> {
  const lead = await deps.repo.get("leads", workspaceId, leadId);
  if (!lead) throw new NotFoundError("Lead not found");
  const ws = await deps.repo.getWorkspace(workspaceId);
  if (!ws) throw new NotFoundError("Workspace not found");
  const result = scoreLead(
    { industry: lead.industry, city: lead.city, state: lead.state, monthlyRevenue: lead.monthlyRevenue, budgetRange: lead.budgetRange, timeline: lead.timeline, readyToInvest: lead.readyToInvest, primaryProblem: lead.primaryProblem, businessName: lead.businessName, website: lead.website, hasBookedCall: extra.hasBookedCall ?? Boolean(lead.bookedAt), engagementEvents: extra.engagementEvents },
    scoringConfigFor(ws),
  );
  await deps.repo.insert("leadScores", workspaceId, { leadId, score: result.score, tier: result.tier, factors: result.factors, createdAt: deps.now().toISOString() });
  const patch: Partial<Lead> = { score: result.score, tier: result.tier, disqualifiedReason: result.disqualifiedReason };
  if (isQualified(result.tier) && !lead.qualifiedAt) patch.qualifiedAt = deps.now().toISOString();
  return deps.repo.update("leads", workspaceId, leadId, patch);
}

/** Mark the outcome of a sales call: SHOWED, NO_SHOW, RESCHEDULED, LOST (CLOSED goes through closeDeal). */
export async function markCallOutcome(deps: Deps, workspaceId: string, appointmentId: string, outcome: Exclude<CallOutcome, "CLOSED">, actor: Actor): Promise<Lead> {
  const appt = await deps.repo.get("appointments", workspaceId, appointmentId);
  if (!appt) throw new NotFoundError("Appointment not found");
  const lead = await deps.repo.get("leads", workspaceId, appt.leadId);
  if (!lead) throw new NotFoundError("Lead not found");

  const result = applyCallOutcome(lead.stage, outcome);
  await deps.repo.update("appointments", workspaceId, appointmentId, { status: result.appointmentStatus });
  await audit(deps, workspaceId, actor, { action: `call_${outcome.toLowerCase()}`, entityType: "appointments", entityId: appointmentId, campaignId: lead.campaignId, before: { status: appt.status }, after: { status: result.appointmentStatus } });
  return moveLead(deps, workspaceId, lead.id, result.stage, actor, { note: `Call outcome: ${outcome}`, lostReason: outcome === "LOST" ? "Lost after call" : undefined });
}
