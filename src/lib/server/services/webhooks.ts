import type { Lead, Workspace } from "../entities";
import { UniqueViolation } from "../repo";
import type { SecretStore } from "../secrets";
import { audit, type Deps } from "./common";
import { createLead } from "./leads";
import { bookingConfigFor } from "./booking";
import { moveLead, rescoreLead } from "./pipeline";
import { MetaApiError, MetaClient } from "./meta";
import { normalizeEmail } from "@/lib/core/validation";

// ---------------------------------------------------------------------------
// Meta lead ads (leadgen webhook)
// ---------------------------------------------------------------------------
export interface MetaLeadgenValue {
  leadgen_id: string;
  page_id: string;
  form_id?: string;
  ad_id?: string;
  adgroup_id?: string;
  created_time?: number;
}
export interface MetaWebhookPayload {
  object?: string;
  entry?: Array<{ id: string; time?: number; changes?: Array<{ field: string; value: MetaLeadgenValue }> }>;
}

interface MetaLeadDetail {
  id: string;
  created_time?: string;
  ad_id?: string;
  adset_id?: string;
  campaign_id?: string;
  field_data?: Array<{ name: string; values: string[] }>;
}

const FIELD_ALIASES: Record<string, string> = {
  first_name: "firstName", last_name: "lastName", email: "email", phone_number: "phone", phone: "phone",
  company_name: "businessName", company: "businessName", city: "city", state: "state", website: "website", job_title: "",
};

export function mapMetaFieldData(fields: MetaLeadDetail["field_data"]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fields ?? []) {
    const value = f.values?.[0]?.trim();
    if (!value) continue;
    const key = f.name.toLowerCase();
    if (key === "full_name") {
      const [first, ...rest] = value.split(/\s+/);
      out.firstName = first ?? value;
      if (rest.length) out.lastName = rest.join(" ");
    } else if (FIELD_ALIASES[key]) {
      out[FIELD_ALIASES[key]!] = value;
    } else if (key.includes("problem") || key.includes("challenge")) {
      out.primaryProblem = value;
    }
  }
  return out;
}

export interface WebhookOutcome {
  received: number;
  created: number;
  duplicates: number;
  ignored: number;
  failed: number;
}

/** Find which workspace owns a Facebook Page via its Meta integration. */
async function workspaceForPage(deps: Deps, pageId: string): Promise<Workspace | null> {
  for (const ws of await deps.repo.listAllWorkspaces()) {
    const [i] = await deps.repo.list("integrations", ws.id, { where: { provider: "meta" }, limit: 1 });
    if (i && (i.metaPageId === pageId || i.externalAccountId === pageId)) return ws;
  }
  return null;
}

