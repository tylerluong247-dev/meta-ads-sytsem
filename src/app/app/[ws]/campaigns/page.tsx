import { CampaignBuilder } from "@/components/campaign-builder";
import { Chip, Empty, PageTitle, Panel, th, td } from "@/components/ui/kit";
import { getMetaIntegration } from "@/lib/server/services/meta";
import { pageAccess } from "../../access";

export const metadata = { title: "Campaigns" };

export default async function Campaigns({ params }: { params: Promise<{ ws: string }> }) {
  const { ws } = await params;
  const { ws: w, role, readDeps, deps } = await pageAccess(ws);
  const [campaigns, integ] = await Promise.all([readDeps.repo.list("campaigns", w.id, { orderBy: { field: "createdAt", desc: true } }), getMetaIntegration(deps, w)]);
  return (
    <div className="space-y-4">
      <PageTitle aside={<Chip tone={integ?.status === "connected" ? "good" : "neutral"}>{integ?.status === "connected" ? "Meta connected" : "Meta not connected"}</Chip>}>Campaigns</PageTitle>
      <Panel title="Your campaigns">
        {campaigns.length === 0 ? <Empty title="No campaigns yet">Build a plan below, or connect Meta in Settings to import existing campaigns.</Empty> : (
          <div className="-m-4 overflow-x-auto"><table className="w-full"><thead><tr><th className={th}>Name</th><th className={th}>Status</th><th className={th}>Objective</th><th className={th}>Daily budget</th><th className={th}>Meta</th></tr></thead>
            <tbody>{campaigns.map((c) => <tr key={c.id} className="border-t border-line"><td className="px-3 py-2 text-sm font-medium">{c.name}</td><td className={td}><Chip tone={c.status === "active" ? "good" : "neutral"}>{c.status}</Chip></td><td className={td}>{c.objective ?? "—"}</td><td className={td}>{c.dailyBudget ? `$${c.dailyBudget}` : "—"}</td><td className={td}>{c.metaCampaignId ? "linked" : "not linked"}</td></tr>)}</tbody></table></div>
        )}
      </Panel>
      {role !== "viewer" && <CampaignBuilder slug={w.slug} defaults={{ niche: w.industry, city: w.location ?? "", offer: w.offer ?? "", monthlyBudget: w.monthlyAdBudget, landingPage: `/${w.industry}` }} />}
    </div>
  );
}
