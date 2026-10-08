import type { LeadAttribution } from "@/lib/core/attribution";
import type { AppointmentStatus, CreativeStatus, LeadTier, PipelineStage } from "@/lib/core/types";
import type { BudgetRange, RevenueRange, Timeline } from "@/lib/core/validation";

export type Role = "owner" | "admin" | "member" | "viewer";
export const ROLE_RANK: Record<Role, number> = { viewer: 0, member: 1, admin: 2, owner: 3 };

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  website?: string;
  industry: string;
  location?: string;
  offer?: string;
  timezone: string;
  avgClientValue: number;
  grossMargin: number;
  desiredProfitMargin: number;
  targetCac: number;
  targetCpl: number;
  targetBookedCallCost: number;
  targetRoas: number;
  closeRate: number;
  showRate: number;
  qualifiedRate: number;
  bookedRate: number;
  avgSalesCycleDays: number;
  monthlyAdBudget: number;
  monthlyRevenueTarget: number;
  scoringConfig: Record<string, unknown>;
  speedTargetMinutes: number;
  speedCriticalMinutes: number;
  senderName?: string;
  senderEmail?: string;
  postalAddress?: string;
  bookingUrl?: string;
  bookingConfig: Partial<BookingConfig>;
  createdAt: string;
}

export interface BookingConfig {
  weekdays: number[];
  startHour: number;
  endHour: number;
  durationMinutes: number;
  minNoticeMinutes: number;
  meetingUrl?: string;
}

export interface Campaign {
  id: string;
  workspaceId: string;
  name: string;
  niche?: string;
  objective?: string;
  status: "draft" | "active" | "paused" | "archived";
  dailyBudget?: number;
  metaCampaignId?: string;
  metaAdAccountId?: string;
  plan?: unknown;
  createdAt: string;
}

export interface AdSet {
  id: string;
  workspaceId: string;
  campaignId: string;
  name: string;
  audience?: string;
  status: Campaign["status"];
  dailyBudget?: number;
  metaAdsetId?: string;
  createdAt: string;
}

export interface Ad {
  id: string;
  workspaceId: string;
  adSetId?: string;
  campaignId?: string;
  creativeId?: string;
  name: string;
  status: Campaign["status"];
  metaAdId?: string;
  createdAt: string;
}

export interface Creative {
  id: string;
  workspaceId: string;
  campaignId?: string;
  name: string;
  hook?: string;
  angle?: string;
  format?: "image" | "video" | "carousel" | "text";
  audience?: string;
  primaryText?: string;
  headline?: string;
  description?: string;
  cta?: string;
  launchDate?: string;
  status: CreativeStatus;
  metaCreativeId?: string;
  createdAt: string;
}

export interface Lead {
  id: string;
  workspaceId: string;
  dedupeKey: string;
  firstName: string;
  lastName?: string;
  email: string;
  phone?: string;
  businessName?: string;
  industry?: string;
  website?: string;
  city?: string;
  state?: string;
  monthlyRevenue?: RevenueRange;
  currentLeadGenMethod?: string;
  primaryProblem?: string;
  desiredOutcome?: string;
  budgetRange?: BudgetRange;
  timeline?: Timeline;
  readyToInvest?: boolean;
  stage: PipelineStage;
  tier: LeadTier;
  score: number;
  disqualifiedReason?: string;
  lostReason?: string;
  campaignId?: string;
  adSetId?: string;
  adId?: string;
  creativeId?: string;
  landingPageId?: string;
  source: "landing_page" | "meta_lead_form" | "manual" | "import";
  experimentId?: string;
  experimentArm?: "control" | "variant";
  contactConsentAt?: string;
  smsConsentAt?: string;
  consentText?: string;
  optedOutEmail: boolean;
  optedOutSms: boolean;
  unsubscribeToken: string; // doubles as the unguessable public capability token for booking pages
  attribution: LeadAttribution;
  qualifiedAt?: string;
  bookedAt?: string;
  showedAt?: string;
  wonAt?: string;
  lostAt?: string;
  firstResponseAt?: string;
  lastActivityAt: string;
  nextAction?: string;
  createdAt: string;
}

export interface LeadEvent {
  id: string;
  workspaceId: string;
  leadId: string;
  type: string;
  data: Record<string, unknown>;
  actorId?: string;
  createdAt: string;
}

export interface Appointment {
  id: string;
  workspaceId: string;
  leadId: string;
  provider: string;
  externalId?: string;
  startAt: string;
  endAt: string;
  timezone: string;
  status: AppointmentStatus;
  meetingUrl?: string;
  reminderDaySentAt?: string;
  reminderHourSentAt?: string;
  createdAt: string;
}

export interface Communication {
  id: string;
  workspaceId: string;
  leadId: string;
  channel: "email" | "sms" | "note" | "call";
  direction: "outbound" | "inbound";
  stepId?: string;
  subject?: string;
  body?: string;
  status: "queued" | "sent" | "delivered" | "failed" | "skipped" | "received";
  skipReason?: string;
  providerMessageId?: string;
  scheduledFor?: string;
  sentAt?: string;
  error?: string;
  createdAt: string;
}

