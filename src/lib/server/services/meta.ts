import { appSecretProof } from "../crypto";
import type { Ad, AdSet, Campaign, Creative, Integration, MetricRow, Workspace } from "../entities";
import type { SecretStore } from "../secrets";
import { audit, type Deps } from "./common";

export type MetaErrorKind = "rate_limit" | "auth" | "permission" | "transient" | "invalid" | "unknown";

export class MetaApiError extends Error {
  constructor(
    message: string,
    public readonly kind: MetaErrorKind,
    public readonly status: number,
    public readonly code?: number,
    public readonly subcode?: number,
  ) {
    super(message);
    this.name = "MetaApiError";
  }
  get retryable(): boolean {
    return this.kind === "rate_limit" || this.kind === "transient";
  }
}

/** Map Graph API errors to actions: token problems need reconnecting; rate limits and 5xx can be retried. */
export function classifyMetaError(status: number, body: unknown): MetaApiError {
  const err = (body as { error?: { message?: string; code?: number; error_subcode?: number } } | null)?.error;
  const message = err?.message ?? `Meta API request failed (${status})`;
  const code = err?.code;
  let kind: MetaErrorKind = "unknown";
  if (code === 190 || status === 401) kind = "auth"; // invalid/expired token
  else if (code === 4 || code === 17 || code === 32 || code === 613 || code === 80004 || status === 429) kind = "rate_limit";
  else if (code === 10 || code === 200 || code === 299 || status === 403) kind = "permission";
  else if (code === 1 || code === 2 || status >= 500) kind = "transient";
  else if (status >= 400) kind = "invalid";
  return new MetaApiError(message, kind, status, code, err?.error_subcode);
}

export interface MetaClientOptions {
  token: string;
  appSecret?: string;
  version?: string;
  fetchFn?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  maxRetries?: number;
}

const BASE = "https://graph.facebook.com";

export class MetaClient {
  private readonly version: string;
  private readonly fetchFn: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxRetries: number;
  constructor(private readonly opts: MetaClientOptions) {
    this.version = opts.version ?? "v21.0";
    this.fetchFn = opts.fetchFn ?? fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.maxRetries = opts.maxRetries ?? 3;
  }

  private url(path: string, params: Record<string, string | number | undefined>): string {
    const u = new URL(`${BASE}/${this.version}/${path.replace(/^\//, "")}`);
    for (const [k, v] of Object.entries(params)) if (v !== undefined) u.searchParams.set(k, String(v));
    if (this.opts.appSecret) u.searchParams.set("appsecret_proof", appSecretProof(this.opts.token, this.opts.appSecret));
    return u.toString();
  }

