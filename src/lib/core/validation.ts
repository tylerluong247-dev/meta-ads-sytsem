import { z } from "zod";

export const REVENUE_RANGES = ["under_10k", "10k_30k", "30k_100k", "over_100k"] as const;
export const BUDGET_RANGES = ["under_1k", "1k_3k", "3k_10k", "over_10k"] as const;
export const TIMELINES = ["asap", "within_30_days", "within_90_days", "exploring"] as const;

export type RevenueRange = (typeof REVENUE_RANGES)[number];
export type BudgetRange = (typeof BUDGET_RANGES)[number];
export type Timeline = (typeof TIMELINES)[number];

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Digits only; US numbers lose a leading 1 so "+1 (555) 123-4567" and "5551234567" dedupe. */
export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
}

const optionalText = (max = 200) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

const attributionSchema = z
  .object({
    utm_source: optionalText(),
    utm_medium: optionalText(),
    utm_campaign: optionalText(),
    utm_content: optionalText(),
    utm_term: optionalText(),
    meta_campaign_id: optionalText(64),
    meta_adset_id: optionalText(64),
    meta_ad_id: optionalText(64),
    fbclid: optionalText(500),
    landing_page: optionalText(300),
    referrer: optionalText(500),
  })
  .partial();

export const leadInputSchema = z.object({
  workspaceSlug: z.string().trim().min(1).max(80),
  firstName: z.string().trim().min(1, "First name is required").max(80),
  lastName: optionalText(80),
  email: z.string().trim().toLowerCase().email("Enter a valid email").max(254),
  phone: z
    .string()
    .trim()
    .max(30)
    .optional()
    .transform((v) => (v ? v : undefined))
    .refine((v) => v === undefined || normalizePhone(v).length === 10, "Enter a 10-digit phone number"),
  businessName: optionalText(150),
  industry: optionalText(80),
  website: z
    .string()
    .trim()
    .max(300)
    .optional()
    .transform((v) => (v ? v : undefined))
    .refine((v) => v === undefined || /^(https?:\/\/)?[^\s.]+\.[^\s]{2,}$/i.test(v), "Enter a valid website"),
  city: optionalText(100),
  state: optionalText(40),
  monthlyRevenue: z.enum(REVENUE_RANGES).optional(),
  currentLeadGenMethod: optionalText(300),
  primaryProblem: optionalText(1000),
  desiredOutcome: optionalText(1000),
  budgetRange: z.enum(BUDGET_RANGES).optional(),
  timeline: z.enum(TIMELINES).optional(),
  readyToInvest: z.boolean().optional(),
  /** Explicit, unticked-by-default consent to be contacted by email/phone about this request. */
  contactConsent: z.literal(true, { message: "Please confirm you agree to be contacted" }),
  smsConsent: z.boolean().optional().default(false),
  attribution: attributionSchema.optional(),
  /** Honeypot: real users never fill this in. Any value is accepted here so a bot can't tell it was caught; createLead drops it silently. */
  company_website_url: z.string().max(500).optional(),
});

export type LeadInput = z.infer<typeof leadInputSchema>;

export function dedupeKey(workspaceId: string, email: string, phone?: string): string {
  return `${workspaceId}:${normalizeEmail(email)}:${phone ? normalizePhone(phone) : ""}`;
}

/** Fields a person may change when editing a workspace. */
export const workspaceSettingsSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{2,60}$/, "Lowercase letters, numbers and dashes only"),
  website: z.string().trim().max(300).optional(),
  industry: z.string().trim().min(1).max(80),
  location: z.string().trim().max(120).optional(),
  offer: z.string().trim().max(300).optional(),
  avgClientValue: z.number().min(0).max(10_000_000),
  grossMargin: z.number().min(0).max(1),
  desiredProfitMargin: z.number().min(0).max(1),
  targetCac: z.number().min(0),
  targetCpl: z.number().min(0),
  targetBookedCallCost: z.number().min(0),
  targetRoas: z.number().min(0),
  closeRate: z.number().min(0).max(1),
  showRate: z.number().min(0).max(1),
  qualifiedRate: z.number().min(0).max(1),
  bookedRate: z.number().min(0).max(1),
  avgSalesCycleDays: z.number().int().min(0).max(730),
  monthlyAdBudget: z.number().min(0),
  monthlyRevenueTarget: z.number().min(0),
  timezone: z.string().trim().min(1).max(60).refine((tz) => { try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; } }, "Unknown time zone").optional(),
  senderName: z.string().trim().max(120).optional(),
  senderEmail: z.string().trim().email().max(200).optional(),
  postalAddress: z.string().trim().max(300).optional(),
  bookingUrl: z.string().trim().url().max(300).optional(),
  speedTargetMinutes: z.number().int().min(1).max(1440).optional(),
  speedCriticalMinutes: z.number().int().min(1).max(10080).optional(),
});
export type WorkspaceSettings = z.infer<typeof workspaceSettingsSchema>;
