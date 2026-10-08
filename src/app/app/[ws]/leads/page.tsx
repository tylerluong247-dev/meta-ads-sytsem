import { Kanban, type CardLead } from "@/components/kanban";
import { Empty, PageTitle } from "@/components/ui/kit";
import { responseMinutes } from "@/lib/core/speed";
import { pageAccess } from "../../access";

export const metadata = { title: "Pipeline" };

export default async function Pipeline({ params }: { params: Promise<{ ws: string }> }) {
  const { ws } = await params;
  const { ws: w, readDeps } = await pageAccess(ws);
  const [leads, campaigns] = await Promise.all([readDeps.repo.list("leads", w.id, { orderBy: { field: "createdAt", desc: true }, limit: 500 }), readDeps.repo.list("campaigns", w.id)]);
  const now = readDeps.now().getTime();
  const cards: CardLead[] = leads.map((l) => ({
    id: l.id,
    name: `${l.firstName} ${l.lastName ?? ""}`.trim(),
    business: l.businessName,
    stage: l.stage,
    tier: l.tier,
    score: l.score,
    source: l.source,
    campaign: campaigns.find((c) => c.id === l.campaignId)?.name,
    nextAction: l.nextAction,
    waitingMinutes: !l.firstResponseAt && l.stage === "NEW_LEAD" && responseMinutes(l.createdAt, new Date(now)) !== null ? (now - new Date(l.createdAt).getTime()) / 60000 : undefined,
    createdAt: l.createdAt,
  }));
  return (
    <>
      <PageTitle>Pipeline</PageTitle>
      {cards.length === 0 ? <Empty title="No leads yet">Leads from your landing pages and Meta lead forms appear here.</Empty> : <Kanban slug={w.slug} initial={cards} />}
    </>
  );
}
