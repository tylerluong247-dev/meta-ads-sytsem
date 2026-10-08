export interface SequenceStep {
  id: string;
  /** Minutes after enrollment. */
  delayMinutes: number;
  channel: "email" | "sms";
  subject?: string;
  body: string;
}

export interface FollowUpLead {
  id: string;
  email?: string;
  phone?: string;
  optedOutEmail: boolean;
  optedOutSms: boolean;
  smsConsent: boolean;
  stage: string;
  hasBooked: boolean;
  replied: boolean;
  createdAt: Date;
}

export type StopReason = "BOOKED" | "REPLIED" | "OPTED_OUT" | "DISQUALIFIED" | "WON_OR_LOST" | "NO_CHANNEL" | "NO_CONSENT";

/** Stop conditions checked before every send. Returns null when it is OK to send. */
export function stopReason(lead: FollowUpLead, step: SequenceStep, tier?: string): StopReason | null {
  if (lead.stage === "WON" || lead.stage === "LOST") return "WON_OR_LOST";
  if (tier === "DISQUALIFIED") return "DISQUALIFIED";
  if (lead.hasBooked && step.id !== "booking-confirmation") return "BOOKED";
  if (lead.replied) return "REPLIED";
  if (step.channel === "email") {
    if (!lead.email) return "NO_CHANNEL";
    if (lead.optedOutEmail) return "OPTED_OUT";
  } else {
    if (!lead.phone) return "NO_CHANNEL";
    if (lead.optedOutSms) return "OPTED_OUT";
    if (!lead.smsConsent) return "NO_CONSENT";
  }
  return null;
}

/** SMS quiet hours (TCPA guidance: no messages before 8am or after 9pm recipient-local). Email is unrestricted. */
export function withinQuietHours(sendAt: Date, utcOffsetMinutes: number, startHour = 21, endHour = 8): boolean {
  const local = new Date(sendAt.getTime() + utcOffsetMinutes * 60000);
  const h = local.getUTCHours();
  return h >= startHour || h < endHour;
}

/** Push an SMS send to the next allowed window. */
export function nextAllowedSend(sendAt: Date, utcOffsetMinutes: number, startHour = 21, endHour = 8): Date {
  if (!withinQuietHours(sendAt, utcOffsetMinutes, startHour, endHour)) return sendAt;
  const local = new Date(sendAt.getTime() + utcOffsetMinutes * 60000);
  const h = local.getUTCHours();
  const next = new Date(local);
  if (h >= startHour) next.setUTCDate(next.getUTCDate() + 1);
  next.setUTCHours(endHour, 0, 0, 0);
  return new Date(next.getTime() - utcOffsetMinutes * 60000);
}

export interface ScheduledSend {
  stepId: string;
  sendAt: Date;
}

export function scheduleSequence(steps: SequenceStep[], enrolledAt: Date, utcOffsetMinutes = 0): ScheduledSend[] {
  return [...steps]
    .sort((a, b) => a.delayMinutes - b.delayMinutes)
    .map((s) => {
      const raw = new Date(enrolledAt.getTime() + s.delayMinutes * 60000);
      return { stepId: s.id, sendAt: s.channel === "sms" ? nextAllowedSend(raw, utcOffsetMinutes) : raw };
    });
}

const KEYWORDS_STOP = /^\s*(stop|stopall|unsubscribe|cancel|end|quit)\s*[.!]?\s*$/i;
export function isOptOutMessage(body: string): boolean {
  return KEYWORDS_STOP.test(body);
}

export function renderTemplate(template: string, vars: Record<string, string | undefined>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => vars[k] ?? "");
}

export const DEFAULT_SEQUENCE: SequenceStep[] = [
  {
    id: "instant",
    delayMinutes: 0,
    channel: "email",
    subject: "Thanks for reaching out, {{firstName}} — here's the next step",
    body: "Hi {{firstName}},\n\nThanks for reaching out about {{businessName}}. The next step is a short call so we can see whether we can help.\n\nPick a time that suits you: {{bookingUrl}}\n\nIf you'd rather not hear from us, just reply or use the unsubscribe link below.\n\n— {{senderName}}",
  },
  {
    id: "followup-1",
    delayMinutes: 60 * 24,
    channel: "email",
    subject: "Still want to talk, {{firstName}}?",
    body: "Hi {{firstName}},\n\nJust checking you saw my note. A 20-minute call is the fastest way to find out if there's a fit: {{bookingUrl}}\n\n— {{senderName}}",
  },
  {
    id: "followup-2",
    delayMinutes: 60 * 24 * 3,
    channel: "email",
    subject: "A quick question about {{businessName}}",
    body: "Hi {{firstName}},\n\nWhat's the biggest thing standing in the way of more booked jobs right now? Reply with a line or two, or grab a time here: {{bookingUrl}}\n\n— {{senderName}}",
  },
  {
    id: "followup-3",
    delayMinutes: 60 * 24 * 7,
    channel: "email",
    subject: "Closing the loop",
    body: "Hi {{firstName}},\n\nI'll close your request for now so I'm not cluttering your inbox. If timing changes, you can book any time: {{bookingUrl}}\n\n— {{senderName}}",
  },
];
