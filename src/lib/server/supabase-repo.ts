import type { SupabaseClient } from "@supabase/supabase-js";
import type { LeadAttribution, Touch } from "@/lib/core/attribution";
import type { Lead, Role, TableName, Workspace } from "./entities";
import { UniqueViolation, type ListOptions, type NewRow, type Repo, type RowOf } from "./repo";

const TABLE_MAP: Record<TableName, string> = {
  campaigns: "campaigns",
  adSets: "ad_sets",
  ads: "ads",
  creatives: "creatives",
  leads: "leads",
  leadEvents: "lead_events",
  leadScores: "lead_scores",
  appointments: "appointments",
  communications: "communications",
  pipelineEvents: "pipeline_events",
  deals: "deals",
  customers: "customers",
  revenue: "revenue",
  metrics: "metrics",
  experiments: "experiments",
  experimentArms: "experiment_arms",
  landingPages: "landing_pages",
  automationRules: "automation_rules",
  automationRuns: "automation_runs",
  webhookEvents: "webhook_events",
  integrations: "integrations",
  auditLogs: "audit_logs",
};

/** Tables whose rows have no created_at column (they use received_at or have no timestamp of their own). */
const NO_CREATED_AT: TableName[] = ["metrics", "webhookEvents"];
/** Columns that Postgres generates; never send them. */
const GENERATED: Partial<Record<TableName, string[]>> = { deals: ["contract_value"] };

const toSnake = (s: string) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const toCamel = (s: string) => s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

function rowToDomain<T>(row: Record<string, unknown>): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v === null) continue; // null -> undefined
    // Postgres numeric columns arrive as strings through PostgREST in some configs; coerce numerics safely.
    out[toCamel(k)] = v;
  }
  return out as T;
}

/** On insert/upsert, undefined means "not provided". On update, an explicit undefined clears the column (matches MemoryRepo). */
function domainToRow(table: TableName, obj: Record<string, unknown>, clearUndefined = false): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const generated = GENERATED[table] ?? [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined && !clearUndefined) continue;
    const col = toSnake(k);
    if (generated.includes(col)) continue;
    out[col] = v === undefined ? null : v;
  }
  if (NO_CREATED_AT.includes(table)) delete out.created_at;
  return out;
}

const NUMERIC_FIELDS = new Set([
  "avgClientValue", "grossMargin", "desiredProfitMargin", "targetCac", "targetCpl", "targetBookedCallCost", "targetRoas",
  "closeRate", "showRate", "qualifiedRate", "bookedRate", "monthlyAdBudget", "monthlyRevenueTarget",
  "clientValue", "initialPayment", "recurringPayment", "oneTimeFees", "contractValue", "spend", "dailyBudget",
  "impressions", "reach", "clicks",
]);
function coerceNumbers<T extends object>(o: T): T {
  const r = o as Record<string, unknown>;
  for (const k of Object.keys(r)) if (NUMERIC_FIELDS.has(k) && typeof r[k] === "string") r[k] = Number(r[k]);
  return o;
}

const TOUCH_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "meta_campaign_id", "meta_adset_id", "meta_ad_id", "fbclid", "landing_page", "referrer"] as const;

function touchToRow(workspaceId: string, leadId: string, touch: "first" | "last", t: Touch) {
  const row: Record<string, unknown> = { workspace_id: workspaceId, lead_id: leadId, touch, occurred_at: t.at ?? new Date().toISOString() };
  for (const k of TOUCH_KEYS) if (t[k]) row[k] = t[k];
  return row;
}
function rowToTouch(r: Record<string, unknown>): Touch {
  const t: Touch = { at: String(r.occurred_at ?? "") };
  for (const k of TOUCH_KEYS) if (r[k]) t[k] = String(r[k]);
  return t;
}

export class SupabaseRepo implements Repo {
  constructor(private readonly db: SupabaseClient) {}

  private fail(table: string, error: { code?: string; message: string }): never {
    if (error.code === "23505") throw new UniqueViolation(table, error.message);
    throw new Error(`${table}: ${error.message}`);
  }

  async getWorkspaceBySlug(slug: string) {
    const { data, error } = await this.db.from("workspaces").select("*").eq("slug", slug).maybeSingle();
    if (error) this.fail("workspaces", error);
    return data ? coerceNumbers(rowToDomain<Workspace>(data)) : null;
  }

  async listAllWorkspaces() {
    const { data, error } = await this.db.from("workspaces").select("*");
    if (error) this.fail("workspaces", error);
    return (data ?? []).map((r) => coerceNumbers(rowToDomain<Workspace>(r)));
  }

