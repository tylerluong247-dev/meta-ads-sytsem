"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { postAction } from "./ui/post";

function useSave(slug: string, path: string, after?: () => void) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  async function save(body: unknown, ok = "Saved") {
    setBusy(true); setMsg(null);
    try { await postAction(slug, path, body); setMsg({ ok: true, text: ok }); router.refresh(); after?.(); } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : "Failed" }); } finally { setBusy(false); }
  }
  return { save, msg, busy };
}
const inp = "mt-1 block w-full rounded-md border border-line px-2 py-1.5 text-sm num";
const Msg = ({ m }: { m: { ok: boolean; text: string } | null }) => (m ? <p role={m.ok ? "status" : "alert"} className={`text-sm ${m.ok ? "text-good" : "text-bad"}`}>{m.text}</p> : null);
const btn = "rounded-md bg-tide px-3 py-2 text-sm font-medium text-white disabled:opacity-50";

export interface SettingsValues {
  name: string; industry: string; website: string; location: string; offer: string; timezone: string;
  avgClientValue: number; grossMargin: number; desiredProfitMargin: number; targetCac: number; targetCpl: number; targetBookedCallCost: number; targetRoas: number;
  qualifiedRate: number; bookedRate: number; showRate: number; closeRate: number; avgSalesCycleDays: number; monthlyAdBudget: number; monthlyRevenueTarget: number;
  senderName: string; senderEmail: string; postalAddress: string; bookingUrl: string; speedTargetMinutes: number; speedCriticalMinutes: number;
}

export function SettingsForm({ slug, v, readOnly }: { slug: string; v: SettingsValues; readOnly: boolean }) {
  const { save, msg, busy } = useSave(slug, "settings");
  function submit(f: FormData) {
    const n = (k: string) => Number(f.get(k));
    const p = (k: string) => n(k) / 100;
    const s = (k: string) => String(f.get(k) ?? "").trim();
    const opt = (k: string) => s(k) || undefined;
    return save({
      name: s("name"), industry: s("industry"), website: opt("website"), location: opt("location"), offer: opt("offer"), timezone: s("timezone"),
      avgClientValue: n("avgClientValue"), grossMargin: p("grossMargin"), desiredProfitMargin: p("desiredProfitMargin"), targetCac: n("targetCac"), targetCpl: n("targetCpl"), targetBookedCallCost: n("targetBookedCallCost"), targetRoas: n("targetRoas"),
      qualifiedRate: p("qualifiedRate"), bookedRate: p("bookedRate"), showRate: p("showRate"), closeRate: p("closeRate"), avgSalesCycleDays: n("avgSalesCycleDays"), monthlyAdBudget: n("monthlyAdBudget"), monthlyRevenueTarget: n("monthlyRevenueTarget"),
      senderName: opt("senderName"), senderEmail: opt("senderEmail"), postalAddress: opt("postalAddress"), bookingUrl: opt("bookingUrl"), speedTargetMinutes: n("speedTargetMinutes"), speedCriticalMinutes: n("speedCriticalMinutes"),
    }, "Settings saved");
  }
  const pct = (x: number) => Math.round(x * 10000) / 100;
  const T = (name: keyof SettingsValues, label: string, extra: Record<string, unknown> = {}) => <label className="text-sm">{label}<input name={name} defaultValue={String(v[name])} disabled={readOnly} className={inp} {...extra} /></label>;
  const N = (name: keyof SettingsValues, label: string, val?: number, step = "any") => <label className="text-sm">{label}<input name={name} type="number" step={step} min="0" required defaultValue={val ?? (v[name] as number)} disabled={readOnly} className={inp} /></label>;
  return (
    <form action={submit} className="space-y-5">
      <fieldset className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"><legend className="mb-2 text-sm font-semibold">Business</legend>
        {T("name", "Business name", { required: true })}{T("industry", "Industry", { required: true })}{T("timezone", "Time zone (e.g. America/Chicago)", { required: true })}{T("website", "Website")}{T("location", "Service area")}{T("offer", "Main offer")}
      </fieldset>
      <fieldset className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><legend className="mb-2 text-sm font-semibold">Money targets</legend>
        {N("avgClientValue", "Revenue per client ($)")}{N("grossMargin", "Gross margin (%)", pct(v.grossMargin))}{N("desiredProfitMargin", "Profit wanted (%)", pct(v.desiredProfitMargin))}{N("monthlyAdBudget", "Monthly ad budget ($)")}
        {N("targetCpl", "Target cost per lead ($)")}{N("targetBookedCallCost", "Target cost per booked call ($)")}{N("targetCac", "Target cost per client ($)")}{N("targetRoas", "Target ROAS (x)")}{N("monthlyRevenueTarget", "Monthly revenue goal ($)")}
      </fieldset>
      <fieldset className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5"><legend className="mb-2 text-sm font-semibold">Funnel rates you expect</legend>
        {N("qualifiedRate", "Lead → qualified (%)", pct(v.qualifiedRate))}{N("bookedRate", "Qualified → booked (%)", pct(v.bookedRate))}{N("showRate", "Booked → showed (%)", pct(v.showRate))}{N("closeRate", "Showed → closed (%)", pct(v.closeRate))}{N("avgSalesCycleDays", "Sales cycle (days)", undefined, "1")}
      </fieldset>
      <fieldset className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"><legend className="mb-2 text-sm font-semibold">Follow-up and speed to lead</legend>
        {T("senderName", "Sender name")}{T("senderEmail", "Sender email", { type: "email" })}{T("bookingUrl", "Booking link (optional)", { type: "url" })}
        <label className="text-sm sm:col-span-2 xl:col-span-3">Business mailing address (required in every marketing email, emails are held until set)<input name="postalAddress" defaultValue={v.postalAddress} disabled={readOnly} className={inp} /></label>
        {N("speedTargetMinutes", "Reply target (minutes)", undefined, "1")}{N("speedCriticalMinutes", "Critical after (minutes)", undefined, "1")}
      </fieldset>
      {!readOnly && <div className="flex items-center gap-3"><button disabled={busy} className={btn}>Save settings</button><Msg m={msg} /></div>}
    </form>
  );
}

