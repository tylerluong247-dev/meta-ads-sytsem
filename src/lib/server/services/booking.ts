import { formatInZone, generateSlots, isSlotAvailable, reminderTimes, type AvailabilityRule, type Slot } from "@/lib/core/booking";
import { nextAction } from "@/lib/core/pipeline";
import type { Appointment, BookingConfig, Lead, Workspace } from "../entities";
import { UniqueViolation } from "../repo";
import { audit, logEvent, NotFoundError, ValidationError, type Deps } from "./common";
import { cancelPendingRuns, enrollInSequences, sendEmailToLead } from "./followup";
import { moveLead, rescoreLead } from "./pipeline";

export const DEFAULT_BOOKING: BookingConfig = { weekdays: [1, 2, 3, 4, 5], startHour: 9, endHour: 17, durationMinutes: 30, minNoticeMinutes: 120 };

export function bookingConfigFor(ws: Workspace): BookingConfig {
  return { ...DEFAULT_BOOKING, ...ws.bookingConfig };
}

const ACTIVE = ["SCHEDULED", "CONFIRMED"] as const;

export async function findLeadByToken(deps: Deps, workspaceSlug: string, token: string): Promise<{ ws: Workspace; lead: Lead }> {
  const ws = await deps.repo.getWorkspaceBySlug(workspaceSlug);
  if (!ws) throw new NotFoundError();
  const [lead] = await deps.repo.list("leads", ws.id, { where: { unsubscribeToken: token }, limit: 1 });
  if (!lead) throw new NotFoundError();
  return { ws, lead };
}

export async function getAvailability(deps: Deps, ws: Workspace, days = 14): Promise<Slot[]> {
  const cfg = bookingConfigFor(ws);
  const appts = await deps.repo.list("appointments", ws.id);
  const busy = appts.filter((a) => (ACTIVE as readonly string[]).includes(a.status)).map((a) => ({ startUtc: a.startAt, endUtc: a.endAt }));
  const rules: AvailabilityRule = { weekdays: cfg.weekdays, startHour: cfg.startHour, endHour: cfg.endHour };
  return generateSlots({ hostTimeZone: ws.timezone, rules, from: deps.now(), days, durationMinutes: cfg.durationMinutes, minNoticeMinutes: cfg.minNoticeMinutes, busy });
}

function confirmationBody(ws: Workspace, lead: Lead, whenText: string, meetingUrl?: string): string {
  return `Hi {{firstName}},\n\nYour call with ${ws.name} is booked for ${whenText}.${meetingUrl ? `\n\nJoin here: ${meetingUrl}` : ""}\n\nNeed to change it? Use your booking link: {{bookingUrl}}\n\n— {{senderName}}`;
}

/** Book (or rebook) a call. The slot must be a currently-available one; double-booking is rejected by a unique constraint too. */
export async function bookAppointment(
  deps: Deps,
  workspaceSlug: string,
  token: string,
  startUtc: string,
  timeZone = "UTC",
): Promise<Appointment> {
  const { ws, lead } = await findLeadByToken(deps, workspaceSlug, token);
  if (lead.stage === "LOST" && lead.tier === "DISQUALIFIED") throw new ValidationError("This request can't be booked online.");
  if (lead.stage === "WON") throw new ValidationError("You're already a client.");

  const cfg = bookingConfigFor(ws);
  const slot: Slot = { startUtc: new Date(startUtc).toISOString(), endUtc: new Date(new Date(startUtc).getTime() + cfg.durationMinutes * 60000).toISOString() };
  const available = await getAvailability(deps, ws, 30);
  if (!isSlotAvailable(slot, available)) throw new ValidationError("That time is no longer available. Please pick another.");

  // Replace an existing active appointment for this lead (reschedule).
  const existing = (await deps.repo.list("appointments", ws.id, { where: { leadId: lead.id } })).filter((a) => (ACTIVE as readonly string[]).includes(a.status));
  for (const a of existing) await deps.repo.update("appointments", ws.id, a.id, { status: "RESCHEDULED" });

  let appt: Appointment;
  try {
    appt = await deps.repo.insert("appointments", ws.id, {
      leadId: lead.id,
      provider: "internal",
      startAt: slot.startUtc,
      endAt: slot.endUtc,
      timezone: timeZone,
      status: "SCHEDULED",
      meetingUrl: cfg.meetingUrl,
      createdAt: deps.now().toISOString(),
    });
  } catch (e) {
    // Restore the previous booking if the new slot was taken in a race.
    for (const a of existing) await deps.repo.update("appointments", ws.id, a.id, { status: a.status });
    if (e instanceof UniqueViolation) throw new ValidationError("That time was just taken. Please pick another.");
    throw e;
  }

  // Pipeline: bring the lead to BOOKED from wherever it is (reschedule from QUALIFIED/BOOKED/CONFIRMED all legal).
  const fresh = (await deps.repo.get("leads", ws.id, lead.id)) ?? lead;
  if (fresh.stage === "NEW_LEAD" || fresh.stage === "QUALIFIED" || fresh.stage === "LOST") {
    if (fresh.stage === "NEW_LEAD" || fresh.stage === "LOST") await moveLead(deps, ws.id, lead.id, "QUALIFIED", { type: "public" }, { note: "Booked a call" });
    await moveLead(deps, ws.id, lead.id, "BOOKED", { type: "public" }, { note: "Booked a call" });
  } else if (fresh.stage === "CONFIRMED") {
    await moveLead(deps, ws.id, lead.id, "QUALIFIED", { type: "public" });
    await moveLead(deps, ws.id, lead.id, "BOOKED", { type: "public" });
  }
  await deps.repo.update("leads", ws.id, lead.id, { nextAction: nextAction("BOOKED", true) });
  await rescoreLead(deps, ws.id, lead.id, { hasBookedCall: true });
  await cancelPendingRuns(deps, ws.id, lead.id, "booked");
  await enrollInSequences(deps, ws, lead, "lead_booked");
  await logEvent(deps, ws.id, lead.id, existing.length ? "rescheduled" : "booked", { startAt: slot.startUtc, timeZone });
  await audit(deps, ws.id, { type: "public" }, { action: existing.length ? "appointment_rescheduled" : "appointment_booked", entityType: "appointments", entityId: appt.id, campaignId: lead.campaignId, after: { startAt: slot.startUtc } });

  const when = formatInZone(slot.startUtc, timeZone);
  await sendEmailToLead(deps, ws, { ...lead }, { stepId: `booking-confirmation:${appt.id}`, subject: `You're booked: ${when}`, body: confirmationBody(ws, lead, when, cfg.meetingUrl), transactional: true });
  return appt;
}

