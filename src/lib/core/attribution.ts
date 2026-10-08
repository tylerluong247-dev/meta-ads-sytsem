export interface Touch {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  meta_campaign_id?: string;
  meta_adset_id?: string;
  meta_ad_id?: string;
  fbclid?: string;
  landing_page?: string;
  referrer?: string;
  at?: string; // ISO timestamp
}

export interface LeadAttribution {
  first: Touch;
  last: Touch;
}

const PARAMS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "fbclid"] as const;

/**
 * Parse a landing URL (or query string) into a touch. Meta can be configured to append
 * {{campaign.id}}, {{adset.id}}, {{ad.id}} to the URL via the URL parameters field, e.g.
 *   utm_source=meta&utm_medium=paid&utm_campaign={{campaign.name}}&utm_content={{ad.name}}
 *   &meta_campaign_id={{campaign.id}}&meta_adset_id={{adset.id}}&meta_ad_id={{ad.id}}
 */
export function parseTouch(urlOrQuery: string, now: Date = new Date(), referrer?: string): Touch {
  let search = urlOrQuery;
  let path: string | undefined;
  try {
    const u = new URL(urlOrQuery, "https://placeholder.invalid");
    search = u.search;
    path = u.pathname;
  } catch {
    /* treat as raw query string */
  }
  const sp = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const touch: Touch = { at: now.toISOString() };
  for (const k of PARAMS) {
    const v = sp.get(k);
    if (v) touch[k] = v.slice(0, 300);
  }
  for (const k of ["meta_campaign_id", "meta_adset_id", "meta_ad_id"] as const) {
    const v = sp.get(k);
    if (v && /^\d{5,25}$/.test(v)) touch[k] = v; // Meta IDs are numeric; ignore templated or junk values
  }
  if (path && path !== "/") touch.landing_page = path;
  if (referrer) touch.referrer = referrer.slice(0, 500);
  return touch;
}

export function hasAttributionSignal(t: Touch): boolean {
  return Boolean(t.utm_source || t.utm_campaign || t.meta_ad_id || t.meta_campaign_id || t.fbclid);
}

/** First touch is immutable once it carries a signal; last touch always follows the newest touch that carries one. */
export function mergeTouches(existing: LeadAttribution | null, incoming: Touch): LeadAttribution {
  if (!existing) return { first: incoming, last: incoming };
  const first = hasAttributionSignal(existing.first) ? existing.first : incoming;
  const last = hasAttributionSignal(incoming) ? incoming : existing.last;
  return { first, last };
}

export type AttributionModel = "first_touch" | "last_touch";

export function pickTouch(a: LeadAttribution, model: AttributionModel): Touch {
  return model === "first_touch" ? a.first : a.last;
}

export interface AttributedRevenueRow {
  campaignId: string | null;
  adId: string | null;
  creativeId: string | null;
  revenue: number;
}

/** Roll deal revenue up by a key (campaign, ad or creative). Unattributed revenue is kept under "unattributed". */
export function revenueBy(rows: AttributedRevenueRow[], key: "campaignId" | "adId" | "creativeId"): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const k = r[key] ?? "unattributed";
    out[k] = (out[k] ?? 0) + r.revenue;
  }
  return out;
}

export interface DealValue {
  initialPayment: number;
  recurringPayment: number; // per month
  recurringMonths: number; // committed months
  oneTimeFees?: number;
}

/** Contract value = initial + committed recurring + one-time fees. First-term revenue counts the committed months only. */
export function contractValue(d: DealValue): number {
  return d.initialPayment + d.recurringPayment * d.recurringMonths + (d.oneTimeFees ?? 0);
}
