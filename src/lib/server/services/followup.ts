import { emailFooter, escapeHtml } from "@/lib/core/compliance";
import { DEFAULT_SEQUENCE, renderTemplate, scheduleSequence, stopReason, isOptOutMessage, type SequenceStep } from "@/lib/core/followup";
import { tzOffsetMinutes } from "@/lib/core/booking";
import type { AutomationRule, Lead, Workspace } from "../entities";
import { UniqueViolation } from "../repo";
import { audit, logEvent, NotFoundError, type Deps } from "./common";

export type Trigger = AutomationRule["trigger"];

export async function ensureDefaultRules(deps: Deps, ws: Workspace): Promise<AutomationRule[]> {
  const rules = await deps.repo.list("automationRules", ws.id);
  if (rules.some((r) => r.trigger === "lead_created")) return rules;
  const created = await deps.repo.insert("automationRules", ws.id, {
    name: "New lead follow-up",
    trigger: "lead_created",
    enabled: true,
    config: { steps: DEFAULT_SEQUENCE.map((s) => ({ ...s })) },
  });
  return [...rules, created];
}

/** Schedule every step of every enabled rule for this trigger. Idempotent: (rule, lead, step) is unique. */
export async function enrollInSequences(deps: Deps, ws: Workspace, lead: Lead, trigger: Trigger): Promise<number> {
  const rules = (await ensureDefaultRules(deps, ws)).filter((r) => r.enabled && r.trigger === trigger);
  const offset = tzOffsetMinutes(ws.timezone, deps.now());
  let scheduled = 0;
  for (const rule of rules) {
    const steps = rule.config.steps as SequenceStep[];
    for (const s of scheduleSequence(steps, deps.now(), offset)) {
      try {
        await deps.repo.insert("automationRuns", ws.id, {
          ruleId: rule.id,
          leadId: lead.id,
          stepId: s.stepId,
          status: "scheduled",
          scheduledFor: s.sendAt.toISOString(),
          createdAt: deps.now().toISOString(),
        });
        scheduled++;
      } catch (e) {
        if (!(e instanceof UniqueViolation)) throw e;
      }
    }
  }
  if (scheduled > 0) await logEvent(deps, ws.id, lead.id, "followup_enrolled", { trigger, steps: scheduled });
  return scheduled;
}

/** Stop pending automation for a lead (booked, replied, opted out, won/lost). */
export async function cancelPendingRuns(deps: Deps, workspaceId: string, leadId: string, reason: string): Promise<number> {
  const runs = await deps.repo.list("automationRuns", workspaceId, { where: { leadId, status: "scheduled" } });
  for (const r of runs) {
    await deps.repo.update("automationRuns", workspaceId, r.id, { status: "cancelled", skipReason: reason, executedAt: deps.now().toISOString() });
  }
  return runs.length;
}

function unsubscribeUrl(deps: Deps, ws: Workspace, lead: Lead): string {
  return `${deps.appUrl}/api/unsubscribe/${ws.slug}/${lead.unsubscribeToken}`;
}

function bookingUrl(deps: Deps, ws: Workspace, lead: Lead): string {
  return ws.bookingUrl || `${deps.appUrl}/book/${ws.slug}/${lead.unsubscribeToken}`;
}

export interface SendResult {
  status: "sent" | "skipped" | "failed";
  reason?: string;
}

/**
 * Send one email to a lead through the shared compliance path: opt-out respected (unless transactional),
 * physical address footer + unsubscribe link, communication logged, never throws.
 */
export async function sendEmailToLead(
  deps: Deps,
  ws: Workspace,
  lead: Lead,
  msg: { stepId: string; subject: string; body: string; transactional?: boolean },
): Promise<SendResult> {
  const nowIso = deps.now().toISOString();
  const skip = async (reason: string): Promise<SendResult> => {
    await deps.repo.insert("communications", ws.id, { leadId: lead.id, channel: "email", direction: "outbound", stepId: msg.stepId, subject: msg.subject, status: "skipped", skipReason: reason, createdAt: nowIso });
    return { status: "skipped", reason };
  };
  if (!lead.email) return skip("no_email");
  if (lead.optedOutEmail && !msg.transactional) return skip("opted_out");
  if (!ws.postalAddress?.trim()) return skip("missing_postal_address");

  const sender = ws.senderEmail;
  if (!sender) return skip("missing_sender_email");

  // Idempotency: never send the same step twice to the same lead.
  const prior = await deps.repo.list("communications", ws.id, { where: { leadId: lead.id, stepId: msg.stepId, status: "sent" }, limit: 1 });
  if (prior.length > 0) return { status: "skipped", reason: "already_sent" };

  const vars = { firstName: lead.firstName, businessName: lead.businessName ?? "your business", bookingUrl: bookingUrl(deps, ws, lead), senderName: ws.senderName ?? ws.name };
  const subject = renderTemplate(msg.subject, vars);
  const body = renderTemplate(msg.body, vars);
  const unsub = unsubscribeUrl(deps, ws, lead);
  const footer = emailFooter({ businessName: ws.name, postalAddress: ws.postalAddress, unsubscribeUrl: unsub });
  const html = `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5">${escapeHtml(body).replace(/\n/g, "<br/>")}</div>${footer.html}`;

  try {
    const { id } = await deps.mailer.send({ to: lead.email, from: `${ws.senderName ?? ws.name} <${sender}>`, subject, text: body + footer.text, html, unsubscribeUrl: unsub, replyTo: sender });
    await deps.repo.insert("communications", ws.id, { leadId: lead.id, channel: "email", direction: "outbound", stepId: msg.stepId, subject, body, status: "sent", providerMessageId: id, sentAt: nowIso, createdAt: nowIso });
    return { status: "sent" };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await deps.repo.insert("communications", ws.id, { leadId: lead.id, channel: "email", direction: "outbound", stepId: msg.stepId, subject, status: "failed", error, createdAt: nowIso });
    return { status: "failed", reason: error };
  }
}

