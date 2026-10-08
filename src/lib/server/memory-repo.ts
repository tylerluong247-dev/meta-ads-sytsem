import { randomUUID } from "node:crypto";
import type { Role, TableName, Tables, Workspace } from "./entities";
import { UniqueViolation, type ListOptions, type NewRow, type Repo, type RowOf } from "./repo";

type AnyRow = { id: string; workspaceId?: string; createdAt?: string } & Record<string, unknown>;

/** Unique natural keys mirrored from the SQL schema, so tests exercise the same constraints. */
const UNIQUE: Partial<Record<TableName, string[][]>> = {
  leads: [["workspaceId", "dedupeKey"]],
  automationRuns: [["ruleId", "leadId", "stepId"]],
  metrics: [["workspaceId", "date", "adId"]],
  webhookEvents: [["provider", "externalId"]],
  experimentArms: [["experimentId", "arm"]],
  deals: [], // "one won deal per lead" is enforced below
};

/**
 * In-memory Repo for demo mode and tests. Mimics tenant scoping, unique constraints and generated ids.
 */
export class MemoryRepo implements Repo {
  private workspaces = new Map<string, Workspace>();
  private members: Array<{ workspaceId: string; userId: string; role: Role }> = [];
  private tables = new Map<TableName, Map<string, AnyRow>>();

  private t(table: TableName): Map<string, AnyRow> {
    let m = this.tables.get(table);
    if (!m) {
      m = new Map();
      this.tables.set(table, m);
    }
    return m;
  }

  addWorkspace(ws: Workspace, members: Array<{ userId: string; role: Role }> = []): void {
    this.workspaces.set(ws.id, ws);
    for (const m of members) this.members.push({ workspaceId: ws.id, ...m });
  }

  addMember(workspaceId: string, userId: string, role: Role): void {
    this.members.push({ workspaceId, userId, role });
  }

  async getWorkspaceBySlug(slug: string) {
    return [...this.workspaces.values()].find((w) => w.slug === slug) ?? null;
  }
  async listAllWorkspaces() {
    return [...this.workspaces.values()];
  }
  async getWorkspace(id: string) {
    return this.workspaces.get(id) ?? null;
  }
  async listWorkspacesForUser(userId: string) {
    return this.members
      .filter((m) => m.userId === userId)
      .map((m) => ({ workspace: this.workspaces.get(m.workspaceId)!, role: m.role }))
      .filter((x) => x.workspace);
  }
  async getMemberRole(workspaceId: string, userId: string) {
    return this.members.find((m) => m.workspaceId === workspaceId && m.userId === userId)?.role ?? null;
  }
  async createWorkspace(input: Pick<Workspace, "name" | "slug" | "industry"> & Partial<Workspace>, ownerId: string) {
    if ([...this.workspaces.values()].some((w) => w.slug === input.slug)) throw new UniqueViolation("workspaces", "slug");
    const ws: Workspace = {
      timezone: "America/New_York", avgClientValue: 0, grossMargin: 1, desiredProfitMargin: 0.2, targetCac: 0, targetCpl: 0, targetBookedCallCost: 0, targetRoas: 0,
      closeRate: 0.25, showRate: 0.7, qualifiedRate: 0.3, bookedRate: 0.5, avgSalesCycleDays: 14, monthlyAdBudget: 0, monthlyRevenueTarget: 0, scoringConfig: {},
      speedTargetMinutes: 5, speedCriticalMinutes: 15, bookingConfig: {}, ...input, id: randomUUID(), createdAt: new Date().toISOString(),
    };
    this.addWorkspace(ws, [{ userId: ownerId, role: "owner" }]);
    return ws;
  }
  async updateWorkspace(id: string, patch: Partial<Workspace>) {
    const cur = this.workspaces.get(id);
    if (!cur) throw new Error("Workspace not found");
    const next = { ...cur, ...patch, id: cur.id };
    this.workspaces.set(id, next);
    return next;
  }

