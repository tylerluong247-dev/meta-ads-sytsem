import { AutomationEditor } from "@/components/automation-editor";
import { Chip, Empty, PageTitle, Panel, th, td } from "@/components/ui/kit";
import { ensureDefaultRules } from "@/lib/server/services/followup";
import { pageAccess } from "../../access";

export const metadata = { title: "Follow-up" };

export default async function Automations({ params }: { params: Promise<{ ws: string }> }) {
  const { ws } = await params;
  const { ws: w, role, deps, readDeps } = await pageAccess(ws);
  if (role === "owner" || role === "admin") await ensureDefaultRules(deps, w);
  const [rules, runs, leads] = await Promise.all([
    readDeps.repo.list("automationRules", w.id),
    readDeps.repo.list("automationRuns", w.id, { orderBy: { field: "scheduledFor", desc: true }, limit: 25 }),
    readDeps.repo.list("leads", w.id, { limit: 1000 }),
  ]);
  const name = (id: string) => { const l = leads.find((x) => x.id === id); return l ? `${l.firstName} ${l.lastName ?? ""}`.trim() : id.slice(0, 8); };
  const canEdit = role === "owner" || role === "admin";
  return (
    <div className="space-y-4">
      <PageTitle>Follow-up sequences</PageTitle>
      {!w.postalAddress && <p role="status" className="rounded-md bg-warn-bg px-3 py-2 text-sm text-warn">Add your business mailing address in Settings. Emails are held until it&apos;s set, because marketing email must include one.</p>}
      {rules.length === 0 ? <Empty title="No sequences yet" /> : rules.map((r) => <Panel key={r.id} title={r.name}><AutomationEditor slug={w.slug} rule={r} canEdit={canEdit} /></Panel>)}
      <Panel title="Recent activity">
        {runs.length === 0 ? <p className="text-sm text-ink-soft">Nothing has run yet.</p> : (
          <div className="-m-4 overflow-x-auto"><table className="w-full"><thead><tr><th className={th}>Lead</th><th className={th}>Step</th><th className={th}>Scheduled</th><th className={th}>Result</th></tr></thead>
            <tbody>{runs.map((r) => <tr key={r.id} className="border-t border-line"><td className="px-3 py-2 text-sm">{name(r.leadId)}</td><td className={td}>{r.stepId}</td><td className={td}>{r.scheduledFor.slice(0, 16).replace("T", " ")}</td><td className="px-3 py-2 text-sm"><Chip tone={r.status === "sent" ? "good" : r.status === "failed" ? "bad" : r.status === "skipped" ? "warn" : "neutral"}>{r.status}</Chip> {r.skipReason?.replace(/_/g, " ")} {r.error}</td></tr>)}</tbody></table></div>
        )}
      </Panel>
    </div>
  );
}
