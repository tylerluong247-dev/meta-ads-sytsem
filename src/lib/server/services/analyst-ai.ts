import type { Analysis } from "@/lib/core/analyst";
import type { DashboardData } from "./dashboard";
import { env } from "../env";

const money = (n: number | null) => (n === null ? "n/a" : `$${Math.round(n).toLocaleString("en-US")}`);

/** Compact, numeric grounding for the model. It never sees personal lead data, only aggregates. */
export function groundingFor(d: DashboardData): string {
  const k = d.kpis;
  const lines = [
    `Workspace: ${d.workspace.name} (${d.workspace.industry}). Period: ${d.range.label}. View: ${d.mode === "cohort" ? "leads created in period, with their eventual outcomes" : "events occurring in period"}.`,
    `Targets: CPL ${money(d.workspace.targetCpl)}, booked-call cost ${money(d.workspace.targetBookedCallCost)}, CAC ${money(d.workspace.targetCac)}, ROAS ${d.workspace.targetRoas}x, show rate ${(d.workspace.showRate * 100).toFixed(0)}%, close rate ${(d.workspace.closeRate * 100).toFixed(0)}%. Max allowable CAC ${money(d.maxCac)}.`,
    `Totals: spend ${money(k.spend)}, leads ${k.leads}, qualified ${k.qualified}, booked ${k.booked}, shows ${k.shows}, won ${k.won}, revenue ${money(k.revenue)}, CPL ${money(k.cpl)}, cost/qualified ${money(k.costPerQualified)}, cost/booked ${money(k.costPerBooked)}, CAC ${money(k.cac)}, ROAS ${k.roas?.toFixed(2) ?? "n/a"}.`,
    ...d.campaigns.slice(0, 6).map((c) => `Campaign "${c.campaign.name}": spend ${money(c.metrics.spend)}, leads ${c.metrics.leads}, qualified ${c.metrics.qualified}, booked ${c.metrics.booked}, won ${c.metrics.won}, revenue ${money(c.metrics.revenue)}.`),
    ...d.creatives.slice(0, 10).map((c) => `Creative "${c.creative.name}" [${c.creative.status}]: spend ${money(c.metrics.spend)}, leads ${c.metrics.leads}, qualified ${c.metrics.qualified}, booked ${c.metrics.booked}, won ${c.metrics.won}; engine says ${c.recommendation.action} (${c.recommendation.reason}).`),
    `Speed to lead: median ${d.speed.medianMinutes?.toFixed(1) ?? "n/a"} min over ${d.speed.count} leads; ${d.waiting.length} waiting now.`,
    `Rule-based findings: ${d.analysis.findings.map((f) => `[${f.area}/${f.confidence}] ${f.summary} — ${f.evidence}`).join(" | ") || "none"}.`,
    `Sample-size notes: ${d.analysis.sampleNotes.join(" ") || "none"}.`,
    `Budget guidance from the engine: ${d.analysis.budgetGuidance.action} — ${d.analysis.budgetGuidance.reason}`,
  ];
  return lines.join("\n");
}

const SYSTEM = `You are the campaign analyst for a lead-generation agency. You answer using ONLY the numbers provided.
Rules:
- Distinguish problem types: traffic, creative, offer, landing page, lead quality, sales, follow-up, show rate, tracking.
- Respect sample size. With fewer than ~20 leads, ~15 qualified leads, ~8 booked calls or ~10 sales calls, say the evidence is thin and name what to wait for. Never treat 1-2 closed deals as proof.
- Never recommend increasing budget unless the numbers show profitability across at least 3 closed clients and no flagged funnel stage. Prefer "hold" when unsure.
- Judge on cost per qualified lead, cost per booked call, CAC and ROAS, never CPL, CTR or clicks alone.
- Do not invent numbers, benchmarks or causes the data cannot support; say what extra data would settle it.
- Be concise: lead with the answer, then 2-4 bullet reasons, then the next action.`;

export interface AnalystAnswer {
  answer: string;
  source: "model" | "rules";
  note?: string;
}