export function MetaConnect({ slug, status, adAccountId, lastSyncedAt, lastError, canEdit }: { slug: string; status: string; adAccountId?: string; lastSyncedAt?: string; lastError?: string; canEdit: boolean }) {
  const connect = useSave(slug, "meta/connect");
  const sync = useSave(slug, "meta/sync");
  return (
    <div className="space-y-3">
      <p className="text-sm">Status: <strong>{status}</strong>{adAccountId ? ` · ad account ${adAccountId}` : ""}{lastSyncedAt ? ` · last sync ${lastSyncedAt.slice(0, 16).replace("T", " ")} UTC` : ""}</p>
      {lastError && <p className="rounded-md bg-bad-bg px-3 py-2 text-sm text-bad">Last error: {lastError}</p>}
      {canEdit ? (
        <>
          <form action={(f) => connect.save({ adAccountId: String(f.get("adAccountId")).trim(), pageId: String(f.get("pageId") || "").trim() || undefined, accessToken: String(f.get("accessToken")).trim() }, "Connected. Token verified and stored encrypted.")} className="grid gap-3 sm:grid-cols-3">
            <label className="text-sm">Ad account ID<input name="adAccountId" required placeholder="act_1234567890" className={inp} /></label>
            <label className="text-sm">Facebook Page ID<input name="pageId" className={inp} /></label>
            <label className="text-sm">Access token<input name="accessToken" type="password" autoComplete="off" required className={inp} /></label>
            <div className="flex items-center gap-3 sm:col-span-3"><button disabled={connect.busy} className={btn}>{status === "connected" ? "Replace connection" : "Connect Meta"}</button><Msg m={connect.msg} /></div>
          </form>
          <p className="text-xs text-ink-soft">The token goes to the server, is checked against Meta, then stored encrypted. It is never sent back to the browser.</p>
          {status === "connected" && <div className="flex items-center gap-3 border-t border-line pt-3"><button type="button" disabled={sync.busy} onClick={() => sync.save({ days: 30 }, "Sync finished")} className="rounded-md border border-line bg-white px-3 py-2 text-sm disabled:opacity-50">Sync last 30 days</button><Msg m={sync.msg} /></div>}
        </>
      ) : <p className="text-sm text-ink-soft">Only admins can change the Meta connection.</p>}
    </div>
  );
}
