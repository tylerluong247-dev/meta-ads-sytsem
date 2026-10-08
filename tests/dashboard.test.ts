import { describe, expect, it, vi } from "vitest";
import { resolveRange, previousRange } from "@/lib/core/dates";
import { recommendCreative } from "@/lib/core/creatives";
import { parseDashboardParams } from "@/lib/server/dashboard-params";
import { assertSameOrigin } from "@/lib/server/api/http";
import { getDashboard } from "@/lib/server/services/dashboard";
import { buildRollup } from "@/lib/server/services/rollup";
import { NOW, seededDeps } from "./helpers";

describe("date presets", () => {
  it("resolves presets in the workspace time zone and chains a previous period of equal length", () => {
    const r = resolveRange("last_7_days", NOW, -240);
    expect(r.to.getTime() - r.from.getTime()).toBe(7 * 86400000);
    const p = previousRange(r);
    expect(p.to.getTime()).toBe(r.from.getTime());
    expect(p.to.getTime() - p.from.getTime()).toBe(7 * 86400000);
    const y = resolveRange("yesterday", NOW, 0);
    expect(y.to.getTime() - y.from.getTime()).toBe(86400000);
    expect(resolveRange("this_month", NOW, 0).from.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(resolveRange("last_month", NOW, 0).from.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(resolveRange("custom", NOW, 0, { from: "2026-09-01", to: "2026-09-10" }).label).toContain("2026-09-01");
  });
  it("rejects reversed or malformed custom ranges", () => {
    expect(() => resolveRange("custom", NOW, 0, { from: "2026-09-10", to: "2026-09-01" })).toThrow();
    expect(() => resolveRange("custom", NOW, 0, { from: "nope", to: "2026-09-01" })).toThrow();
  });
  it("dashboard params fall back safely on junk input and only accept uuid filters", () => {
    const p = parseDashboardParams({ range: "custom", from: "bad", to: "worse", campaign: "'; drop table", mode: "period", source: "meta" }, NOW, 0);
    expect(p.error).toBeTruthy();
    expect(p.preset).toBe("custom");
    expect(p.filters.campaignId).toBeUndefined();
    expect(p.filters.source).toBe("meta");
    expect(p.mode).toBe("period");
    expect(parseDashboardParams({ range: "bogus" }, NOW, 0).preset).toBe("last_30_days");
  });
});

describe("dashboard rollups", () => {
  it("cohort mode follows leads created in range to their outcomes; period mode counts events in range", async () => {
    const { deps, roofing } = await seededDeps();
    const range = resolveRange("last_7_days", NOW);
    const cohort = await buildRollup(deps.repo, roofing.id, { range, mode: "cohort" });
    const period = await buildRollup(deps.repo, roofing.id, { range, mode: "period" });
    expect(cohort.total.leads).toBe(period.total.leads); // both count leads created in range
    expect(cohort.total.spend).toBe(period.total.spend);
    expect(cohort.total.won).toBeLessThanOrEqual(58);
  });

  it("a wider range never has fewer leads than a narrower one", async () => {
    const { deps, roofing } = await seededDeps();
    const a = await buildRollup(deps.repo, roofing.id, { range: resolveRange("last_7_days", NOW) });
    const b = await buildRollup(deps.repo, roofing.id, { range: resolveRange("last_30_days", NOW) });
    expect(b.total.leads).toBeGreaterThanOrEqual(a.total.leads);
    expect(b.total.spend).toBeGreaterThanOrEqual(a.total.spend);
  });

  it("filters by campaign and creative; stage counts are monotonic down the funnel", async () => {
    const { deps, roofing } = await seededDeps();
    const [creative] = await deps.repo.list("creatives", roofing.id, { limit: 1 });
    const range = resolveRange("last_30_days", NOW);
    const all = await buildRollup(deps.repo, roofing.id, { range });
    const one = await buildRollup(deps.repo, roofing.id, { range, filters: { creativeId: creative!.id } });
    expect(one.total.leads).toBeLessThanOrEqual(all.total.leads);
    for (const t of [all.total, one.total]) {
      expect(t.qualified).toBeLessThanOrEqual(t.leads);
      expect(t.booked).toBeLessThanOrEqual(t.qualified);
      expect(t.shows).toBeLessThanOrEqual(t.booked);
      expect(t.won).toBeLessThanOrEqual(t.shows);
    }
    const sumCreatives = Object.values(all.byCreative).reduce((s, c) => s + c.leads, 0);
    expect(sumCreatives).toBe(all.total.leads);
  });

  it("does not show another workspace's numbers", async () => {
    const { deps, roofing, hvac } = await seededDeps();
    const r = await getDashboard(deps, roofing, { range: resolveRange("last_30_days", NOW) });
    const h = await getDashboard(deps, hvac, { range: resolveRange("last_30_days", NOW) });
    expect(r.kpis.revenue).toBe(10491);
    expect(h.kpis.revenue).toBe(0);
    expect(h.campaigns.every((c) => c.campaign.name !== "Roofing Lead Generation")).toBe(true);
  });
});

describe("creative recommendations are sample-size aware", () => {
  const targets = { targetCac: 1000, targetCpl: 40, targetBookedCallCost: 150, targetRoas: 3, closeRate: 0.25, showRate: 0.7, qualifiedRate: 0.35, bookedRate: 0.5 };
  const row = (counts: Partial<Record<"spend" | "leads" | "qualified" | "booked" | "shows" | "won" | "revenue", number>>) => ({ id: "c", name: "c", status: "TESTING" as const, counts: { spend: 0, leads: 0, qualified: 0, booked: 0, shows: 0, won: 0, revenue: 0, ...counts } });
  it("does not kill on a little spend, but kills after real spend with zero qualified leads", () => {
    expect(recommendCreative(row({ spend: 50, leads: 1 }), [], targets).action).not.toBe("KILL");
    expect(recommendCreative(row({ spend: 600, leads: 14, qualified: 0 }), [], targets).action).toBe("KILL");
  });
  it("scales only a creative that has produced revenue at an acceptable CAC", () => {
    expect(recommendCreative(row({ spend: 900, leads: 30, qualified: 12, booked: 7, shows: 5, won: 2, revenue: 7000 }), [], targets).action).toBe("SCALE");
    expect(recommendCreative(row({ spend: 120, leads: 6, qualified: 3 }), [], targets).action).not.toBe("SCALE");
  });
  it("a cheap-lead creative that never qualifies is not rewarded", () => {
    expect(recommendCreative(row({ spend: 500, leads: 50, qualified: 0 }), [], targets).action).toBe("KILL");
  });
});

describe("request safety", () => {
  const req = (headers: Record<string, string>) => new Request("http://localhost:3000/api/app/x/y", { method: "POST", headers });
  it("blocks cross-origin and non-JSON mutations", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.scalewaves.test");
    expect(() => assertSameOrigin(req({ origin: "https://evil.example", host: "app.scalewaves.test", "content-type": "application/json" }))).toThrow(/Cross-origin/);
    expect(() => assertSameOrigin(req({ origin: "https://app.scalewaves.test", host: "app.scalewaves.test", "content-type": "application/json" }))).not.toThrow();
    expect(() => assertSameOrigin(req({ origin: "https://app.scalewaves.test", host: "app.scalewaves.test", "content-type": "text/plain" }))).toThrow(/Content-Type/);
    vi.unstubAllEnvs();
  });
});

describe("rate limiter", () => {
  it("allows up to the limit per key per window, then recovers", async () => {
    const { RateLimiter } = await import("@/lib/server/ratelimit");
    const rl = new RateLimiter(3, 1000);
    expect([1, 2, 3, 4].map(() => rl.allow("ip", 0))).toEqual([true, true, true, false]);
    expect(rl.allow("other", 0)).toBe(true);
    expect(rl.allow("ip", 1001)).toBe(true);
  });
});