  /** Token goes in the Authorization header, never the URL, so it can't leak into logs or error messages. */
  async request<T>(method: "GET" | "POST", path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
    let attempt = 0;
    for (;;) {
      let res: Response;
      try {
        res = await this.fetchFn(method === "GET" ? this.url(path, params) : this.url(path, {}), {
          method,
          headers: { Authorization: `Bearer ${this.opts.token}`, ...(method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
          body: method === "POST" ? new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])) : undefined,
        });
      } catch (e) {
        const err = new MetaApiError(`Network error calling Meta: ${e instanceof Error ? e.message : String(e)}`, "transient", 0);
        if (attempt++ < this.maxRetries) {
          await this.sleep(2 ** attempt * 500);
          continue;
        }
        throw err;
      }
      let body: unknown = null;
      try {
        body = await res.json();
      } catch {
        /* non-JSON error body */
      }
      if (res.ok) return body as T;
      const err = classifyMetaError(res.status, body);
      if (err.retryable && attempt++ < this.maxRetries) {
        await this.sleep(2 ** attempt * (err.kind === "rate_limit" ? 2000 : 500));
        continue;
      }
      throw err;
    }
  }

  /** Follow paging.next cursors, bounded so a runaway account can't loop forever. */
  async paginate<T>(path: string, params: Record<string, string | number | undefined>, maxPages = 20): Promise<T[]> {
    const out: T[] = [];
    let after: string | undefined;
    for (let page = 0; page < maxPages; page++) {
      const res = await this.request<{ data: T[]; paging?: { cursors?: { after?: string }; next?: string } }>("GET", path, { limit: 200, ...params, after });
      out.push(...res.data);
      if (!res.paging?.next || !res.paging.cursors?.after) break;
      after = res.paging.cursors.after;
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// Read: structure + insights
// ---------------------------------------------------------------------------
export interface MetaCampaign { id: string; name: string; status: string; objective?: string; daily_budget?: string }
export interface MetaAdSet { id: string; name: string; status: string; campaign_id: string; daily_budget?: string }
export interface MetaAd { id: string; name: string; status: string; adset_id: string; campaign_id: string; creative?: { id: string } }
export interface MetaInsight {
  date_start: string;
  ad_id: string;
  adset_id: string;
  campaign_id: string;
  spend?: string;
  impressions?: string;
  reach?: string;
  clicks?: string;
  actions?: Array<{ action_type: string; value: string }>;
}

const acct = (id: string) => (id.startsWith("act_") ? id : `act_${id}`);

export const fetchCampaigns = (c: MetaClient, adAccountId: string) =>
  c.paginate<MetaCampaign>(`${acct(adAccountId)}/campaigns`, { fields: "id,name,status,objective,daily_budget" });
export const fetchAdSets = (c: MetaClient, adAccountId: string) =>
  c.paginate<MetaAdSet>(`${acct(adAccountId)}/adsets`, { fields: "id,name,status,campaign_id,daily_budget" });
export const fetchAds = (c: MetaClient, adAccountId: string) =>
  c.paginate<MetaAd>(`${acct(adAccountId)}/ads`, { fields: "id,name,status,adset_id,campaign_id,creative{id}" });
export const fetchInsights = (c: MetaClient, adAccountId: string, since: string, until: string) =>
  c.paginate<MetaInsight>(`${acct(adAccountId)}/insights`, {
    level: "ad",
    time_increment: 1,
    fields: "ad_id,adset_id,campaign_id,spend,impressions,reach,clicks,actions",
    time_range: JSON.stringify({ since, until }),
  });

/** Platform-reported leads. Prefers the aggregate "lead" action; falls back to on-Facebook lead forms. */
export function leadsFromActions(actions: MetaInsight["actions"]): number {
  if (!actions) return 0;
  const find = (t: string) => actions.find((a) => a.action_type === t);
  const a = find("lead") ?? find("onsite_conversion.lead_grouped") ?? find("offsite_conversion.fb_pixel_lead");
  return a ? Math.round(Number(a.value) || 0) : 0;
}

const mapStatus = (s: string): Campaign["status"] => (s === "ACTIVE" ? "active" : s === "PAUSED" ? "paused" : s === "ARCHIVED" || s === "DELETED" ? "archived" : "draft");
const cents = (v?: string) => (v ? Number(v) / 100 : undefined);

export interface SyncResult {
  ok: boolean;
  campaigns: number;
  adSets: number;
  ads: number;
  metricRows: number;
  error?: { kind: MetaErrorKind; message: string };
}

export async function getMetaIntegration(deps: Deps, ws: Workspace): Promise<Integration | null> {
  const [i] = await deps.repo.list("integrations", ws.id, { where: { provider: "meta" }, limit: 1 });
  return i ?? null;
}

/**
 * Pull structure + daily ad-level insights and upsert them. Never throws: failures are classified, stored on the
 * integration (so the UI can say "reconnect Meta" or "retrying"), audited and returned.
 */
export async function syncMeta(
  deps: Deps,
  ws: Workspace,
  opts: { secrets: SecretStore; appSecret?: string; version?: string; fetchFn?: typeof fetch; sleep?: (ms: number) => Promise<void>; since: string; until: string },
): Promise<SyncResult> {
  const result: SyncResult = { ok: false, campaigns: 0, adSets: 0, ads: 0, metricRows: 0 };
  const integration = await getMetaIntegration(deps, ws);
  if (!integration || !integration.metaAdAccountId) {
    result.error = { kind: "invalid", message: "Meta is not connected for this workspace." };
    return result;
  }
  const fail = async (e: unknown): Promise<SyncResult> => {
    const err = e instanceof MetaApiError ? e : new MetaApiError(e instanceof Error ? e.message : String(e), "unknown", 0);
    result.error = { kind: err.kind, message: err.message };
    const status: Integration["status"] = err.kind === "auth" ? "expired" : "error";
    await deps.repo.update("integrations", ws.id, integration.id, { status, lastError: `${err.kind}: ${err.message}` });
    await audit(deps, ws.id, { type: "system" }, { action: "meta_sync_failed", entityType: "integrations", entityId: integration.id, after: { kind: err.kind, message: err.message } });
    return result;
  };

  try {
    const token = await opts.secrets.get(ws.id, integration.id);
    if (!token) return await fail(new MetaApiError("No Meta access token stored. Reconnect Meta.", "auth", 401));
    const client = new MetaClient({ token, appSecret: opts.appSecret, version: opts.version, fetchFn: opts.fetchFn, sleep: opts.sleep });
    const accountId = integration.metaAdAccountId;

    const [mCampaigns, mAdSets, mAds] = await Promise.all([fetchCampaigns(client, accountId), fetchAdSets(client, accountId), fetchAds(client, accountId)]);

    const campaignIds = new Map<string, string>();
    for (const mc of mCampaigns) {
      const { row } = await deps.repo.upsertBy("campaigns", ws.id, ["metaCampaignId"], {
        name: mc.name, status: mapStatus(mc.status), objective: mc.objective, dailyBudget: cents(mc.daily_budget), metaCampaignId: mc.id, metaAdAccountId: accountId,
      } as never); // niche/plan are user-owned; sync must not overwrite them
      campaignIds.set(mc.id, row.id);
      result.campaigns++;
    }
    const adSetIds = new Map<string, string>();
    for (const s of mAdSets) {
      const campaignId = campaignIds.get(s.campaign_id);
      if (!campaignId) continue;
      const { row } = await deps.repo.upsertBy("adSets", ws.id, ["metaAdsetId"], { campaignId, name: s.name, status: mapStatus(s.status), dailyBudget: cents(s.daily_budget), metaAdsetId: s.id } as Omit<AdSet, "id" | "createdAt" | "workspaceId">);
      adSetIds.set(s.id, row.id);
      result.adSets++;
    }
    const existingCreatives = await deps.repo.list("creatives", ws.id);
    const adIds = new Map<string, { id: string; adSetId?: string; campaignId?: string; creativeId?: string }>();
    for (const a of mAds) {
      // Link to a creative by Meta creative id; if none exists yet, create one so dashboards work without manual mapping.
      let creative = a.creative?.id ? existingCreatives.find((c) => c.metaCreativeId === a.creative!.id) : undefined;
      if (!creative && a.creative?.id) {
        creative = await deps.repo.insert("creatives", ws.id, { name: a.name, status: "TESTING", campaignId: campaignIds.get(a.campaign_id), metaCreativeId: a.creative.id, launchDate: deps.now().toISOString().slice(0, 10) } as Omit<Creative, "id" | "createdAt" | "workspaceId">);
        existingCreatives.push(creative);
      }
      const { row } = await deps.repo.upsertBy("ads", ws.id, ["metaAdId"], { adSetId: adSetIds.get(a.adset_id), campaignId: campaignIds.get(a.campaign_id), creativeId: creative?.id, name: a.name, status: mapStatus(a.status), metaAdId: a.id } as Omit<Ad, "id" | "createdAt" | "workspaceId">);
      adIds.set(a.id, { id: row.id, adSetId: row.adSetId, campaignId: row.campaignId, creativeId: row.creativeId });
      result.ads++;
    }

    const insights = await fetchInsights(client, accountId, opts.since, opts.until);
    for (const i of insights) {
      const ad = adIds.get(i.ad_id);
      if (!ad) continue;
      await deps.repo.upsertBy("metrics", ws.id, ["date", "adId"], {
        date: i.date_start, adId: ad.id, adSetId: ad.adSetId, campaignId: ad.campaignId, creativeId: ad.creativeId,
        spend: Number(i.spend ?? 0), impressions: Number(i.impressions ?? 0), reach: Number(i.reach ?? 0), clicks: Number(i.clicks ?? 0), platformLeads: leadsFromActions(i.actions), source: "meta",
      } as Omit<MetricRow, "id" | "createdAt" | "workspaceId">);
      result.metricRows++;
    }

    await deps.repo.update("integrations", ws.id, integration.id, { status: "connected", lastSyncedAt: deps.now().toISOString(), lastError: undefined });
    result.ok = true;
    return result;
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------------------
// Write: campaign creation / editing (admin only, always created PAUSED)
// ---------------------------------------------------------------------------
export interface CreateMetaCampaignInput {
  adAccountId: string;
  name: string;
  /** Meta ODAX objective. Leads campaigns use OUTCOME_LEADS. */
  objective?: "OUTCOME_LEADS" | "OUTCOME_TRAFFIC" | "OUTCOME_SALES" | "OUTCOME_AWARENESS" | "OUTCOME_ENGAGEMENT";
  /** Declare honestly. Credit, employment, housing and social-issue ads must set the matching category. */
  specialAdCategories?: Array<"NONE" | "EMPLOYMENT" | "HOUSING" | "CREDIT" | "ISSUES_ELECTIONS_POLITICS">;
}

/** New campaigns are always PAUSED so nothing spends until a human reviews and activates it in Ads Manager or here. */
export async function createMetaCampaign(client: MetaClient, input: CreateMetaCampaignInput): Promise<{ id: string }> {
  return client.request<{ id: string }>("POST", `${acct(input.adAccountId)}/campaigns`, {
    name: input.name,
    objective: input.objective ?? "OUTCOME_LEADS",
    status: "PAUSED",
    special_ad_categories: JSON.stringify(input.specialAdCategories ?? []),
  });
}

export const setMetaStatus = (client: MetaClient, objectId: string, status: "ACTIVE" | "PAUSED") =>
  client.request<{ success: boolean }>("POST", objectId, { status });

export const setMetaDailyBudget = (client: MetaClient, objectId: string, dailyBudgetDollars: number) => {
  if (!Number.isFinite(dailyBudgetDollars) || dailyBudgetDollars < 1) throw new MetaApiError("Daily budget must be at least $1", "invalid", 0);
  return client.request<{ success: boolean }>("POST", objectId, { daily_budget: Math.round(dailyBudgetDollars * 100) });
};