  async getWorkspace(id: string) {
    const { data, error } = await this.db.from("workspaces").select("*").eq("id", id).maybeSingle();
    if (error) this.fail("workspaces", error);
    return data ? coerceNumbers(rowToDomain<Workspace>(data)) : null;
  }

  async listWorkspacesForUser(userId: string) {
    const { data, error } = await this.db.from("workspace_members").select("role, workspaces(*)").eq("user_id", userId);
    if (error) this.fail("workspace_members", error);
    return (data ?? []).flatMap((m) => {
      const ws = (m as unknown as { workspaces: Record<string, unknown> | null }).workspaces;
      return ws ? [{ workspace: coerceNumbers(rowToDomain<Workspace>(ws)), role: (m as { role: Role }).role }] : [];
    });
  }

  async getMemberRole(workspaceId: string, userId: string) {
    const { data, error } = await this.db.from("workspace_members").select("role").eq("workspace_id", workspaceId).eq("user_id", userId).maybeSingle();
    if (error) this.fail("workspace_members", error);
    return (data?.role as Role | undefined) ?? null;
  }

  async createWorkspace(input: Pick<Workspace, "name" | "slug" | "industry"> & Partial<Workspace>, ownerId: string) {
    const { id: _i, createdAt: _c, ...rest } = input as Workspace;
    void _i; void _c;
    const { data, error } = await this.db.from("workspaces").insert({ ...domainToRow("campaigns", rest as unknown as Record<string, unknown>), created_by: ownerId }).select("*").single();
    if (error) this.fail("workspaces", error);
    const ws = coerceNumbers(rowToDomain<Workspace>(data!));
    const { error: mErr } = await this.db.from("workspace_members").insert({ workspace_id: ws.id, user_id: ownerId, role: "owner" });
    if (mErr) {
      await this.db.from("workspaces").delete().eq("id", ws.id); // don't leave an ownerless workspace behind
      this.fail("workspace_members", mErr);
    }
    return ws;
  }

  async updateWorkspace(id: string, patch: Partial<Workspace>) {
    const { id: _ignore, createdAt: _c, ...rest } = patch;
    void _ignore; void _c;
    const { data, error } = await this.db.from("workspaces").update(domainToRow("campaigns", rest as Record<string, unknown>, true)).eq("id", id).select("*").single();
    if (error) this.fail("workspaces", error);
    return coerceNumbers(rowToDomain<Workspace>(data!));
  }

  private async attachAttribution(workspaceId: string, leads: Lead[]): Promise<Lead[]> {
    if (leads.length === 0) return leads;
    const byLead = new Map<string, LeadAttribution>();
    for (let i = 0; i < leads.length; i += 200) {
      const ids = leads.slice(i, i + 200).map((l) => l.id);
      const { data, error } = await this.db.from("attribution").select("*").eq("workspace_id", workspaceId).in("lead_id", ids);
      if (error) this.fail("attribution", error);
      for (const r of data ?? []) {
        const cur = byLead.get(r.lead_id as string) ?? { first: {}, last: {} };
        cur[r.touch as "first" | "last"] = rowToTouch(r);
        byLead.set(r.lead_id as string, cur);
      }
    }
    return leads.map((l) => ({ ...l, attribution: byLead.get(l.id) ?? { first: {}, last: {} } }));
  }

  private async saveAttribution(workspaceId: string, leadId: string, a: LeadAttribution) {
    const rows = [touchToRow(workspaceId, leadId, "first", a.first), touchToRow(workspaceId, leadId, "last", a.last)];
    const { error } = await this.db.from("attribution").upsert(rows, { onConflict: "lead_id,touch" });
    if (error) this.fail("attribution", error);
  }

  async list<T extends TableName>(table: T, workspaceId: string, opts: ListOptions<T> = {}): Promise<RowOf<T>[]> {
    let q = this.db.from(TABLE_MAP[table]).select("*").eq("workspace_id", workspaceId);
    for (const [k, v] of Object.entries(opts.where ?? {})) if (v !== undefined) q = q.eq(toSnake(k), v as never);
    if (opts.range) {
      const col = toSnake(opts.range.field);
      if (opts.range.from !== undefined) q = q.gte(col, opts.range.from);
      if (opts.range.to !== undefined) q = q.lt(col, opts.range.to);
    }
    if (opts.orderBy) q = q.order(toSnake(opts.orderBy.field), { ascending: !opts.orderBy.desc });
    q = q.limit(opts.limit ?? 10000);
    const { data, error } = await q;
    if (error) this.fail(TABLE_MAP[table], error);
    let rows = (data ?? []).map((r) => coerceNumbers(rowToDomain<RowOf<T>>(r)));
    if (table === "leads") rows = (await this.attachAttribution(workspaceId, rows as unknown as Lead[])) as unknown as RowOf<T>[];
    return rows;
  }

