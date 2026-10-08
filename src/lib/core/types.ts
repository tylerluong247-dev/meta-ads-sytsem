export const PIPELINE_STAGES = [
  "NEW_LEAD",
  "QUALIFIED",
  "BOOKED",
  "CONFIRMED",
  "SHOWED",
  "PROPOSAL",
  "WON",
  "LOST",
] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export const LEAD_TIERS = ["HOT", "WARM", "COLD", "DISQUALIFIED"] as const;
export type LeadTier = (typeof LEAD_TIERS)[number];

export const CREATIVE_STATUSES = ["WINNER", "TESTING", "UNDERPERFORMER", "PAUSED"] as const;
export type CreativeStatus = (typeof CREATIVE_STATUSES)[number];

export const APPOINTMENT_STATUSES = [
  "SCHEDULED",
  "CONFIRMED",
  "SHOWED",
  "NO_SHOW",
  "RESCHEDULED",
  "CANCELLED",
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export type Severity = "info" | "success" | "warning" | "critical";

/** Raw funnel counts for any slice (campaign, ad, creative, workspace, date range). */
export interface FunnelCounts {
  spend: number;
  impressions?: number;
  clicks?: number;
  leads: number;
  qualified: number;
  booked: number;
  shows: number;
  won: number;
  revenue: number;
}

export interface Targets {
  targetCac: number;
  targetCpl: number;
  targetBookedCallCost: number;
  targetRoas: number;
  closeRate: number; // 0..1 show -> close
  showRate: number; // 0..1 booked -> show
  qualifiedRate?: number; // lead -> qualified
  bookedRate?: number; // qualified -> booked
}

export type Rate = number | null;
