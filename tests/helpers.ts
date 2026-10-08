import { MemoryRepo } from "@/lib/server/memory-repo";
import { OutboxMailer } from "@/lib/server/mailer";
import type { Deps } from "@/lib/server/services/common";
import { demoWorkspace, DEMO_USER_ID, seedDemo } from "@/lib/server/seed";
import type { Workspace } from "@/lib/server/entities";

export const NOW = new Date("2026-10-08T18:00:00.000Z");

export function makeDeps(now: Date = NOW): Deps & { mailer: OutboxMailer; repo: MemoryRepo; clock: { now: Date } } {
  const repo = new MemoryRepo();
  const mailer = new OutboxMailer();
  const clock = { now };
  return { repo, mailer, now: () => clock.now, appUrl: "https://app.test", clock };
}

/** Empty workspace owned by the demo user, for focused service tests. */
export function blankWorkspace(deps: Deps & { repo: MemoryRepo }, partial: Partial<Workspace> = {}): Workspace {
  const ws = demoWorkspace({ id: crypto.randomUUID(), name: "Test Co", slug: "test-co", ...partial });
  deps.repo.addWorkspace(ws, [{ userId: DEMO_USER_ID, role: "owner" }]);
  return ws;
}

export async function seededDeps() {
  const deps = makeDeps();
  await seedDemo(deps.repo, deps);
  const roofing = (await deps.repo.getWorkspaceBySlug("roofing"))!;
  const hvac = (await deps.repo.getWorkspaceBySlug("hvac-test"))!;
  return { deps, roofing, hvac };
}

export const validLead = (slug: string, over: Record<string, unknown> = {}) => ({
  workspaceSlug: slug,
  firstName: "Jamie",
  lastName: "Rivera",
  email: "Jamie@Rivera-Roofing.example",
  phone: "(813) 555-0142",
  businessName: "Rivera Roofing",
  industry: "Roofing",
  city: "Tampa",
  state: "FL",
  monthlyRevenue: "30k_100k",
  budgetRange: "3k_10k",
  timeline: "asap",
  primaryProblem: "Our calendar is inconsistent and we're wasting money on lead lists.",
  readyToInvest: true,
  contactConsent: true,
  ...over,
});