/** Deterministic answers built straight from the rule-based analysis. Used when no model key is set or the call fails. */
export function answerFromRules(question: string, d: DashboardData): string {
  const q = question.toLowerCase();
  const a: Analysis = d.analysis;
  const lines: string[] = [];
  const findings = (areas: string[]) => a.findings.filter((f) => areas.includes(f.area));

  if (/(pause|kill|cut)/.test(q)) {
    const kills = d.creatives.filter((c) => c.recommendation.action === "KILL");
    lines.push(kills.length ? `Pause: ${kills.map((c) => c.creative.name).join("; ")}.` : "No ad has enough evidence to pause yet.");
    for (const c of kills) lines.push(`- ${c.creative.name}: ${c.recommendation.reason}`);
  } else if (/(scale|more budget|increase)/.test(q)) {
    const scale = d.creatives.filter((c) => c.recommendation.action === "SCALE");
    lines.push(`Budget: ${a.budgetGuidance.action}. ${a.budgetGuidance.reason}`);
    for (const c of scale) lines.push(`- Scale candidate: ${c.creative.name} — ${c.recommendation.reason}`);
    if (!scale.length) lines.push("- No creative has earned a scale call yet.");
  } else if (/(profit|losing|making money|roi|roas)/.test(q)) {
    lines.push(a.headline);
  } else if (/(cpl|cost per lead)/.test(q)) {
    const f = findings(["TRAFFIC", "CREATIVE", "LANDING_PAGE"]);
    lines.push(f.length ? f.map((x) => `${x.summary}: ${x.evidence} ${x.recommendation}`).join("\n") : "CPL is not flagged against your target in this period.");
  } else if (/(book)/.test(q)) {
    const f = findings(["FOLLOW_UP", "OFFER", "LEAD_QUALITY"]);
    lines.push(f.length ? f.map((x) => `${x.summary}: ${x.evidence} ${x.recommendation}`).join("\n") : "Booking rate is not flagged, or there are too few qualified leads to judge.");
  } else if (/(clos|sales)/.test(q)) {
    const f = findings(["SALES", "SHOW_RATE"]);
    lines.push(f.length ? f.map((x) => `${x.summary}: ${x.evidence} ${x.recommendation}`).join("\n") : "Close rate is not flagged, or there are too few sales calls to judge.");
  } else {
    lines.push(a.headline);
    if (a.findings.length) {
      lines.push("What to change, in priority order:");
      for (const f of a.findings) lines.push(`- [${f.area.replace("_", " ").toLowerCase()}, ${f.confidence} confidence] ${f.summary}. ${f.recommendation}`);
    } else lines.push("No funnel stage is flagged against your targets.");
    lines.push(`Budget: ${a.budgetGuidance.action}. ${a.budgetGuidance.reason}`);
  }
  if (a.sampleNotes.length) lines.push("", "Sample size:", ...a.sampleNotes.map((n) => `- ${n}`));
  return lines.join("\n");
}

export async function askAnalyst(question: string, d: DashboardData, fetchFn: typeof fetch = fetch): Promise<AnalystAnswer> {
  const fallback = answerFromRules(question, d);
  if (!env.anthropicKey) return { answer: fallback, source: "rules", note: "Rule-based analysis. Add ANTHROPIC_API_KEY for free-form answers." };
  try {
    const res = await fetchFn("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": env.anthropicKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: "claude-sonnet-5-5", max_tokens: 900, system: SYSTEM, messages: [{ role: "user", content: `DATA\n${groundingFor(d)}\n\nQUESTION\n${question.slice(0, 500)}` }] }),
    });
    if (!res.ok) throw new Error(`Anthropic API ${res.status}`);
    const body = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    const text = body.content?.filter((c) => c.type === "text").map((c) => c.text).join("\n").trim();
    if (!text) throw new Error("Empty model response");
    return { answer: text, source: "model" };
  } catch (e) {
    return { answer: fallback, source: "rules", note: `Model unavailable (${e instanceof Error ? e.message : "error"}); showing rule-based analysis.` };
  }
}