export interface RunSummary {
  processed: number;
  sent: number;
  skipped: number;
  failed: number;
}

/** Process due automation runs for one workspace. Safe to call repeatedly (cron). */
export async function runDueAutomations(deps: Deps, ws: Workspace, limit = 100): Promise<RunSummary> {
  const nowIso = deps.now().toISOString();
  const due = await deps.repo.list("automationRuns", ws.id, { where: { status: "scheduled" }, range: { field: "scheduledFor", to: nowIso }, orderBy: { field: "scheduledFor" }, limit });
  const summary: RunSummary = { processed: 0, sent: 0, skipped: 0, failed: 0 };
  const rules = new Map((await deps.repo.list("automationRules", ws.id)).map((r) => [r.id, r]));

  for (const run of due) {
    summary.processed++;
    const finish = async (status: "sent" | "skipped" | "failed", detail?: string) => {
      await deps.repo.update("automationRuns", ws.id, run.id, { status, executedAt: deps.now().toISOString(), skipReason: status === "skipped" ? detail : undefined, error: status === "failed" ? detail : undefined });
      summary[status]++;
      await audit(deps, ws.id, { type: "automation" }, { action: `automation_${status}`, entityType: "automation_runs", entityId: run.id, after: { leadId: run.leadId, stepId: run.stepId, detail } });
    };

    const rule = rules.get(run.ruleId);
    const lead = await deps.repo.get("leads", ws.id, run.leadId);
    const step = rule?.config.steps.find((s) => s.id === run.stepId);
    if (!rule || !rule.enabled || !lead || !step) {
      await finish("skipped", !rule?.enabled ? "rule_disabled" : "missing_data");
      continue;
    }

    const inbound = await deps.repo.list("communications", ws.id, { where: { leadId: lead.id, direction: "inbound" }, limit: 1 });
    const stop = stopReason(
      { id: lead.id, email: lead.email, phone: lead.phone, optedOutEmail: lead.optedOutEmail, optedOutSms: lead.optedOutSms, smsConsent: Boolean(lead.smsConsentAt), stage: lead.stage, hasBooked: Boolean(lead.bookedAt), replied: inbound.length > 0, createdAt: new Date(lead.createdAt) },
      step,
      lead.tier,
    );
    if (stop) {
      await finish("skipped", stop);
      continue;
    }
    if (step.channel === "sms") {
      // SMS delivery is deliberately not wired up: it requires a registered A2P 10DLC campaign and carrier opt-in records.
      await finish("skipped", "sms_not_configured");
      continue;
    }

    const res = await sendEmailToLead(deps, ws, lead, { stepId: step.id, subject: step.subject ?? "", body: step.body });
    await finish(res.status, res.reason);
  }
  return summary;
}

/** One-click unsubscribe. Marks the lead, cancels pending sends, audits. */
export async function unsubscribeByToken(deps: Deps, workspaceSlug: string, token: string): Promise<{ ok: true }> {
  const ws = await deps.repo.getWorkspaceBySlug(workspaceSlug);
  if (!ws) throw new NotFoundError();
  const [lead] = await deps.repo.list("leads", ws.id, { where: { unsubscribeToken: token }, limit: 1 });
  if (!lead) throw new NotFoundError();
  if (!lead.optedOutEmail) {
    await deps.repo.update("leads", ws.id, lead.id, { optedOutEmail: true, lastActivityAt: deps.now().toISOString() });
    await cancelPendingRuns(deps, ws.id, lead.id, "opted_out");
    await logEvent(deps, ws.id, lead.id, "unsubscribed", { channel: "email" });
    await audit(deps, ws.id, { type: "public" }, { action: "opt_out", entityType: "leads", entityId: lead.id, before: { optedOutEmail: false }, after: { optedOutEmail: true } });
  }
  return { ok: true };
}

/** Inbound message (reply or SMS keyword). STOP-style keywords opt the lead out of that channel immediately. */
export async function applyInboundMessage(deps: Deps, workspaceId: string, leadId: string, channel: "email" | "sms", body: string): Promise<{ optedOut: boolean }> {
  const lead = await deps.repo.get("leads", workspaceId, leadId);
  if (!lead) throw new NotFoundError();
  const nowIso = deps.now().toISOString();
  await deps.repo.insert("communications", workspaceId, { leadId, channel, direction: "inbound", body, status: "received", createdAt: nowIso });
  await cancelPendingRuns(deps, workspaceId, leadId, "replied");
  const optOut = isOptOutMessage(body);
  if (optOut) {
    await deps.repo.update("leads", workspaceId, leadId, channel === "sms" ? { optedOutSms: true } : { optedOutEmail: true });
    await audit(deps, workspaceId, { type: "public" }, { action: "opt_out", entityType: "leads", entityId: leadId, after: { channel } });
  }
  await deps.repo.update("leads", workspaceId, leadId, { lastActivityAt: nowIso });
  return { optedOut: optOut };
}