export async function handleMetaLeadgen(
  deps: Deps,
  payload: MetaWebhookPayload,
  opts: { secrets: SecretStore; appSecret?: string; version?: string; fetchFn?: typeof fetch; sleep?: (ms: number) => Promise<void> },
): Promise<WebhookOutcome> {
  const out: WebhookOutcome = { received: 0, created: 0, duplicates: 0, ignored: 0, failed: 0 };
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      out.received++;
      if (change.field !== "leadgen" || !change.value?.leadgen_id) {
        out.ignored++;
        continue;
      }
      const v = change.value;
      const ws = await workspaceForPage(deps, v.page_id);
      if (!ws) {
        out.ignored++;
        continue;
      }
      // Idempotency: Meta retries deliveries. One row per leadgen_id.
      try {
        await deps.repo.insert("webhookEvents", ws.id, { provider: "meta", externalId: v.leadgen_id, eventType: "leadgen", payload: v, signatureValid: true, status: "received", receivedAt: deps.now().toISOString() });
      } catch (e) {
        if (e instanceof UniqueViolation) {
          const [prev] = await deps.repo.list("webhookEvents", ws.id, { where: { externalId: v.leadgen_id } });
          if (prev && prev.status === "processed") {
            out.duplicates++;
            continue;
          }
        } else throw e;
      }
      const [ev] = await deps.repo.list("webhookEvents", ws.id, { where: { externalId: v.leadgen_id }, limit: 1 });
      try {
        const [integration] = await deps.repo.list("integrations", ws.id, { where: { provider: "meta" }, limit: 1 });
        const token = integration ? await opts.secrets.get(ws.id, integration.id) : null;
        if (!token) throw new MetaApiError("No Meta token stored for this workspace", "auth", 401);
        const client = new MetaClient({ token, appSecret: opts.appSecret, version: opts.version, fetchFn: opts.fetchFn, sleep: opts.sleep });
        const detail = await client.request<MetaLeadDetail>("GET", v.leadgen_id, { fields: "id,created_time,ad_id,adset_id,campaign_id,field_data" });
        const mapped = mapMetaFieldData(detail.field_data);
        const res = await createLead(
          deps,
          {
            workspaceSlug: ws.slug,
            firstName: mapped.firstName ?? "Unknown",
            lastName: mapped.lastName,
            email: mapped.email ?? "",
            phone: mapped.phone,
            businessName: mapped.businessName,
            city: mapped.city,
            state: mapped.state,
            website: mapped.website,
            primaryProblem: mapped.primaryProblem,
            // The person submitted a Meta lead form asking to be contacted. The form must carry your disclosure/consent text.
            contactConsent: true,
            attribution: { utm_source: "meta", utm_medium: "paid", meta_ad_id: detail.ad_id ?? v.ad_id, meta_adset_id: detail.adset_id ?? v.adgroup_id, meta_campaign_id: detail.campaign_id },
          },
          { source: "meta_lead_form", consentText: "Submitted a Meta lead form requesting contact" },
        );
        if (res.duplicate) out.duplicates++;
        else out.created++;
        if (ev) await deps.repo.update("webhookEvents", ws.id, ev.id, { status: "processed", processedAt: deps.now().toISOString(), error: undefined });
      } catch (e) {
        out.failed++;
        const message = e instanceof Error ? e.message : String(e);
        if (ev) await deps.repo.update("webhookEvents", ws.id, ev.id, { status: "failed", error: message });
        await audit(deps, ws.id, { type: "webhook" }, { action: "meta_leadgen_failed", entityType: "webhook_events", entityId: ev?.id, after: { leadgenId: v.leadgen_id, message } });
      }
    }
  }
  return out;
}

/** Re-attempt failed lead-ad deliveries (cron). Failed rows keep their payload so nothing is lost if Meta was down. */
export async function retryFailedMetaLeads(deps: Deps, ws: Workspace, opts: Parameters<typeof handleMetaLeadgen>[2]): Promise<WebhookOutcome> {
  const failed = await deps.repo.list("webhookEvents", ws.id, { where: { provider: "meta", status: "failed" }, limit: 50 });
  const total: WebhookOutcome = { received: 0, created: 0, duplicates: 0, ignored: 0, failed: 0 };
  for (const f of failed) {
    await deps.repo.remove("webhookEvents", ws.id, f.id);
    const r = await handleMetaLeadgen(deps, { entry: [{ id: (f.payload as MetaLeadgenValue).page_id, changes: [{ field: "leadgen", value: f.payload as MetaLeadgenValue }] }] }, opts);
    for (const k of Object.keys(total) as Array<keyof WebhookOutcome>) total[k] += r[k];
  }
  return total;
}

// ---------------------------------------------------------------------------
// Calendar (Cal.com) webhook
// ---------------------------------------------------------------------------
export interface CalWebhookPayload {
  triggerEvent: "BOOKING_CREATED" | "BOOKING_RESCHEDULED" | "BOOKING_CANCELLED" | "MEETING_ENDED" | string;
  payload?: {
    uid?: string;
    startTime?: string;
    endTime?: string;
    attendees?: Array<{ email?: string; name?: string; timeZone?: string }>;
    metadata?: { videoCallUrl?: string };
  };
}