  async get<T extends TableName>(table: T, workspaceId: string, id: string) {
    const { data, error } = await this.db.from(TABLE_MAP[table]).select("*").eq("workspace_id", workspaceId).eq("id", id).maybeSingle();
    if (error) this.fail(TABLE_MAP[table], error);
    if (!data) return null;
    let row = coerceNumbers(rowToDomain<RowOf<T>>(data));
    if (table === "leads") row = (await this.attachAttribution(workspaceId, [row as unknown as Lead]))[0] as unknown as RowOf<T>;
    return row;
  }

  async insert<T extends TableName>(table: T, workspaceId: string, row: NewRow<T>) {
    const { attribution, ...rest } = row as unknown as Record<string, unknown> & { attribution?: LeadAttribution };
    const payload = { ...domainToRow(table, rest), workspace_id: workspaceId };
    const { data, error } = await this.db.from(TABLE_MAP[table]).insert(payload).select("*").single();
    if (error) this.fail(TABLE_MAP[table], error);
    const created = coerceNumbers(rowToDomain<RowOf<T>>(data!));
    if (table === "leads" && attribution) {
      await this.saveAttribution(workspaceId, (created as unknown as Lead).id, attribution);
      (created as unknown as Lead).attribution = attribution;
    }
    return created;
  }

  async update<T extends TableName>(table: T, workspaceId: string, id: string, patch: Partial<RowOf<T>>) {
    const { attribution, id: _id, workspaceId: _ws, ...rest } = patch as unknown as Record<string, unknown> & { attribution?: LeadAttribution };
    void _id; void _ws;
    const payload = domainToRow(table, rest, true);
    let row: RowOf<T>;
    if (Object.keys(payload).length > 0) {
      const { data, error } = await this.db.from(TABLE_MAP[table]).update(payload).eq("workspace_id", workspaceId).eq("id", id).select("*").single();
      if (error) this.fail(TABLE_MAP[table], error);
      row = coerceNumbers(rowToDomain<RowOf<T>>(data!));
    } else {
      const cur = await this.get(table, workspaceId, id);
      if (!cur) throw new Error(`${table} ${id} not found in workspace`);
      row = cur;
    }
    if (table === "leads" && attribution) {
      await this.saveAttribution(workspaceId, id, attribution);
      (row as unknown as Lead).attribution = attribution;
    } else if (table === "leads") {
      row = (await this.attachAttribution(workspaceId, [row as unknown as Lead]))[0] as unknown as RowOf<T>;
    }
    return row;
  }

  async increment<T extends TableName>(table: T, workspaceId: string, id: string, field: string, by: number) {
    const { error } = await this.db.rpc("increment_counter", { p_table: TABLE_MAP[table], p_workspace: workspaceId, p_id: id, p_column: toSnake(field), p_by: by });
    if (error) this.fail(TABLE_MAP[table], error);
  }

  async remove<T extends TableName>(table: T, workspaceId: string, id: string) {
    const { error } = await this.db.from(TABLE_MAP[table]).delete().eq("workspace_id", workspaceId).eq("id", id);
    if (error) this.fail(TABLE_MAP[table], error);
  }

  async upsertBy<T extends TableName>(table: T, workspaceId: string, keyFields: Array<keyof RowOf<T> & string>, row: Omit<RowOf<T>, "id" | "createdAt" | "workspaceId">) {
    const payload = { ...domainToRow(table, row as Record<string, unknown>), workspace_id: workspaceId };
    const keys = ["workspace_id", ...keyFields.map(toSnake)];
    // Detect create vs update by checking existence first (upsert alone doesn't say which happened).
    let probe = this.db.from(TABLE_MAP[table]).select("id").eq("workspace_id", workspaceId);
    for (const k of keyFields) probe = probe.eq(toSnake(k), (row as Record<string, unknown>)[k] as never);
    const { data: existing, error: pErr } = await probe.maybeSingle();
    if (pErr) this.fail(TABLE_MAP[table], pErr);
    const { data, error } = await this.db.from(TABLE_MAP[table]).upsert(payload, { onConflict: keys.join(",") }).select("*").single();
    if (error) this.fail(TABLE_MAP[table], error);
    return { row: coerceNumbers(rowToDomain<RowOf<T>>(data!)), created: !existing };
  }
}
