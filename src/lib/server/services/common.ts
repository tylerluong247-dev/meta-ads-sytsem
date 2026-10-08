import type { Repo } from "../repo";
import type { AuditLog, Role } from "../entities";
import { ROLE_RANK } from "../entities";

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html?: string;
  from: string;
  replyTo?: string;
  /** RFC 8058 one-click unsubscribe headers. */
  unsubscribeUrl?: string;
}
export interface Mailer {
  send(mail: Mail): Promise<{ id: string }>;
}

export interface Deps {
  repo: Repo;
  mailer: Mailer;
  now: () => Date;
  appUrl: string;
}

export class PermissionError extends Error {
  constructor(message = "You do not have permission to do that") {
    super(message);
    this.name = "PermissionError";
  }
}
export class NotFoundError extends Error {
  constructor(what = "Not found") {
    super(what);
    this.name = "NotFoundError";
  }
}
export class ValidationError extends Error {
  constructor(message: string, public readonly fields?: Record<string, string>) {
    super(message);
    this.name = "ValidationError";
  }
}

export interface Actor {
  type: AuditLog["actorType"];
  id?: string;
}

export async function requireRole(repo: Repo, workspaceId: string, userId: string | undefined, min: Role): Promise<Role> {
  if (!userId) throw new PermissionError("Sign in required");
  const role = await repo.getMemberRole(workspaceId, userId);
  if (!role || ROLE_RANK[role] < ROLE_RANK[min]) throw new PermissionError();
  return role;
}

export async function audit(
  deps: Pick<Deps, "repo" | "now">,
  workspaceId: string,
  actor: Actor,
  entry: { action: string; entityType: string; entityId?: string; campaignId?: string; before?: unknown; after?: unknown },
): Promise<void> {
  await deps.repo.insert("auditLogs", workspaceId, {
    actorType: actor.type,
    actorId: actor.id,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    campaignId: entry.campaignId,
    before: entry.before,
    after: entry.after,
    createdAt: deps.now().toISOString(),
  });
}

export async function logEvent(
  deps: Pick<Deps, "repo" | "now">,
  workspaceId: string,
  leadId: string,
  type: string,
  data: Record<string, unknown> = {},
  actorId?: string,
): Promise<void> {
  await deps.repo.insert("leadEvents", workspaceId, { leadId, type, data, actorId, createdAt: deps.now().toISOString() });
}
