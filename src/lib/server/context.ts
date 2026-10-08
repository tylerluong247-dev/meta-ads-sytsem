import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { env } from "./env";
import { MemoryRepo } from "./memory-repo";
import { OutboxMailer, ResendMailer } from "./mailer";
import type { Role, Workspace } from "./entities";
import type { Repo } from "./repo";
import { DEMO_USER_EMAIL, DEMO_USER_ID, seedDemo } from "./seed";
import { MemorySecretStore, SupabaseSecretStore, type SecretStore } from "./secrets";
import { PermissionError, requireRole, type Deps } from "./services/common";
import { SupabaseRepo } from "./supabase-repo";

export interface SessionUser {
  id: string;
  email: string;
}

interface DemoState {
  repo: MemoryRepo;
  mailer: OutboxMailer;
  secrets: MemorySecretStore;
  ready: Promise<void>;
}

const g = globalThis as unknown as { __scalewavesDemo?: DemoState };

/** Demo store lives on globalThis so it survives hot reloads. It resets when the server restarts. */
function demo(): DemoState {
  if (!g.__scalewavesDemo) {
    const repo = new MemoryRepo();
    const mailer = new OutboxMailer();
    const deps: Deps = { repo, mailer, now: () => new Date(), appUrl: env.appUrl };
    g.__scalewavesDemo = { repo, mailer, secrets: new MemorySecretStore("0".repeat(64)), ready: seedDemo(repo, deps) };
  }
  return g.__scalewavesDemo;
}

function serviceClient() {
  return createClient(env.supabaseUrl, env.supabaseServiceKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Service-role access. Server-only. Callers must do their own authorization (see authorize()). */
export async function getServiceDeps(): Promise<Deps> {
  if (env.isDemo) {
    const d = demo();
    await d.ready;
    return { repo: d.repo, mailer: d.mailer, now: () => new Date(), appUrl: env.appUrl };
  }
  return {
    repo: new SupabaseRepo(serviceClient()),
    mailer: env.resendKey ? new ResendMailer(env.resendKey) : new OutboxMailer(),
    now: () => new Date(),
    appUrl: env.appUrl,
  };
}

export function getSecretStore(): SecretStore {
  if (env.isDemo) return demo().secrets;
  if (!env.tokenKey) throw new Error("TOKEN_ENCRYPTION_KEY is required to store provider tokens");
  return new SupabaseSecretStore(serviceClient(), env.tokenKey);
}

async function userClient() {
  const store = await cookies();
  return createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const c of list) store.set(c.name, c.value, c.options);
        } catch {
          /* called from a Server Component: the proxy refreshes sessions instead */
        }
      },
    },
  });
}

export async function getCurrentUser(): Promise<SessionUser | null> {
  if (env.isDemo) return { id: DEMO_USER_ID, email: DEMO_USER_EMAIL };
  const supabase = await userClient();
  const { data } = await supabase.auth.getUser(); // validates the JWT with Supabase, not just the cookie
  return data.user ? { id: data.user.id, email: data.user.email ?? "" } : null;
}

/**
 * Repo for READING dashboard data as the signed-in user: Postgres RLS is the enforcement layer, so even a bug in
 * application code cannot return another tenant's rows. Writes use the service repo after requireRole().
 */
export async function getReadRepo(): Promise<Repo> {
  if (env.isDemo) {
    const d = demo();
    await d.ready;
    return d.repo;
  }
  return new SupabaseRepo(await userClient());
}

export interface Access {
  ws: Workspace;
  role: Role;
  user: SessionUser;
  /** Service-role deps for mutations. Safe to use only because membership was verified above. */
  deps: Deps;
  /** RLS-enforced deps for reads. */
  readDeps: Deps;
}

/** The one door into any workspace: authenticate, resolve by slug, verify role. */
export async function authorize(slug: string, min: Role = "viewer"): Promise<Access> {
  const user = await getCurrentUser();
  if (!user) throw new PermissionError("Sign in required");
  const deps = await getServiceDeps();
  const ws = await deps.repo.getWorkspaceBySlug(slug);
  // Unknown slug and non-member look identical to the caller, so workspace slugs can't be enumerated.
  if (!ws) throw new PermissionError();
  const role = await requireRole(deps.repo, ws.id, user.id, min); // throws PermissionError for non-members, hiding existence as 403
  const readDeps: Deps = { ...deps, repo: await getReadRepo() };
  return { ws, role, user, deps, readDeps };
}

export async function listMyWorkspaces(): Promise<Array<{ workspace: Workspace; role: Role }>> {
  const user = await getCurrentUser();
  if (!user) return [];
  const deps = await getServiceDeps();
  return deps.repo.listWorkspacesForUser(user.id);
}
