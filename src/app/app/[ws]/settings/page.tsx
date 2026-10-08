import { MetaConnect, SettingsForm } from "@/components/settings-forms";
import { Panel, PageTitle } from "@/components/ui/kit";
import { checkTargetsViability } from "@/lib/core/economics";
import { getMetaIntegration } from "@/lib/server/services/meta";
import { env } from "@/lib/server/env";
import { pageAccess } from "../../access";

export const metadata = { title: "Settings" };

export default async function Settings({ params }: { params: Promise<{ ws: string }> }) {
  const { ws } = await params;
  const { ws: w, role, deps } = await pageAccess(ws);
  const integ = await getMetaIntegration(deps, w);
  const canEdit = role === "admin" || role === "owner";
  const check = checkTargetsViability({ clientValue: w.avgClientValue, grossMargin: w.grossMargin, targetCac: w.targetCac, targetCpl: w.targetCpl, targetBookedCallCost: w.targetBookedCallCost, qualifiedRate: w.qualifiedRate, bookedRate: w.bookedRate, showRate: w.showRate, closeRate: w.closeRate });
  const base = env.appUrl.replace(/\/$/, "");
  return (
    <div className="space-y-4">
      <PageTitle>Settings</PageTitle>
      {!check.consistent && <div role="status" className="rounded-md bg-warn-bg px-3 py-2 text-sm text-warn"><p className="font-medium">Your targets disagree with each other</p><ul className="list-disc pl-5">{check.issues.map((i) => <li key={i}>{i}</li>)}</ul></div>}
      <Panel title="Targets and business details"><SettingsForm slug={w.slug} readOnly={!canEdit} v={{
        name: w.name, industry: w.industry, website: w.website ?? "", location: w.location ?? "", offer: w.offer ?? "", timezone: w.timezone,
        avgClientValue: w.avgClientValue, grossMargin: w.grossMargin, desiredProfitMargin: w.desiredProfitMargin, targetCac: w.targetCac, targetCpl: w.targetCpl, targetBookedCallCost: w.targetBookedCallCost, targetRoas: w.targetRoas,
        qualifiedRate: w.qualifiedRate, bookedRate: w.bookedRate, showRate: w.showRate, closeRate: w.closeRate, avgSalesCycleDays: w.avgSalesCycleDays, monthlyAdBudget: w.monthlyAdBudget, monthlyRevenueTarget: w.monthlyRevenueTarget,
        senderName: w.senderName ?? "", senderEmail: w.senderEmail ?? "", postalAddress: w.postalAddress ?? "", bookingUrl: w.bookingUrl ?? "", speedTargetMinutes: w.speedTargetMinutes, speedCriticalMinutes: w.speedCriticalMinutes,
      }} /></Panel>
      <Panel title="Meta Ads"><MetaConnect slug={w.slug} status={integ?.status ?? "disconnected"} adAccountId={integ?.metaAdAccountId} lastSyncedAt={integ?.lastSyncedAt} lastError={integ?.lastError} canEdit={canEdit} /></Panel>
      <Panel title="Webhooks and links">
        <dl className="grid gap-y-2 text-sm sm:grid-cols-[14rem_1fr]">
          <dt className="text-ink-soft">Meta lead form webhook</dt><dd className="break-all num">{base}/api/webhooks/meta</dd>
          <dt className="text-ink-soft">Calendar webhook (Cal.com)</dt><dd className="break-all num">{base}/api/webhooks/calendar/{w.slug}</dd>
          <dt className="text-ink-soft">Landing page</dt><dd className="break-all num">{base}/{w.industry}</dd>
        </dl>
        <p className="mt-2 text-xs text-ink-soft">Webhook secrets are set as server environment variables; see the README.</p>
      </Panel>
    </div>
  );
}
