import { Fragment } from "react";
import { notFound } from "next/navigation";
import { LeadActions } from "@/components/lead-actions";
import { Chip, Panel } from "@/components/ui/kit";
import { formatMoney } from "@/lib/core/metrics";
import { formatInZone } from "@/lib/core/booking";
import { pageAccess } from "../../../access";

export const metadata = { title: "Lead" };

export default async function LeadPage({ params }: { params: Promise<{ ws: string; id: string }> }) {
  const { ws, id } = await params;
  const { ws: w, role, readDeps } = await pageAccess(ws);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const lead = await readDeps.repo.get("leads", w.id, id);
  if (!lead) notFound();
  const [events, appts, comms, deals, scores, campaigns, creatives] = await Promise.all([
    readDeps.repo.list("leadEvents", w.id, { where: { leadId: id }, orderBy: { field: "createdAt", desc: true }, limit: 100 }),
    readDeps.repo.list("appointments", w.id, { where: { leadId: id }, orderBy: { field: "startAt", desc: true } }),
    readDeps.repo.list("communications", w.id, { where: { leadId: id }, orderBy: { field: "createdAt", desc: true }, limit: 50 }),
    readDeps.repo.list("deals", w.id, { where: { leadId: id } }),
    readDeps.repo.list("leadScores", w.id, { where: { leadId: id }, orderBy: { field: "createdAt", desc: true }, limit: 1 }),
    readDeps.repo.list("campaigns", w.id),
    readDeps.repo.list("creatives", w.id),
  ]);
  const canWrite = role !== "viewer";
  const openAppt = appts.find((a) => ["SCHEDULED", "CONFIRMED"].includes(a.status));
  const a = lead.attribution;
  const rows: Array<[string, string | undefined]> = [
    ["Email", lead.email], ["Phone", lead.phone], ["Business", lead.businessName], ["Website", lead.website], ["Location", [lead.city, lead.state].filter(Boolean).join(", ") || undefined],
    ["Monthly revenue", lead.monthlyRevenue], ["Current lead source", lead.currentLeadGenMethod], ["Main problem", lead.primaryProblem], ["Wants", lead.desiredOutcome], ["Budget", lead.budgetRange], ["Timeline", lead.timeline], ["Ready to invest", lead.readyToInvest === undefined ? undefined : lead.readyToInvest ? "Yes" : "No"],
  ];
  const factors = scores[0]?.factors as Array<{ label?: string; points?: number }> | undefined;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold">{lead.firstName} {lead.lastName}</h1>
        <Chip tone="brand">{lead.stage.replace("_", " ").toLowerCase()}</Chip>
        <Chip tone={lead.tier === "HOT" ? "bad" : lead.tier === "WARM" ? "warn" : "neutral"}>{lead.tier.toLowerCase()} · {lead.score}</Chip>
        {lead.optedOutEmail && <Chip tone="bad">unsubscribed</Chip>}
        {lead.disqualifiedReason && <Chip tone="neutral">{lead.disqualifiedReason}</Chip>}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Details">
          <dl className="grid grid-cols-[8rem_1fr] gap-y-1.5 text-sm">{rows.filter(([, v]) => v).map(([k, v]) => <Fragment key={k}><dt className="text-ink-soft">{k}</dt><dd className="break-words">{v}</dd></Fragment>)}</dl>
          {factors && <p className="mt-3 border-t border-line pt-2 text-xs text-ink-soft">Score: {factors.map((f) => `${f.label} ${f.points && f.points > 0 ? "+" : ""}${f.points}`).join(", ")}</p>}
        </Panel>
        <Panel title="Where it came from">
          <dl className="grid grid-cols-[8rem_1fr] gap-y-1.5 text-sm">
            <dt className="text-ink-soft">Source</dt><dd>{lead.source.replace(/_/g, " ")}</dd>
            <dt className="text-ink-soft">Campaign</dt><dd>{campaigns.find((c) => c.id === lead.campaignId)?.name ?? "Not attributed"}</dd>
            <dt className="text-ink-soft">Creative</dt><dd>{creatives.find((c) => c.id === lead.creativeId)?.name ?? "—"}</dd>
            <dt className="text-ink-soft">First touch</dt><dd className="break-all">{[a.first?.utm_source, a.first?.utm_campaign, a.first?.utm_content].filter(Boolean).join(" / ") || "—"}</dd>
            <dt className="text-ink-soft">Last touch</dt><dd className="break-all">{[a.last?.utm_source, a.last?.utm_campaign, a.last?.utm_content].filter(Boolean).join(" / ") || "—"}</dd>
            <dt className="text-ink-soft">Created</dt><dd className="num">{formatInZone(lead.createdAt, w.timezone)}</dd>
            <dt className="text-ink-soft">First reply</dt><dd className="num">{lead.firstResponseAt ? formatInZone(lead.firstResponseAt, w.timezone) : "Not yet"}</dd>
          </dl>
        </Panel>
      </div>
      {canWrite && (
        <Panel title="Actions">
          <LeadActions slug={w.slug} leadId={lead.id} appointmentId={openAppt?.id} canRespond={!lead.firstResponseAt} canClose={["SHOWED", "PROPOSAL"].includes(lead.stage) && deals.length === 0} />
        </Panel>
      )}
      {deals.map((d) => <Panel key={d.id} title="Deal"><p className="num text-sm">{d.status} · contract value {formatMoney(d.contractValue)} · closed {d.closeDate}{d.salesperson ? ` · ${d.salesperson}` : ""}</p></Panel>)}
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Calls">{appts.length === 0 ? <p className="text-sm text-ink-soft">No calls booked.</p> : <ul className="space-y-1 text-sm">{appts.map((p) => <li key={p.id} className="num">{formatInZone(p.startAt, w.timezone)} <Chip>{p.status.toLowerCase().replace("_", " ")}</Chip></li>)}</ul>}</Panel>
        <Panel title="Messages">{comms.length === 0 ? <p className="text-sm text-ink-soft">Nothing sent yet.</p> : <ul className="space-y-1 text-sm">{comms.map((c) => <li key={c.id}>{c.direction === "inbound" ? "←" : "→"} {c.channel}: {c.subject ?? c.body?.slice(0, 60)} <Chip tone={c.status === "failed" ? "bad" : c.status === "skipped" ? "warn" : "neutral"}>{c.status}{c.skipReason ? `: ${c.skipReason.replace(/_/g, " ")}` : ""}</Chip></li>)}</ul>}</Panel>
      </div>
      <Panel title="Timeline"><ol className="space-y-1 text-sm">{events.map((e) => <li key={e.id} className="flex gap-3"><time className="num w-36 shrink-0 text-ink-soft">{formatInZone(e.createdAt, w.timezone)}</time><span>{e.type.replace(/_/g, " ")}</span></li>)}</ol></Panel>
    </div>
  );
}
