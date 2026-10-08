import { DATE_PRESETS, resolveRange, type DatePreset, type DateRange } from "@/lib/core/dates";
import type { RollupFilters, RollupMode } from "./services/rollup";

export type SearchParams = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export interface ParsedParams {
  preset: DatePreset;
  range: DateRange;
  mode: RollupMode;
  filters: RollupFilters;
  from?: string;
  to?: string;
  error?: string;
}

export function parseDashboardParams(sp: SearchParams, now: Date, utcOffsetMinutes: number): ParsedParams {
  const raw = one(sp.range);
  const preset: DatePreset = (DATE_PRESETS as readonly string[]).includes(raw ?? "") ? (raw as DatePreset) : "last_30_days";
  const from = one(sp.from);
  const to = one(sp.to);
  let range: DateRange;
  let error: string | undefined;
  try {
    range = resolveRange(preset, now, utcOffsetMinutes, preset === "custom" && from && to ? { from, to } : undefined);
  } catch (e) {
    error = e instanceof Error ? e.message : "Invalid date range";
    range = resolveRange("last_30_days", now, utcOffsetMinutes);
  }
  const uuid = /^[0-9a-f-]{36}$/i;
  const filters: RollupFilters = {};
  const campaign = one(sp.campaign);
  const creative = one(sp.creative);
  if (campaign && uuid.test(campaign)) filters.campaignId = campaign;
  if (creative && uuid.test(creative)) filters.creativeId = creative;
  const landing = one(sp.landing);
  const source = one(sp.source);
  const niche = one(sp.niche);
  if (landing) filters.landingPage = landing.slice(0, 100);
  if (source) filters.source = source.slice(0, 100);
  if (niche) filters.niche = niche.slice(0, 100);
  return { preset, range, mode: one(sp.mode) === "period" ? "period" : "cohort", filters, from, to, error };
}
