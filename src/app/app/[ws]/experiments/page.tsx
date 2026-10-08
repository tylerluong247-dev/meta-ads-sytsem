import { NewExperiment, StopExperiment } from "@/components/experiment-controls";
import { Chip, Empty, PageTitle, Panel, th, td } from "@/components/ui/kit";
import { evaluateExperiment, type ArmResult } from "@/lib/core/experiments";
import { formatMoney, formatPct } from "@/lib/core/metrics";
import { NICHES } from "@/lib/landing-content";
import { pageAccess } from "../../access";

export const metadata = { title: "Tests" };

export default async function Experiments({ params }: { params: Promise<{ ws: string }> }) {
  const { ws } = await params;
  const { ws: w, role, readDeps } = await pageAccess(ws);
  const [exps, arms, leads] = await Promise.all([
    readDeps.repo.list("experiments", w.id, { orderBy: { field: "createdAt", desc: true } }),
    readDeps.repo.list("experimentArms", w.id),
    readDeps.repo.list("leads", w.id, { limit: 5000 }),
  ]);
  const deals = await readDeps.repo.list("deals", w.id);
  const dealByLead = new Map(deals.filter((d) => d.status === "won").map((d) => [d.leadId, d.contractValue]));
  const result = (expId: string, arm: "control" | "variant", label: string): ArmResult => {
    const a = arms.find((x) => x.experimentId === expId && x.arm === arm);
    const ls = leads.filter((l) => l.experimentId === expId && l.experimentArm === arm);
    return { label, spend: a?.spend ?? 0, visitors: a?.visitors ?? 0, conversions: ls.length, qualified: ls.filter((l) => l.qualifiedAt).length, booked: ls.filter((l) => l.bookedAt).length, revenue: ls.reduce((s, l) => s + (dealByLead.get(l.id) ?? 0), 0) };
  };
  return (
    <div className="space-y-4">
      <PageTitle>A/B tests</PageTitle>
      {role !== "viewer" && <Panel title="Start a test"><NewExperiment slug={w.slug} pages={Object.keys(NICHES)} /></Panel>}
      {exps.length === 0 ? <Empty title="No tests yet">Visitors are split 50/50 and each person always sees the same version. A winner is only called when there is enough traffic to be confident, judged on qualified leads rather than raw lead count.</Empty> : exps.map((e) => {
        const c = result(e.id, "control", e.controlLabel);
        const v = result(e.id, "variant", e.variantLabel);
        const rep = evaluateExperiment(c, v);
        return (
          <Panel key={e.id} title={<span className="flex items-center gap-2">{e.name}<Chip tone={e.status === "running" ? "brand" : "neutral"}>{e.status}</Chip><span className="text-xs font-normal text-ink-soft">{e.type.replace(/_/g, " ")}</span></span>} aside={role !== "viewer" && e.status === "running" ? <StopExperiment slug={w.slug} id={e.id} /> : undefined}>
            <div className="-m-4 mb-3 overflow-x-auto"><table className="w-full"><thead><tr><th className={th}>Version</th><th className={th}>Visitors</th><th className={th}>Leads</th><th className={th}>Lead rate</th><th className={th}>Qualified</th><th className={th}>Qualified rate</th><th className={th}>Booked</th><th className={th}>Revenue</th></tr></thead>
              <tbody>{[c, v].map((r) => <tr key={r.label} className="border-t border-line"><td className="px-3 py-2 text-sm font-medium">{r.label}</td><td className={td}>{r.visitors}</td><td className={td}>{r.conversions}</td><td className={td}>{formatPct(r.visitors ? r.conversions / r.visitors : null, 1)}</td><td className={td}>{r.qualified}</td><td className={td}>{formatPct(r.visitors ? r.qualified / r.visitors : null, 1)}</td><td className={td}>{r.booked}</td><td className={td}>{formatMoney(r.revenue)}</td></tr>)}</tbody></table></div>
            <p className="mt-6 text-sm"><Chip tone={rep.winner ? "good" : "neutral"}>{rep.winner ? `${rep.winner} wins` : "no winner yet"}</Chip> {rep.summary}</p>
          </Panel>
        );
      })}
    </div>
  );
}
