import { describe, expect, it } from "vitest";
import { resolveRange } from "@/lib/core/dates";
import { computeMetrics } from "@/lib/core/metrics";
import { buildRollup } from "@/lib/server/services/rollup";
import { getDashboard } from "@/lib/server/services/dashboard";
import { NOW, seededDeps } from "./helpers";

describe("demo seed data", () => {
  it("matches the spec example: $2,000 → 58 leads → 24 qualified → 14 booked → 10 shows → 3 clients → $10,491", async () => {
    const { deps, roofing } = await seededDeps();
    const roll = await buildRollup(deps.repo, roofing.id, { range: resolveRange("last_30_days", NOW) });
    expect(roll.total).toMatchObject({ spend: 2000, leads: 58, qualified: 24, booked: 14, shows: 10, won: 3, revenue: 10491 });
    const m = computeMetrics(roll.total);
    expect(Math.round(m.cac!)).toBe(667);
    expect(m.roas!).toBeCloseTo(5.2455, 3);
    expect(m.rates.leadToQualified).toBeCloseTo(24 / 58, 5);
  });

  it("dashboard computes KPIs, per-creative recommendations and speed-to-lead alerts", async () => {
    const { deps, roofing } = await seededDeps();
    const d = await getDashboard(deps, roofing, { range: resolveRange("last_30_days", NOW) });
    expect(d.headline.status).toBe("PROFITABLE");
    expect(d.campaigns[0]?.campaign.name).toBe("Roofing Lead Generation");
    expect(d.creatives.length).toBe(4);
    expect(d.waiting.length).toBe(2);
    expect(d.alerts.some((a) => a.id.startsWith("speed:"))).toBe(true);
  });

  it("flags the HVAC test as burning money with zero qualified leads", async () => {
    const { deps, hvac } = await seededDeps();
    const d = await getDashboard(deps, hvac, { range: resolveRange("last_30_days", NOW) });
    expect(d.alerts.some((a) => a.id.startsWith("noqual:") && a.severity === "critical")).toBe(true);
    expect(d.analysis.budgetGuidance.action).not.toBe("INCREASE");
  });
});
