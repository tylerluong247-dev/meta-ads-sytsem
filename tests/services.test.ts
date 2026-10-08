import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { PIPELINE_STAGES } from "@/lib/core/types";
import { InvalidTransitionError } from "@/lib/core/pipeline";
import { decryptToken, encryptToken, verifyCalSignature, verifyMetaSignature, appSecretProof } from "@/lib/server/crypto";
import { MemorySecretStore } from "@/lib/server/secrets";
import { UniqueViolation } from "@/lib/server/repo";
import { DEMO_USER_ID } from "@/lib/server/seed";
import { ACTIONS, matchAction } from "@/lib/server/api/app-actions";
import { NotFoundError, PermissionError, requireRole, ValidationError } from "@/lib/server/services/common";
import { bookAppointment, cancelAppointment, getAvailability } from "@/lib/server/services/booking";
import { closeDeal } from "@/lib/server/services/deals";
import { applyInboundMessage, enrollInSequences, ensureDefaultRules, runDueAutomations, sendEmailToLead, unsubscribeByToken } from "@/lib/server/services/followup";
import { createLead, recordFirstResponse } from "@/lib/server/services/leads";
import { classifyMetaError, MetaApiError, MetaClient, syncMeta } from "@/lib/server/services/meta";
import { markCallOutcome, moveLead } from "@/lib/server/services/pipeline";
import { handleCalendarWebhook, handleMetaLeadgen, retryFailedMetaLeads } from "@/lib/server/services/webhooks";
import { blankWorkspace, makeDeps, NOW, seededDeps, validLead } from "./helpers";

const actor = { type: "user" as const, id: DEMO_USER_ID };

async function setup(partial = {}) {
  const deps = makeDeps();
  const ws = blankWorkspace(deps, partial);
  return { deps, ws };
}
async function leadAt(deps: ReturnType<typeof makeDeps>, ws: { slug: string; id: string }, over: Record<string, unknown> = {}) {
  const r = await createLead(deps, validLead(ws.slug, over), { landingUrl: "https://x.test/roofing?utm_source=meta&utm_campaign=storm" });
  return (await deps.repo.get("leads", ws.id, r.leadId!))!;
}

describe("lead capture", () => {
  it("creates, scores, attributes and enrolls a valid lead", async () => {
    const { deps, ws } = await setup();
    const r = await createLead(deps, validLead(ws.slug), { landingUrl: "https://x.test/roofing?utm_source=meta&utm_medium=paid&utm_campaign=storm", consentText: "I agree" });
    expect(r.leadId).toBeTruthy();
    expect(r.duplicate).toBe(false);
    expect(r.token).toBeTruthy();
    const lead = (await deps.repo.get("leads", ws.id, r.leadId!))!;
    expect(lead.email).toBe("jamie@rivera-roofing.example");
    expect(lead.tier).toBe("HOT");
    expect(lead.stage).toBe("QUALIFIED");
    expect(lead.qualifiedAt).toBeTruthy();
    expect(lead.contactConsentAt).toBeTruthy();
    expect(lead.attribution.first.utm_campaign).toBe("storm");
    expect((await deps.repo.list("leadScores", ws.id)).length).toBe(1);
    expect((await deps.repo.list("auditLogs", ws.id)).some((a) => a.action === "lead_created")).toBe(true);
    expect((await deps.repo.list("automationRuns", ws.id)).length).toBeGreaterThan(0);
  });

  it("does not create a second lead for the same email+phone, and keeps first touch", async () => {
    const { deps, ws } = await setup();
    const a = await createLead(deps, validLead(ws.slug), { landingUrl: "https://x.test/r?utm_campaign=one" });
    const b = await createLead(deps, validLead(ws.slug, { email: "JAMIE@rivera-roofing.example" }), { landingUrl: "https://x.test/r?utm_campaign=two" });
    expect(b.duplicate).toBe(true);
    expect(b.leadId).toBe(a.leadId);
    expect(await deps.repo.list("leads", ws.id)).toHaveLength(1);
    const lead = (await deps.repo.get("leads", ws.id, a.leadId!))!;
    expect(lead.attribution.first.utm_campaign).toBe("one");
    expect(lead.attribution.last.utm_campaign).toBe("two");
  });

  it("rejects invalid data with per-field messages and writes nothing", async () => {
    const { deps, ws } = await setup();
    await expect(createLead(deps, validLead(ws.slug, { email: "bad", contactConsent: false }))).rejects.toMatchObject({ name: "ValidationError", fields: expect.objectContaining({ email: expect.any(String), contactConsent: expect.any(String) }) });
    expect(await deps.repo.list("leads", ws.id)).toHaveLength(0);
  });

  it("silently drops honeypot submissions without storing them", async () => {
    const { deps, ws } = await setup();
    const r = await createLead(deps, validLead(ws.slug, { company_website_url: "http://spam.example" }));
    expect(r.leadId).toBeNull();
    expect(await deps.repo.list("leads", ws.id)).toHaveLength(0);
  });

  it("rejects unknown workspaces", async () => {
    const { deps } = await setup();
    await expect(createLead(deps, validLead("nope"))).rejects.toBeInstanceOf(NotFoundError);
  });

  it("disqualifies not-ready leads, sends them to LOST and never enrolls them in follow-up", async () => {
    const { deps, ws } = await setup();
    const lead = await leadAt(deps, ws, { readyToInvest: false });
    expect(lead.tier).toBe("DISQUALIFIED");
    expect(lead.stage).toBe("LOST");
    expect(lead.disqualifiedReason).toBeTruthy();
    expect(await deps.repo.list("automationRuns", ws.id, { where: { leadId: lead.id } })).toHaveLength(0);
  });

  it("applies per-workspace scoring config", async () => {
    const { deps, ws } = await setup({ scoringConfig: { serviceAreas: ["FL"] } });
    const out = await leadAt(deps, ws, { state: "AK", city: "Anchorage" });
    expect(out.tier).toBe("DISQUALIFIED");
  });

  it("links Meta ids to internal campaign/ad/creative rows", async () => {
    const { deps, ws } = await setup();
    const campaign = await deps.repo.insert("campaigns", ws.id, { name: "C", status: "active", metaCampaignId: "1111111111" });
    const creative = await deps.repo.insert("creatives", ws.id, { name: "Cr", status: "TESTING" });
    await deps.repo.insert("ads", ws.id, { name: "Ad", status: "active", campaignId: campaign.id, creativeId: creative.id, metaAdId: "2222222222" });
    const r = await createLead(deps, validLead(ws.slug), { landingUrl: "https://x.test/r?utm_source=meta&meta_ad_id=2222222222&meta_campaign_id=1111111111" });
    const lead = (await deps.repo.get("leads", ws.id, r.leadId!))!;
    expect(lead.campaignId).toBe(campaign.id);
    expect(lead.creativeId).toBe(creative.id);
  });

  it("speed to lead counts the first human response, not auto-replies", async () => {
    const { deps, ws } = await setup();
    const lead = await leadAt(deps, ws);
    expect(lead.firstResponseAt).toBeUndefined();
    deps.clock.now = new Date(NOW.getTime() + 4 * 60000);
    const after = await recordFirstResponse(deps, ws.id, lead.id, DEMO_USER_ID, "call");
    expect(after.firstResponseAt).toBe(deps.clock.now.toISOString());
    deps.clock.now = new Date(NOW.getTime() + 60 * 60000);
    const again = await recordFirstResponse(deps, ws.id, lead.id, DEMO_USER_ID, "email");
    expect(again.firstResponseAt).toBe(after.firstResponseAt);
  });
});