export async function cancelAppointment(deps: Deps, workspaceSlug: string, token: string): Promise<void> {
  const { ws, lead } = await findLeadByToken(deps, workspaceSlug, token);
  const active = (await deps.repo.list("appointments", ws.id, { where: { leadId: lead.id } })).filter((a) => (ACTIVE as readonly string[]).includes(a.status));
  if (active.length === 0) throw new NotFoundError("No active appointment");
  for (const a of active) await deps.repo.update("appointments", ws.id, a.id, { status: "CANCELLED" });
  if (lead.stage === "BOOKED" || lead.stage === "CONFIRMED") await moveLead(deps, ws.id, lead.id, "QUALIFIED", { type: "public" }, { note: "Cancelled call" });
  await logEvent(deps, ws.id, lead.id, "appointment_cancelled", {});
  await audit(deps, ws.id, { type: "public" }, { action: "appointment_cancelled", entityType: "appointments", entityId: active[0]!.id, campaignId: lead.campaignId });
}

/** Lead confirms attendance (link in the reminder email). */
export async function confirmAppointment(deps: Deps, workspaceSlug: string, token: string): Promise<void> {
  const { ws, lead } = await findLeadByToken(deps, workspaceSlug, token);
  const active = (await deps.repo.list("appointments", ws.id, { where: { leadId: lead.id } })).filter((a) => (ACTIVE as readonly string[]).includes(a.status));
  const appt = active[0];
  if (!appt) throw new NotFoundError("No active appointment");
  await deps.repo.update("appointments", ws.id, appt.id, { status: "CONFIRMED" });
  if (lead.stage === "BOOKED") await moveLead(deps, ws.id, lead.id, "CONFIRMED", { type: "public" });
}

/** Cron: 24h and 1h reminders. Each fires once (sent-at stamps) and only for active appointments. */
export async function sendDueReminders(deps: Deps, ws: Workspace): Promise<{ day: number; hour: number }> {
  const now = deps.now();
  const appts = (await deps.repo.list("appointments", ws.id)).filter((a) => (ACTIVE as readonly string[]).includes(a.status) && new Date(a.startAt) > now);
  const out = { day: 0, hour: 0 };
  for (const a of appts) {
    const lead = await deps.repo.get("leads", ws.id, a.leadId);
    if (!lead) continue;
    const { dayBefore, hourBefore } = reminderTimes(a.startAt);
    const when = formatInZone(a.startAt, a.timezone);
    const body = (lead2: string) => `Hi {{firstName}},\n\n${lead2} Your call with ${ws.name} is ${when}.${a.meetingUrl ? `\n\nJoin: ${a.meetingUrl}` : ""}\n\nNeed to change it? {{bookingUrl}}\n\n— {{senderName}}`;
    if (!a.reminderHourSentAt && now >= hourBefore) {
      const r = await sendEmailToLead(deps, ws, lead, { stepId: `reminder-1h:${a.id}`, subject: "Your call starts in about an hour", body: body("Quick reminder."), transactional: true });
      if (r.status !== "failed") {
        await deps.repo.update("appointments", ws.id, a.id, { reminderHourSentAt: now.toISOString(), reminderDaySentAt: a.reminderDaySentAt ?? now.toISOString() });
        out.hour++;
      }
    } else if (!a.reminderDaySentAt && now >= dayBefore && now < hourBefore) {
      const r = await sendEmailToLead(deps, ws, lead, { stepId: `reminder-24h:${a.id}`, subject: "Reminder: your call is tomorrow", body: body("Looking forward to it."), transactional: true });
      if (r.status !== "failed") {
        await deps.repo.update("appointments", ws.id, a.id, { reminderDaySentAt: now.toISOString() });
        out.day++;
      }
    }
  }
  return out;
}