export async function handleCalendarWebhook(deps: Deps, workspaceSlug: string, body: CalWebhookPayload): Promise<{ status: "processed" | "ignored" | "duplicate"; leadId?: string }> {
  const ws = await deps.repo.getWorkspaceBySlug(workspaceSlug);
  if (!ws) return { status: "ignored" };
  const p = body.payload;
  const uid = p?.uid;
  if (!uid || !p?.startTime || !p.endTime) return { status: "ignored" };

  const idempotencyKey = `${uid}:${body.triggerEvent}:${p.startTime}`;
  try {
    await deps.repo.insert("webhookEvents", ws.id, { provider: "calendar", externalId: idempotencyKey, eventType: body.triggerEvent, payload: body, signatureValid: true, status: "received", receivedAt: deps.now().toISOString() });
  } catch (e) {
    if (e instanceof UniqueViolation) return { status: "duplicate" };
    throw e;
  }

  const attendee = p.attendees?.[0];
  const email = attendee?.email ? normalizeEmail(attendee.email) : undefined;
  if (!email) return { status: "ignored" };

  let lead: Lead | undefined = (await deps.repo.list("leads", ws.id, { where: { email }, limit: 1 }))[0];
  const existingAppt = (await deps.repo.list("appointments", ws.id, { where: { provider: "cal" } })).find((a) => a.externalId === uid);

  if (body.triggerEvent === "BOOKING_CANCELLED") {
    if (existingAppt) {
      await deps.repo.update("appointments", ws.id, existingAppt.id, { status: "CANCELLED" });
      const l = await deps.repo.get("leads", ws.id, existingAppt.leadId);
      if (l && (l.stage === "BOOKED" || l.stage === "CONFIRMED")) await moveLead(deps, ws.id, l.id, "QUALIFIED", { type: "webhook" }, { note: "Cancelled in calendar" });
    }
    return { status: "processed", leadId: existingAppt?.leadId };
  }
  if (body.triggerEvent !== "BOOKING_CREATED" && body.triggerEvent !== "BOOKING_RESCHEDULED") return { status: "ignored" };

  if (!lead) {
    // Someone booked directly in the calendar without filling in the form. They asked for the call, so create the lead.
    const [first = "Unknown", ...rest] = (attendee?.name ?? "").split(/\s+/);
    const created = await createLead(deps, { workspaceSlug: ws.slug, firstName: first || "Unknown", lastName: rest.join(" ") || undefined, email, contactConsent: true, attribution: { utm_source: "calendar" } }, { source: "manual", consentText: "Booked a call directly in the calendar" });
    if (created.leadId) lead = (await deps.repo.get("leads", ws.id, created.leadId)) ?? undefined;
  }
  if (!lead) return { status: "ignored" };

  const cfg = bookingConfigFor(ws);
  if (existingAppt) {
    await deps.repo.update("appointments", ws.id, existingAppt.id, { startAt: new Date(p.startTime).toISOString(), endAt: new Date(p.endTime).toISOString(), status: "SCHEDULED", timezone: attendee?.timeZone ?? existingAppt.timezone });
  } else {
    for (const a of (await deps.repo.list("appointments", ws.id, { where: { leadId: lead.id } })).filter((a) => ["SCHEDULED", "CONFIRMED"].includes(a.status))) {
      await deps.repo.update("appointments", ws.id, a.id, { status: "RESCHEDULED" });
    }
    await deps.repo.insert("appointments", ws.id, { leadId: lead.id, provider: "cal", externalId: uid, startAt: new Date(p.startTime).toISOString(), endAt: new Date(p.endTime).toISOString(), timezone: attendee?.timeZone ?? "UTC", status: "SCHEDULED", meetingUrl: p.metadata?.videoCallUrl ?? cfg.meetingUrl, createdAt: deps.now().toISOString() });
  }
  const fresh = (await deps.repo.get("leads", ws.id, lead.id))!;
  if (fresh.stage === "NEW_LEAD" || fresh.stage === "LOST") await moveLead(deps, ws.id, lead.id, "QUALIFIED", { type: "webhook" }, { note: "Booked via calendar" });
  if (["NEW_LEAD", "QUALIFIED", "LOST"].includes(fresh.stage)) await moveLead(deps, ws.id, lead.id, "BOOKED", { type: "webhook" }, { note: "Booked via calendar" });
  await rescoreLead(deps, ws.id, lead.id, { hasBookedCall: true });
  await audit(deps, ws.id, { type: "webhook" }, { action: body.triggerEvent.toLowerCase(), entityType: "appointments", entityId: uid, campaignId: lead.campaignId });
  return { status: "processed", leadId: lead.id };
}