describe("tenant isolation and permissions", () => {
  it("never returns, updates or deletes another workspace's rows", async () => {
    const { deps, roofing, hvac } = await seededDeps();
    const [lead] = await deps.repo.list("leads", roofing.id, { limit: 1 });
    expect(await deps.repo.get("leads", hvac.id, lead!.id)).toBeNull();
    const hvacLeadIds = new Set((await deps.repo.list("leads", hvac.id)).map((l) => l.id));
    expect((await deps.repo.list("leads", roofing.id)).some((l) => hvacLeadIds.has(l.id))).toBe(false);
    await expect(deps.repo.update("leads", hvac.id, lead!.id, { firstName: "Hacked" })).rejects.toThrow();
    await deps.repo.remove("leads", hvac.id, lead!.id).catch(() => undefined);
    expect((await deps.repo.get("leads", roofing.id, lead!.id))?.firstName).not.toBe("Hacked");
    expect(await deps.repo.get("leads", roofing.id, lead!.id)).not.toBeNull();
  });

  it("services refuse cross-workspace ids", async () => {
    const { deps, roofing, hvac } = await seededDeps();
    const [lead] = await deps.repo.list("leads", roofing.id, { where: { stage: "QUALIFIED" }, limit: 1 });
    await expect(moveLead(deps, hvac.id, lead!.id, "BOOKED", actor)).rejects.toBeInstanceOf(NotFoundError);
    await expect(closeDeal(deps, hvac.id, lead!.id, { initialPayment: 1000 }, actor)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("requireRole enforces membership and role rank", async () => {
    const { deps, ws } = await setup();
    deps.repo.addMember(ws.id, "viewer-1", "viewer");
    deps.repo.addMember(ws.id, "member-1", "member");
    deps.repo.addMember(ws.id, "admin-1", "admin");
    await expect(requireRole(deps.repo, ws.id, undefined, "viewer")).rejects.toThrow(/Sign in/);
    await expect(requireRole(deps.repo, ws.id, "stranger", "viewer")).rejects.toBeInstanceOf(PermissionError);
    await expect(requireRole(deps.repo, ws.id, "viewer-1", "member")).rejects.toBeInstanceOf(PermissionError);
    await expect(requireRole(deps.repo, ws.id, "member-1", "admin")).rejects.toBeInstanceOf(PermissionError);
    expect(await requireRole(deps.repo, ws.id, "admin-1", "member")).toBe("admin");
    expect(await requireRole(deps.repo, ws.id, DEMO_USER_ID, "owner")).toBe("owner");
  });

  it("a member of one workspace has no role in another", async () => {
    const { deps, roofing, hvac } = await seededDeps();
    deps.repo.addMember(roofing.id, "agent-7", "member");
    expect(await deps.repo.getMemberRole(hvac.id, "agent-7")).toBeNull();
    expect((await deps.repo.listWorkspacesForUser("agent-7")).map((x) => x.workspace.id)).toEqual([roofing.id]);
  });

  it("every dashboard action has an explicit role; money, integrations and settings need admin", () => {
    const need = (pattern: string) => ACTIONS.find((a) => a.pattern === pattern)!.minRole;
    for (const p of ["settings", "automations/:id", "meta/connect", "meta/sync", "meta/campaign", "meta/status", "meta/budget", "landing-pages/:slug"]) expect(need(p)).toBe("admin");
    for (const p of ["leads/:id/move", "leads/:id/close", "creatives/:id/status", "experiments"]) expect(need(p)).toBe("member");
    expect(need("analyst")).toBe("viewer");
    expect(matchAction("POST", ["leads", "abc", "move"])?.params.id).toBe("abc");
    expect(matchAction("POST", ["nope"])).toBeNull();
    expect(matchAction("GET", ["settings"])).toBeNull();
  });
});

describe("pipeline", () => {
  it("rejects illegal transitions and records legal ones with timestamps, events and audit", async () => {
    const { deps, ws } = await setup();
    const lead = await leadAt(deps, ws, { readyToInvest: true, budgetRange: "1k_3k", timeline: "exploring", monthlyRevenue: "10k_30k", primaryProblem: undefined, industry: "Other" });
    await expect(moveLead(deps, ws.id, lead.id, "SHOWED", actor)).rejects.toBeInstanceOf(InvalidTransitionError);
    const moved = await moveLead(deps, ws.id, lead.id, "BOOKED", actor);
    expect(moved.stage).toBe("BOOKED");
    expect(moved.bookedAt).toBeTruthy();
    expect(moved.qualifiedAt).toBeTruthy();
    expect((await deps.repo.list("pipelineEvents", ws.id, { where: { leadId: lead.id } })).at(-1)).toMatchObject({ toStage: "BOOKED" });
    expect((await deps.repo.list("auditLogs", ws.id)).some((a) => a.action === "stage_changed")).toBe(true);
  });

  it("cannot be marked WON without recording the deal", async () => {
    const { deps, ws } = await setup();
    const lead = await leadAt(deps, ws);
    await moveLead(deps, ws.id, lead.id, "BOOKED", actor);
    await moveLead(deps, ws.id, lead.id, "SHOWED", actor);
    await expect(moveLead(deps, ws.id, lead.id, "WON", actor)).rejects.toBeInstanceOf(ValidationError);
  });

  it("no-show returns the lead to QUALIFIED and does not count as a show", async () => {
    const { deps, ws } = await setup();
    const lead = await leadAt(deps, ws);
    const slot = (await getAvailability(deps, ws, 14))[0]!;
    const appt = await bookAppointment(deps, ws.slug, lead.unsubscribeToken, slot.startUtc, "America/New_York");
    const after = await markCallOutcome(deps, ws.id, appt.id, "NO_SHOW", actor);
    expect(after.stage).toBe("QUALIFIED");
    expect(after.showedAt).toBeUndefined();
    expect((await deps.repo.get("appointments", ws.id, appt.id))?.status).toBe("NO_SHOW");
  });
});

describe("closing deals and revenue attribution", () => {
  it("records customer, deal, revenue rows and freezes attribution; WON is terminal", async () => {
    const { deps, ws } = await setup();
    const campaign = await deps.repo.insert("campaigns", ws.id, { name: "C", status: "active", metaCampaignId: "1111111111" });
    const r = await createLead(deps, validLead(ws.slug), { landingUrl: "https://x.test/r?utm_source=meta&meta_campaign_id=1111111111" });
    const id = r.leadId!;
    await moveLead(deps, ws.id, id, "BOOKED", actor);
    await moveLead(deps, ws.id, id, "SHOWED", actor);
    const { deal, lead } = await closeDeal(deps, ws.id, id, { initialPayment: 1000, recurringPayment: 500, recurringMonths: 3, oneTimeFees: 200 }, actor);
    expect(deal.contractValue).toBe(2700);
    expect(deal.campaignId).toBe(campaign.id);
    expect(lead.stage).toBe("WON");
    expect(lead.wonAt).toBeTruthy();
    expect(await deps.repo.list("customers", ws.id)).toHaveLength(1);
    const revenue = await deps.repo.list("revenue", ws.id);
    // Cash rows cover what is due at close (initial + one-time); recurring months are recorded as collected.
    expect(revenue.reduce((s, x) => s + x.amount, 0)).toBe(1200);
    await expect(closeDeal(deps, ws.id, id, { initialPayment: 1000 }, actor)).rejects.toThrow();
    expect(await deps.repo.list("deals", ws.id)).toHaveLength(1);
  });

  it("rejects zero/negative values and leads that have not reached a sales call", async () => {
    const { deps, ws } = await setup();
    const lead = await leadAt(deps, ws);
    await expect(closeDeal(deps, ws.id, lead.id, { initialPayment: 0 }, actor)).rejects.toBeInstanceOf(ValidationError);
    await expect(closeDeal(deps, ws.id, lead.id, { initialPayment: -5 }, actor)).rejects.toThrow();
    await expect(closeDeal(deps, ws.id, lead.id, { initialPayment: 1000 }, actor)).rejects.toBeInstanceOf(InvalidTransitionError);
    expect(await deps.repo.list("deals", ws.id)).toHaveLength(0);
  });
});

describe("booking", () => {
  it("books a call, moves the lead to BOOKED, emails a confirmation and cancels pending nurture", async () => {
    const { deps, ws } = await setup();
    const lead = await leadAt(deps, ws);
    const slot = (await getAvailability(deps, ws, 14))[0]!;
    const appt = await bookAppointment(deps, ws.slug, lead.unsubscribeToken, slot.startUtc, "America/Chicago");
    expect(appt.status).toBe("SCHEDULED");
    const fresh = (await deps.repo.get("leads", ws.id, lead.id))!;
    expect(fresh.stage).toBe("BOOKED");
    expect(fresh.bookedAt).toBeTruthy();
    expect(deps.mailer.sent.some((m) => m.subject.includes("You're booked"))).toBe(true);
    const nurtureLeft = (await deps.repo.list("automationRuns", ws.id, { where: { leadId: lead.id, status: "scheduled" } })).filter((r) => r.stepId.startsWith("followup"));
    expect(nurtureLeft).toHaveLength(0);
    expect((await getAvailability(deps, ws, 14)).some((s) => s.startUtc === slot.startUtc)).toBe(false);
  });

  it("prevents double-booking the same slot", async () => {
    const { deps, ws } = await setup();
    const a = await leadAt(deps, ws);
    const b = await leadAt(deps, ws, { email: "other@example.com", phone: "(813) 555-0199" });
    const slot = (await getAvailability(deps, ws, 14))[0]!;
    await bookAppointment(deps, ws.slug, a.unsubscribeToken, slot.startUtc);
    await expect(bookAppointment(deps, ws.slug, b.unsubscribeToken, slot.startUtc)).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects times outside availability and bad tokens", async () => {
    const { deps, ws } = await setup();
    const lead = await leadAt(deps, ws);
    await expect(bookAppointment(deps, ws.slug, lead.unsubscribeToken, "2026-10-10T03:00:00Z")).rejects.toBeInstanceOf(ValidationError);
    await expect(bookAppointment(deps, ws.slug, "wrong-token", (await getAvailability(deps, ws, 7))[0]!.startUtc)).rejects.toBeInstanceOf(NotFoundError);
    const other = await setup({ slug: "other-co", id: crypto.randomUUID() });
    await expect(bookAppointment(other.deps, "test-co", lead.unsubscribeToken, "2026-10-12T14:00:00Z")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("reschedules by replacing the old appointment and frees its slot", async () => {
    const { deps, ws } = await setup();
    const lead = await leadAt(deps, ws);
    const slots = await getAvailability(deps, ws, 14);
    const first = await bookAppointment(deps, ws.slug, lead.unsubscribeToken, slots[0]!.startUtc);
    const second = await bookAppointment(deps, ws.slug, lead.unsubscribeToken, slots[3]!.startUtc);
    expect((await deps.repo.get("appointments", ws.id, first.id))?.status).toBe("RESCHEDULED");
    expect(second.status).toBe("SCHEDULED");
    expect((await getAvailability(deps, ws, 14)).some((s) => s.startUtc === slots[0]!.startUtc)).toBe(true);
    expect((await deps.repo.get("leads", ws.id, lead.id))?.stage).toBe("BOOKED");
  });

  it("cancels and returns the lead to QUALIFIED", async () => {
    const { deps, ws } = await setup();
    const lead = await leadAt(deps, ws);
    const appt = await bookAppointment(deps, ws.slug, lead.unsubscribeToken, (await getAvailability(deps, ws, 14))[0]!.startUtc);
    await cancelAppointment(deps, ws.slug, lead.unsubscribeToken);
    expect((await deps.repo.get("appointments", ws.id, appt.id))?.status).toBe("CANCELLED");
    expect((await deps.repo.get("leads", ws.id, lead.id))?.stage).toBe("QUALIFIED");
  });

  it("the database-level unique constraint also rejects a duplicate active slot", async () => {
    const { deps, ws } = await setup();
    const l = await leadAt(deps, ws);
    const row = { leadId: l.id, provider: "internal", startAt: "2026-10-12T14:00:00.000Z", endAt: "2026-10-12T14:30:00.000Z", timezone: "UTC", status: "SCHEDULED" as const };
    await deps.repo.insert("appointments", ws.id, row);
    await expect(deps.repo.insert("appointments", ws.id, row)).rejects.toBeInstanceOf(UniqueViolation);
  });
});

describe("compliant follow-up", () => {
  it("holds email until a postal address exists", async () => {
    const { deps, ws } = await setup({ postalAddress: "" });
    const lead = await leadAt(deps, ws);
    const res = await sendEmailToLead(deps, ws, lead, { stepId: "x", subject: "Hi", body: "Hello" });
    expect(res).toEqual({ status: "skipped", reason: "missing_postal_address" });
    expect(deps.mailer.sent).toHaveLength(0);
  });

  it("every marketing email carries the address and a working unsubscribe link, and is never sent twice", async () => {
    const { deps, ws } = await setup();
    const lead = await leadAt(deps, ws);
    deps.mailer.sent.length = 0;
    expect((await sendEmailToLead(deps, ws, lead, { stepId: "s1", subject: "Hi {{firstName}}", body: "Hello {{firstName}}" })).status).toBe("sent");
    const mail = deps.mailer.sent[0]!;
    expect(mail.subject).toBe("Hi Jamie");
    expect(mail.text).toContain(ws.postalAddress!);
    expect(mail.text).toContain(`/api/unsubscribe/${ws.slug}/${lead.unsubscribeToken}`);
    expect(mail.unsubscribeUrl).toContain(lead.unsubscribeToken);
    expect(await sendEmailToLead(deps, ws, lead, { stepId: "s1", subject: "Hi", body: "Hello" })).toEqual({ status: "skipped", reason: "already_sent" });
  });

  it("unsubscribe is one click, cancels pending sends, and later runs are skipped", async () => {
    const { deps, ws } = await setup();
    const lead = await leadAt(deps, ws, { budgetRange: "1k_3k", timeline: "exploring" });
    expect((await deps.repo.list("automationRuns", ws.id, { where: { leadId: lead.id, status: "scheduled" } })).length).toBeGreaterThan(0);
    await unsubscribeByToken(deps, ws.slug, lead.unsubscribeToken);
    expect((await deps.repo.get("leads", ws.id, lead.id))?.optedOutEmail).toBe(true);
    expect(await deps.repo.list("automationRuns", ws.id, { where: { leadId: lead.id, status: "scheduled" } })).toHaveLength(0);
    deps.clock.now = new Date(NOW.getTime() + 30 * 86400000);
    deps.mailer.sent.length = 0;
    await runDueAutomations(deps, ws);
    expect(deps.mailer.sent).toHaveLength(0);
    expect((await sendEmailToLead(deps, ws, (await deps.repo.get("leads", ws.id, lead.id))!, { stepId: "n", subject: "s", body: "b" })).reason).toBe("opted_out");
    await expect(unsubscribeByToken(deps, ws.slug, "bogus")).rejects.toBeInstanceOf(NotFoundError);
    await unsubscribeByToken(deps, ws.slug, lead.unsubscribeToken); // idempotent
  });

  it("a STOP reply opts out; a normal reply stops the sequence without opting out", async () => {
    const { deps, ws } = await setup();
    const a = await leadAt(deps, ws);
    const b = await leadAt(deps, ws, { email: "b@example.com", phone: "(813) 555-0188" });
    expect(await applyInboundMessage(deps, ws.id, a.id, "email", "STOP")).toEqual({ optedOut: true });
    expect((await deps.repo.get("leads", ws.id, a.id))?.optedOutEmail).toBe(true);
    expect(await applyInboundMessage(deps, ws.id, b.id, "email", "Tuesday works for me")).toEqual({ optedOut: false });
    expect((await deps.repo.get("leads", ws.id, b.id))?.optedOutEmail).toBe(false);
    expect(await deps.repo.list("automationRuns", ws.id, { where: { leadId: b.id, status: "scheduled" } })).toHaveLength(0);
  });

  it("runs due steps on schedule, skips SMS (not configured) and stops once the lead has booked", async () => {
    const { deps, ws } = await setup();
    const lead = await leadAt(deps, ws);
    deps.clock.now = new Date(NOW.getTime() + 60000);
    deps.mailer.sent.length = 0;
    const early = await runDueAutomations(deps, ws);
    expect(early.sent).toBe(1); // the instant step goes out; later steps are not due yet
    expect(deps.mailer.sent).toHaveLength(1);
    await bookAppointment(deps, ws.slug, lead.unsubscribeToken, (await getAvailability(deps, ws, 14))[0]!.startUtc);
    deps.clock.now = new Date(NOW.getTime() + 20 * 86400000);
    deps.mailer.sent.length = 0;
    await runDueAutomations(deps, ws);
    expect(deps.mailer.sent.filter((m) => /nurture|follow/i.test(m.subject))).toHaveLength(0);
    const rules = await ensureDefaultRules(deps, ws);
    expect(rules.length).toBeGreaterThan(0);
    const again = await enrollInSequences(deps, ws, lead, "lead_created");
    expect(await deps.repo.list("automationRuns", ws.id, { where: { leadId: lead.id, stepId: "instant" } })).toHaveLength(1); // re-enrolling never duplicates a step
    expect(again).toBe(0);
  });

  it("does not text anyone: SMS steps are skipped with a clear reason", async () => {
    const { deps, ws } = await setup();
    const lead = await leadAt(deps, ws);
    const [rule] = await ensureDefaultRules(deps, ws);
    await deps.repo.update("automationRules", ws.id, rule!.id, { config: { steps: [{ id: "sms1", delayMinutes: 0, channel: "sms", body: "Hi" }] } });
    await deps.repo.insert("automationRuns", ws.id, { ruleId: rule!.id, leadId: lead.id, stepId: "sms1", status: "scheduled", scheduledFor: new Date(NOW.getTime() - 60000).toISOString() });
    await runDueAutomations(deps, ws);
    const run = (await deps.repo.list("automationRuns", ws.id, { where: { stepId: "sms1" } }))[0]!;
    expect(run.status).toBe("skipped");
    expect(["sms_not_configured", "NO_CONSENT"]).toContain(run.skipReason);
  });
});

describe("crypto and webhook signatures", () => {
  it("encrypts tokens with AES-GCM; wrong key or tampering fails; ciphertext differs each time", () => {
    const key = "ab".repeat(32);
    const enc = encryptToken("EAAB-secret-token", key);
    expect(enc).not.toContain("secret");
    expect(decryptToken(enc, key)).toBe("EAAB-secret-token");
    expect(encryptToken("EAAB-secret-token", key)).not.toBe(enc);
    expect(() => decryptToken(enc, "cd".repeat(32))).toThrow();
    const tampered = Buffer.from(enc, "base64");
    tampered[tampered.length - 1] = tampered[tampered.length - 1]! ^ 1;
    expect(() => decryptToken(tampered.toString("base64"), key)).toThrow();
    expect(() => encryptToken("x", "short")).toThrow(/64 hex/);
  });

  it("verifies Meta and Cal.com signatures over the raw body", () => {
    const body = '{"entry":[]}';
    const good = `sha256=${createHmac("sha256", "appsecret").update(body).digest("hex")}`;
    expect(verifyMetaSignature(body, good, "appsecret")).toBe(true);
    expect(verifyMetaSignature(body + " ", good, "appsecret")).toBe(false);
    expect(verifyMetaSignature(body, good, "other")).toBe(false);
    expect(verifyMetaSignature(body, null, "appsecret")).toBe(false);
    expect(verifyMetaSignature(body, good, "")).toBe(false);
    const cal = createHmac("sha256", "calsecret").update(body).digest("hex");
    expect(verifyCalSignature(body, cal, "calsecret")).toBe(true);
    expect(verifyCalSignature(body, cal.replace(/.$/, "0"), "calsecret")).toBe(cal.endsWith("0"));
    expect(appSecretProof("tok", "sec")).toBe(createHmac("sha256", "sec").update("tok").digest("hex"));
  });

  it("webhook route rejects an unsigned or wrongly signed Meta payload before parsing", async () => {
    vi.stubEnv("META_APP_SECRET", "appsecret");
    const { POST } = await import("@/app/api/webhooks/meta/route");
    const body = JSON.stringify({ entry: [] });
    const bad = await POST(new Request("http://t/api/webhooks/meta", { method: "POST", body, headers: { "x-hub-signature-256": "sha256=deadbeef" } }));
    expect(bad.status).toBe(401);
    const none = await POST(new Request("http://t/api/webhooks/meta", { method: "POST", body: "not json" }));
    expect(none.status).toBe(401);
    const sig = `sha256=${createHmac("sha256", "appsecret").update(body).digest("hex")}`;
    const ok = await POST(new Request("http://t/api/webhooks/meta", { method: "POST", body, headers: { "x-hub-signature-256": sig } }));
    expect(ok.status).toBe(200);
    vi.unstubAllEnvs();
  });
});

describe("Meta API client and failure handling", () => {
  const res = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const noSleep = async () => undefined;

  it("sends the token in the Authorization header, never in the URL", async () => {
    const fetchFn = vi.fn(async () => res(200, { id: "1" }));
    await new MetaClient({ token: "TOKEN123", appSecret: "sec", fetchFn: fetchFn as never, sleep: noSleep }).request("GET", "act_1", { fields: "id" });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).not.toContain("TOKEN123");
    expect(url).toContain("appsecret_proof=");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer TOKEN123");
  });

  it("classifies errors", () => {
    expect(classifyMetaError(400, { error: { code: 190, message: "expired" } }).kind).toBe("auth");
    expect(classifyMetaError(400, { error: { code: 4, message: "too many" } }).kind).toBe("rate_limit");
    expect(classifyMetaError(403, { error: { code: 200, message: "perm" } }).kind).toBe("permission");
    expect(classifyMetaError(500, { error: { message: "oops" } }).kind).toBe("transient");
    expect(classifyMetaError(400, { error: { code: 100, message: "bad param" } }).kind).toBe("invalid");
  });

  it("retries rate limits and transient failures with backoff, then succeeds", async () => {
    const sleeps: number[] = [];
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(res(400, { error: { code: 17, message: "rate" } }))
      .mockResolvedValueOnce(res(503, { error: { message: "down" } }))
      .mockResolvedValueOnce(res(200, { ok: true }));
    const out = await new MetaClient({ token: "t", fetchFn: fetchFn as never, sleep: async (ms) => void sleeps.push(ms) }).request<{ ok: boolean }>("GET", "x");
    expect(out.ok).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(sleeps[1]!).toBeGreaterThan(sleeps[0]! / 10);
  });

  it("does not retry auth errors, and gives up after max retries on persistent failures", async () => {
    const auth = vi.fn(async () => res(401, { error: { code: 190, message: "Token expired" } }));
    await expect(new MetaClient({ token: "t", fetchFn: auth as never, sleep: noSleep }).request("GET", "x")).rejects.toMatchObject({ kind: "auth" });
    expect(auth).toHaveBeenCalledTimes(1);
    const down = vi.fn(async () => res(500, { error: { message: "down" } }));
    await expect(new MetaClient({ token: "t", fetchFn: down as never, sleep: noSleep, maxRetries: 2 }).request("GET", "x")).rejects.toMatchObject({ kind: "transient" });
    expect(down).toHaveBeenCalledTimes(3);
    const net = vi.fn(async () => { throw new TypeError("fetch failed"); });
    await expect(new MetaClient({ token: "t", fetchFn: net as never, sleep: noSleep, maxRetries: 1 }).request("GET", "x")).rejects.toBeInstanceOf(MetaApiError);
  });

  it("sync stores real campaigns/insights, is idempotent, and records failures on the integration instead of throwing", async () => {
    const { deps, ws } = await setup();
    const integ = await deps.repo.insert("integrations", ws.id, { provider: "meta", status: "connected", metaAdAccountId: "999999999", scopes: [] });
    const secrets = new MemorySecretStore("0".repeat(64));
    await secrets.set(ws.id, integ.id, "tok");
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes("/campaigns")) return res(200, { data: [{ id: "100000001", name: "Storm", status: "ACTIVE", objective: "OUTCOME_LEADS", daily_budget: "5000" }] });
      if (u.includes("/adsets")) return res(200, { data: [{ id: "200000001", name: "Set", status: "ACTIVE", campaign_id: "100000001" }] });
      if (u.includes("/insights")) return res(200, { data: [{ ad_id: "300000001", date_start: "2026-10-01", spend: "42.50", impressions: "1000", clicks: "30", reach: "800", actions: [{ action_type: "lead", value: "4" }] }] });
      if (u.includes("/ads")) return res(200, { data: [{ id: "300000001", name: "Ad", status: "ACTIVE", adset_id: "200000001", campaign_id: "100000001", creative: { id: "400000001" } }] });
      return res(404, { error: { message: "?" } });
    });
    const opts = { secrets, fetchFn: fetchFn as never, sleep: noSleep, since: "2026-10-01", until: "2026-10-07" };
    const first = await syncMeta(deps, ws, opts);
    expect(first.ok).toBe(true);
    const second = await syncMeta(deps, ws, opts);
    expect(second.ok).toBe(true);
    expect(await deps.repo.list("campaigns", ws.id)).toHaveLength(1);
    const metrics = await deps.repo.list("metrics", ws.id);
    expect(metrics).toHaveLength(1);
    expect(metrics[0]).toMatchObject({ spend: 42.5, platformLeads: 4 });
    expect((await deps.repo.list("campaigns", ws.id))[0]!.dailyBudget).toBe(50);

    const failing = vi.fn(async () => res(401, { error: { code: 190, message: "Session has expired" } }));
    const bad = await syncMeta(deps, ws, { ...opts, fetchFn: failing as never });
    expect(bad.ok).toBe(false);
    expect(bad.error?.kind).toBe("auth");
    const after = (await deps.repo.get("integrations", ws.id, integ.id))!;
    expect(after.status).toBe("expired");
    expect(after.lastError).toContain("auth");
    expect(await deps.repo.list("metrics", ws.id)).toHaveLength(1); // earlier data untouched
  });

  it("sync without a connection or token fails cleanly", async () => {
    const { deps, ws } = await setup();
    const secrets = new MemorySecretStore("0".repeat(64));
    expect((await syncMeta(deps, ws, { secrets, since: "2026-10-01", until: "2026-10-02" })).ok).toBe(false);
    await deps.repo.insert("integrations", ws.id, { provider: "meta", status: "connected", metaAdAccountId: "999999999", scopes: [] });
    const r = await syncMeta(deps, ws, { secrets, since: "2026-10-01", until: "2026-10-02" });
    expect(r.ok).toBe(false);
    expect(r.error?.kind).toBe("auth");
  });
});

describe("webhook processing", () => {
  const payload = (leadgenId: string, pageId = "55555555") => ({ entry: [{ id: pageId, changes: [{ field: "leadgen", value: { leadgen_id: leadgenId, page_id: pageId, ad_id: "300000001", adgroup_id: "200000001", form_id: "1", created_time: 1 } }] }] });
  const lead = (id: string) => ({ id, field_data: [{ name: "full_name", values: ["Sam Lee"] }, { name: "email", values: ["sam@lee.example"] }, { name: "phone_number", values: ["+18135550123"] }, { name: "company_name", values: ["Lee Roofing"] }], ad_id: "300000001", adset_id: "200000001", campaign_id: "100000001" });

  async function metaSetup() {
    const { deps, ws } = await setup();
    const integ = await deps.repo.insert("integrations", ws.id, { provider: "meta", status: "connected", metaAdAccountId: "999999999", metaPageId: "55555555", scopes: [] });
    const secrets = new MemorySecretStore("0".repeat(64));
    await secrets.set(ws.id, integ.id, "tok");
    return { deps, ws, secrets };
  }

  it("creates a lead from a Meta lead-ad webhook and is idempotent on redelivery", async () => {
    const { deps, ws, secrets } = await metaSetup();
    const fetchFn = vi.fn(async () => new Response(JSON.stringify(lead("L1")), { status: 200 }));
    const opts = { secrets, fetchFn: fetchFn as never, sleep: async () => undefined };
    const a = await handleMetaLeadgen(deps, payload("L1"), opts);
    expect(a).toMatchObject({ created: 1, failed: 0 });
    const b = await handleMetaLeadgen(deps, payload("L1"), opts);
    expect(b).toMatchObject({ created: 0, duplicates: 1 });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const leads = await deps.repo.list("leads", ws.id);
    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({ email: "sam@lee.example", source: "meta_lead_form", businessName: "Lee Roofing" });
  });

  it("ignores pages that belong to no workspace and non-leadgen fields", async () => {
    const { deps, secrets } = await metaSetup();
    const r = await handleMetaLeadgen(deps, { entry: [{ id: "1", changes: [{ field: "feed", value: {} as never }] }, ...payload("L9", "99999999").entry] }, { secrets });
    expect(r).toMatchObject({ created: 0, ignored: 2 });
  });

  it("when Meta is down the event is kept as failed, nothing is lost, and retry creates the lead later", async () => {
    const { deps, ws, secrets } = await metaSetup();
    const down = vi.fn(async () => new Response(JSON.stringify({ error: { message: "down" } }), { status: 503 }));
    const r = await handleMetaLeadgen(deps, payload("L2"), { secrets, fetchFn: down as never, sleep: async () => undefined });
    expect(r.failed).toBe(1);
    expect(await deps.repo.list("leads", ws.id)).toHaveLength(0);
    const [ev] = await deps.repo.list("webhookEvents", ws.id);
    expect(ev).toMatchObject({ status: "failed" });
    const up = vi.fn(async () => new Response(JSON.stringify(lead("L2")), { status: 200 }));
    const retried = await retryFailedMetaLeads(deps, ws, { secrets, fetchFn: up as never, sleep: async () => undefined });
    expect(retried.created).toBe(1);
    expect(await deps.repo.list("leads", ws.id)).toHaveLength(1);
    expect((await deps.repo.list("webhookEvents", ws.id)).every((e) => e.status === "processed")).toBe(true);
  });

  it("calendar webhook books, reschedules and cancels, and ignores duplicate deliveries", async () => {
    const { deps, ws } = await setup();
    const lead = await leadAt(deps, ws);
    const created = { triggerEvent: "BOOKING_CREATED", payload: { uid: "cal-1", startTime: "2026-10-12T14:00:00Z", endTime: "2026-10-12T14:30:00Z", attendees: [{ email: lead.email, name: "Jamie Rivera", timeZone: "America/New_York" }] } };
    expect((await handleCalendarWebhook(deps, ws.slug, created)).status).toBe("processed");
    expect((await handleCalendarWebhook(deps, ws.slug, created)).status).toBe("duplicate");
    expect(await deps.repo.list("appointments", ws.id)).toHaveLength(1);
    expect((await deps.repo.get("leads", ws.id, lead.id))?.stage).toBe("BOOKED");
    await handleCalendarWebhook(deps, ws.slug, { ...created, triggerEvent: "BOOKING_CANCELLED" });
    expect((await deps.repo.list("appointments", ws.id))[0]!.status).toBe("CANCELLED");
    expect((await deps.repo.get("leads", ws.id, lead.id))?.stage).toBe("QUALIFIED");
    expect((await handleCalendarWebhook(deps, "unknown", created)).status).toBe("ignored");
    expect((await handleCalendarWebhook(deps, ws.slug, { triggerEvent: "BOOKING_CREATED", payload: {} })).status).toBe("ignored");
  });
});

describe("pipeline stage list", () => {
  it("is the eight stages from the spec in order", () => {
    expect(PIPELINE_STAGES).toEqual(["NEW_LEAD", "QUALIFIED", "BOOKED", "CONFIRMED", "SHOWED", "PROPOSAL", "WON", "LOST"]);
  });
});
