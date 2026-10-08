"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { CampaignPlan } from "@/lib/core/campaign-plan";
import { Chip, Panel } from "./ui/kit";
import { postAction } from "./ui/post";

export function CampaignBuilder({ slug, defaults }: { slug: string; defaults: { niche: string; city: string; offer: string; monthlyBudget: number; landingPage: string } }) {
  const router = useRouter();
  const [plan, setPlan] = useState<CampaignPlan | null>(null);
  const [brief, setBrief] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const inp = "mt-1 block w-full rounded-md border border-line px-2 py-1.5 text-sm";

  async function generate(f: FormData) {
    setError(null); setSaved(false); setBusy(true);
    const b = {
      niche: String(f.get("niche")), city: String(f.get("city")), offer: String(f.get("offer") ?? ""), targetCustomer: String(f.get("targetCustomer") ?? ""),
      painPoint: String(f.get("painPoint") ?? ""), desiredOutcome: String(f.get("desiredOutcome") ?? ""), monthlyBudget: Number(f.get("monthlyBudget")), landingPage: String(f.get("landingPage") ?? ""),
      conversionEvent: "lead", hasVerifiedCaseStudy: f.get("verified") === "on",
    };
    try {
      const r = await postAction<{ plan: CampaignPlan }>(slug, "campaigns/plan", b);
      setPlan(r.plan); setBrief(b);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not build the plan"); } finally { setBusy(false); }
  }
  async function save(f: FormData) {
    setError(null); setBusy(true);
    try {
      await postAction(slug, "campaigns", { brief, name: String(f.get("name")) });
      setSaved(true); router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save"); } finally { setBusy(false); }
  }
  return (
    <div className="space-y-4">
      <Panel title="Campaign brief">
        <form action={generate} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <label className="text-sm">Niche<input name="niche" required defaultValue={defaults.niche} className={inp} /></label>
          <label className="text-sm">City or service area<input name="city" required defaultValue={defaults.city} className={inp} /></label>
          <label className="text-sm">Monthly budget ($)<input name="monthlyBudget" type="number" min="0" required defaultValue={defaults.monthlyBudget} className={inp} /></label>
          <label className="text-sm sm:col-span-2">Offer<input name="offer" defaultValue={defaults.offer} className={inp} placeholder="Free roof inspection and written estimate" /></label>
          <label className="text-sm">Landing page<input name="landingPage" defaultValue={defaults.landingPage} className={inp} placeholder="/roofing" /></label>
          <label className="text-sm">Target customer<input name="targetCustomer" className={inp} placeholder="Homeowners with roofs over 15 years old" /></label>
          <label className="text-sm">Pain point<input name="painPoint" className={inp} placeholder="Leaks and surprise repair bills" /></label>
          <label className="text-sm">Desired outcome<input name="desiredOutcome" className={inp} placeholder="A clear estimate without pressure" /></label>
          <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" name="verified" /> I have a real, permitted case study to reference (otherwise that angle is skipped)</label>
          <div className="flex items-end"><button disabled={busy} className="rounded-md bg-tide px-3 py-2 text-sm font-medium text-white disabled:opacity-50">Build campaign plan</button></div>
        </form>
      </Panel>
      {error && <p role="alert" className="rounded-md bg-bad-bg px-3 py-2 text-sm text-bad">{error}</p>}
      {plan && (
        <>
          {plan.warnings.length > 0 && <ul className="rounded-md bg-warn-bg px-3 py-2 text-sm text-warn">{plan.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
          <div className="grid gap-4 xl:grid-cols-2">
            <Panel title="Structure"><ul className="list-disc space-y-1 pl-5 text-sm">{plan.structure.map((s) => <li key={s}>{s}</li>)}</ul>
              <h3 className="mt-3 text-sm font-semibold">Ad sets</h3>
              <ul className="mt-1 space-y-2 text-sm">{plan.adSets.map((a) => <li key={a.name}><strong>{a.name}</strong> · ${a.dailyBudget}/day<p className="text-ink-soft">{a.audience}. {a.notes}</p></li>)}</ul></Panel>
            <Panel title="Qualification questions"><ul className="space-y-2 text-sm">{plan.qualificationQuestions.map((q) => <li key={q.question}><strong>{q.question}</strong><p className="text-ink-soft">{q.why}{q.conditional ? ` (${q.conditional})` : ""}</p></li>)}</ul>
              <h3 className="mt-3 text-sm font-semibold">Testing plan</h3><ul className="mt-1 list-disc space-y-1 pl-5 text-sm">{plan.testingPlan.map((t) => <li key={t}>{t}</li>)}</ul></Panel>
          </div>
          <Panel title={`Ad concepts (${plan.concepts.length})`}>
            <div className="grid gap-3 lg:grid-cols-2">
              {plan.concepts.map((c) => (
                <article key={c.name} className="rounded-md border border-line p-3 text-sm">
                  <header className="mb-1 flex items-center justify-between gap-2"><h3 className="font-semibold">{c.name}</h3><Chip tone={c.complianceIssues.length ? "bad" : "good"}>{c.complianceIssues.length ? "copy needs fixing" : "copy check passed"}</Chip></header>
                  <p className="text-xs text-ink-soft">{c.angle.replace("_", " ")} · {c.format} · {Math.round(c.budgetShare * 100)}% of budget · CTA: {c.cta}</p>
                  <p className="mt-2 font-medium">{c.headline}</p><p className="whitespace-pre-line">{c.primaryText}</p>
                  {c.complianceIssues.map((i) => <p key={i.rule} className="mt-1 text-xs text-bad">{i.rule}: “{i.match}”. {i.suggestion}</p>)}
                </article>
              ))}
            </div>
          </Panel>
          <Panel title="Save as draft">
            {saved ? <p role="status" className="text-sm text-good">Saved. The campaign and its creatives are now in your lists, ready to launch in Ads Manager.</p> : (
              <form action={save} className="flex flex-wrap items-end gap-2"><label className="text-sm">Campaign name<input name="name" required minLength={2} defaultValue={`${String(brief?.niche ?? "")} leads – ${String(brief?.city ?? "")}`} className={`${inp} w-72`} /></label><button disabled={busy} className="rounded-md bg-tide px-3 py-2 text-sm font-medium text-white disabled:opacity-50">Save draft campaign</button></form>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}