  async list<T extends TableName>(table: T, workspaceId: string, opts: ListOptions<T> = {}): Promise<RowOf<T>[]> {
    let rows = [...this.t(table).values()].filter((r) => r.workspaceId === workspaceId);
    if (opts.where) {
      for (const [k, v] of Object.entries(opts.where)) rows = rows.filter((r) => r[k] === v);
    }
    if (opts.range) {
      const { field, from, to } = opts.range;
      rows = rows.filter((r) => {
        const v = r[field];
        if (typeof v !== "string") return false;
        return (from === undefined || v >= from) && (to === undefined || v < to);
      });
    }
    if (opts.orderBy) {
      const { field, desc } = opts.orderBy;
      rows.sort((a, b) => {
        const av = String(a[field] ?? "");
        const bv = String(b[field] ?? "");
        return desc ? bv.localeCompare(av) : av.localeCompare(bv);
      });
    }
    if (opts.limit) rows = rows.slice(0, opts.limit);
    return rows.map((r) => structuredClone(r)) as unknown as RowOf<T>[];
  }

  async get<T extends TableName>(table: T, workspaceId: string, id: string) {
    const r = this.t(table).get(id);
    return r && r.workspaceId === workspaceId ? (structuredClone(r) as unknown as RowOf<T>) : null;
  }

  private checkUnique(table: TableName, candidate: AnyRow, ignoreId?: string) {
    for (const key of UNIQUE[table] ?? []) {
      if (key.some((k) => candidate[k] === undefined)) continue;
      const clash = [...this.t(table).values()].find((r) => r.id !== ignoreId && key.every((k) => r[k] === candidate[k]));
      if (clash) throw new UniqueViolation(table, key.join(","));
    }
    if (table === "deals" && candidate.status === "won") {
      const clash = [...this.t("deals").values()].find((r) => r.id !== ignoreId && r.leadId === candidate.leadId && r.status === "won");
      if (clash) throw new UniqueViolation("deals", "leadId (won)");
    }
    if (table === "appointments" && ["SCHEDULED", "CONFIRMED"].includes(String(candidate.status))) {
      const clash = [...this.t("appointments").values()].find(
        (r) => r.id !== ignoreId && r.workspaceId === candidate.workspaceId && r.startAt === candidate.startAt && ["SCHEDULED", "CONFIRMED"].includes(String(r.status)),
      );
      if (clash) throw new UniqueViolation("appointments", "workspaceId,startAt (active)");
    }
  }

  async insert<T extends TableName>(table: T, workspaceId: string, row: NewRow<T>) {
    const full = { id: randomUUID(), createdAt: new Date().toISOString(), ...(row as object), workspaceId } as AnyRow;
    this.checkUnique(table, full);
    this.t(table).set(full.id, full);
    return structuredClone(full) as unknown as RowOf<T>;
  }

  async update<T extends TableName>(table: T, workspaceId: string, id: string, patch: Partial<RowOf<T>>) {
    const cur = this.t(table).get(id);
    if (!cur || cur.workspaceId !== workspaceId) throw new Error(`${table} ${id} not found in workspace`);
    const next = { ...cur, ...(patch as object), id: cur.id, workspaceId: cur.workspaceId } as AnyRow;
    this.checkUnique(table, next, id);
    this.t(table).set(id, next);
    return structuredClone(next) as unknown as RowOf<T>;
  }

  async increment<T extends TableName>(table: T, workspaceId: string, id: string, field: string, by: number) {
    const cur = this.t(table).get(id);
    if (!cur || cur.workspaceId !== workspaceId) throw new Error(`${table} ${id} not found in workspace`);
    cur[field] = Number(cur[field] ?? 0) + by;
  }

  async remove<T extends TableName>(table: T, workspaceId: string, id: string) {
    const cur = this.t(table).get(id);
    if (cur && cur.workspaceId === workspaceId) this.t(table).delete(id);
  }

  async upsertBy<T extends TableName>(table: T, workspaceId: string, keyFields: Array<keyof RowOf<T> & string>, row: Omit<RowOf<T>, "id" | "createdAt" | "workspaceId">) {
    const existing = [...this.t(table).values()].find(
      (r) => r.workspaceId === workspaceId && keyFields.every((k) => r[k] === (row as Record<string, unknown>)[k]),
    );
    if (existing) {
      const updated = await this.update(table, workspaceId, existing.id, row as Partial<RowOf<T>>);
      return { row: updated, created: false };
    }
    return { row: await this.insert(table, workspaceId, row as never), created: true };
  }
}

export type { Tables };
