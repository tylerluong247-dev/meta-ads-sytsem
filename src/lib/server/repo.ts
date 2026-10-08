import type { Role, TableName, Tables, Workspace } from "./entities";

export type RowOf<T extends TableName> = Tables[T];
/** A row to insert: server fills id, createdAt and workspaceId. */
export type NewRow<T extends TableName> = Omit<RowOf<T>, "id" | "createdAt" | "workspaceId"> & { id?: string; createdAt?: string };

export interface ListOptions<T extends TableName> {
  where?: Partial<RowOf<T>>;
  /** Inclusive lower / exclusive upper bound on a timestamp-or-date field (ISO strings compare lexicographically). */
  range?: { field: keyof RowOf<T> & string; from?: string; to?: string };
  orderBy?: { field: keyof RowOf<T> & string; desc?: boolean };
  limit?: number;
}

export class UniqueViolation extends Error {
  constructor(public readonly table: string, public readonly key: string) {
    super(`Unique constraint violated on ${table} (${key})`);
    this.name = "UniqueViolation";
  }
}

/**
 * Data access boundary. EVERY method takes a workspaceId, so tenant scoping is enforced in one place and
 * services can't accidentally query across tenants. The Supabase implementation also relies on Postgres RLS
 * as a second, independent layer.
 */
export interface Repo {
  getWorkspaceBySlug(slug: string): Promise<Workspace | null>;
  getWorkspace(id: string): Promise<Workspace | null>;
  /** Cron/system use only (service role). Never expose to request handlers acting for a user. */
  listAllWorkspaces(): Promise<Workspace[]>;
  listWorkspacesForUser(userId: string): Promise<Array<{ workspace: Workspace; role: Role }>>;
  getMemberRole(workspaceId: string, userId: string): Promise<Role | null>;
  updateWorkspace(id: string, patch: Partial<Workspace>): Promise<Workspace>;
  /** Creates the workspace and makes `ownerId` its owner in one step. */
  createWorkspace(input: Pick<Workspace, "name" | "slug" | "industry"> & Partial<Workspace>, ownerId: string): Promise<Workspace>;

  list<T extends TableName>(table: T, workspaceId: string, opts?: ListOptions<T>): Promise<RowOf<T>[]>;
  get<T extends TableName>(table: T, workspaceId: string, id: string): Promise<RowOf<T> | null>;
  insert<T extends TableName>(table: T, workspaceId: string, row: NewRow<T>): Promise<RowOf<T>>;
  update<T extends TableName>(table: T, workspaceId: string, id: string, patch: Partial<RowOf<T>>): Promise<RowOf<T>>;
  /** Atomic numeric increment (page views, spend counters). */
  increment<T extends TableName>(table: T, workspaceId: string, id: string, field: string, by: number): Promise<void>;
  remove<T extends TableName>(table: T, workspaceId: string, id: string): Promise<void>;
  /** Insert-or-update on a natural key (used for metrics sync and webhook idempotency). */
  upsertBy<T extends TableName>(table: T, workspaceId: string, keyFields: Array<keyof RowOf<T> & string>, row: Omit<RowOf<T>, "id" | "createdAt" | "workspaceId">): Promise<{ row: RowOf<T>; created: boolean }>;
}