export interface LeadScoreRow {
  id: string;
  workspaceId: string;
  leadId: string;
  score: number;
  tier: string;
  factors: unknown;
  createdAt: string;
}

export interface PipelineEvent {
  id: string;
  workspaceId: string;
  leadId: string;
  fromStage?: PipelineStage;
  toStage: PipelineStage;
  actorId?: string;
  note?: string;
  createdAt: string;
}

export interface Deal {
  id: string;
  workspaceId: string;
  leadId: string;
  customerId?: string;
  status: "won" | "lost" | "open";
  clientValue: number;
  initialPayment: number;
  recurringPayment: number;
  recurringMonths: number;
  oneTimeFees: number;
  contractValue: number;
  closeDate: string; // YYYY-MM-DD
  salesperson?: string;
  campaignId?: string;
  adId?: string;
  creativeId?: string;
  lossReason?: string;
  createdAt: string;
}

export interface Customer {
  id: string;
  workspaceId: string;
  leadId?: string;
  name: string;
  company?: string;
  email?: string;
  startedOn: string;
  createdAt: string;
}

export interface RevenueRow {
  id: string;
  workspaceId: string;
  dealId: string;
  customerId?: string;
  kind: "initial" | "recurring" | "one_time" | "refund";
  amount: number;
  receivedOn: string;
  createdAt: string;
}

export interface MetricRow {
  id: string;
  workspaceId: string;
  date: string; // YYYY-MM-DD
  campaignId?: string;
  adSetId?: string;
  adId?: string;
  creativeId?: string;
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  platformLeads: number;
  source: string;
}

export interface ExperimentConfig {
  /** Landing page slug the test runs on (landing/headline/offer/cta tests). */
  landingSlug?: string;
  /** Content keys to override per arm, e.g. { headline: "..." }. */
  control?: Record<string, string>;
  variant?: Record<string, string>;
}

export interface ExperimentArm {
  id: string;
  workspaceId: string;
  experimentId: string;
  arm: "control" | "variant";
  visitors: number;
  spend: number;
  createdAt: string;
}

export interface Experiment {
  id: string;
  workspaceId: string;
  name: string;
  type: string;
  status: "draft" | "running" | "completed" | "stopped";
  controlLabel: string;
  variantLabel: string;
  config: ExperimentConfig;
  startedAt: string;
  endedAt?: string;
  createdAt: string;
}

export interface LandingPageRow {
  id: string;
  workspaceId: string;
  slug: string;
  niche: string;
  published: boolean;
  content: Record<string, unknown>;
  createdAt: string;
}

export interface AutomationStep {
  id: string;
  delayMinutes: number;
  channel: "email" | "sms";
  subject?: string;
  body: string;
}

export interface AutomationRule {
  id: string;
  workspaceId: string;
  name: string;
  trigger: "lead_created" | "lead_booked" | "appointment_reminder" | "no_show" | "stage_changed";
  enabled: boolean;
  config: { steps: AutomationStep[] };
  createdAt: string;
}

export interface AutomationRun {
  id: string;
  workspaceId: string;
  ruleId: string;
  leadId: string;
  stepId: string;
  status: "scheduled" | "sent" | "skipped" | "failed" | "cancelled";
  scheduledFor: string;
  executedAt?: string;
  skipReason?: string;
  error?: string;
  createdAt: string;
}

export interface WebhookEvent {
  id: string;
  workspaceId?: string;
  provider: "meta" | "calendar" | "email" | "sms";
  externalId?: string;
  eventType?: string;
  payload: unknown;
  signatureValid: boolean;
  status: "received" | "processed" | "ignored" | "failed";
  error?: string;
  receivedAt: string;
  processedAt?: string;
}

export interface Integration {
  id: string;
  workspaceId: string;
  provider: "meta" | "calendar" | "email" | "sms";
  status: "connected" | "disconnected" | "error" | "expired";
  metaAdAccountId?: string;
  metaPageId?: string;
  instagramAccountId?: string;
  externalAccountId?: string;
  scopes: string[];
  expiresAt?: string;
  lastSyncedAt?: string;
  lastError?: string;
  createdAt: string;
}

export interface AuditLog {
  id: string;
  workspaceId?: string;
  actorId?: string;
  actorType: "user" | "system" | "automation" | "webhook" | "public";
  action: string;
  entityType: string;
  entityId?: string;
  campaignId?: string;
  before?: unknown;
  after?: unknown;
  createdAt: string;
}

export interface Tables {
  campaigns: Campaign;
  adSets: AdSet;
  ads: Ad;
  creatives: Creative;
  leads: Lead;
  leadEvents: LeadEvent;
  leadScores: LeadScoreRow;
  appointments: Appointment;
  communications: Communication;
  pipelineEvents: PipelineEvent;
  deals: Deal;
  customers: Customer;
  revenue: RevenueRow;
  metrics: MetricRow;
  experiments: Experiment;
  experimentArms: ExperimentArm;
  landingPages: LandingPageRow;
  automationRules: AutomationRule;
  automationRuns: AutomationRun;
  webhookEvents: WebhookEvent;
  integrations: Integration;
  auditLogs: AuditLog;
}
export type TableName = keyof Tables;
