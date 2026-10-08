"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { postAction } from "./ui/post";

export function LeadActions({ slug, leadId, appointmentId, canRespond, canClose }: { slug: string; leadId: string; appointmentId?: string; canRespond: boolean; canClose: boolean }) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  async function run(path: string, body: unknown, ok: string) {
    setBusy(true);
    setMsg(null);
    try {
      await postAction(slug, path, body);
      setMsg({ ok: true, text: ok });
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Failed" });
    } finally {
      setBusy(false);
    }
  }
  const btn = "rounded-md border border-line bg-white px-2.5 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-50";
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {canRespond && (["call", "email", "sms", "note"] as const).map((c) => <button key={c} disabled={busy} className={btn} onClick={() => run(`leads/${leadId}/response`, { channel: c }, `First response logged (${c})`)}>I {c === "call" ? "called" : c === "email" ? "emailed" : c === "sms" ? "texted" : "noted"}</button>)}
      </div>
      {appointmentId && (
        <div className="flex flex-wrap gap-2">
          {(["SHOWED", "NO_SHOW", "RESCHEDULED", "LOST"] as const).map((o) => <button key={o} disabled={busy} className={btn} onClick={() => run(`appointments/${appointmentId}/outcome`, { outcome: o }, `Call marked ${o.replace("_", " ").toLowerCase()}`)}>{o === "SHOWED" ? "Call happened" : o === "NO_SHOW" ? "No-show" : o === "RESCHEDULED" ? "Needs reschedule" : "Lost after call"}</button>)}
        </div>
      )}
      {canClose && (
        <form className="grid max-w-md grid-cols-2 gap-2" action={(f) => { const n = (k: string) => Number(f.get(k) || 0); return run(`leads/${leadId}/close`, { initialPayment: n("initialPayment"), recurringPayment: n("recurringPayment"), recurringMonths: n("recurringMonths"), oneTimeFees: n("oneTimeFees"), salesperson: String(f.get("salesperson") || "") || undefined }, "Deal recorded"); }}>
          <label className="text-sm">First payment ($)<input name="initialPayment" type="number" min="0" step="0.01" required className="mt-1 block w-full rounded-md border border-line px-2 py-1.5 num" /></label>
          <label className="text-sm">One-time fees ($)<input name="oneTimeFees" type="number" min="0" step="0.01" className="mt-1 block w-full rounded-md border border-line px-2 py-1.5 num" /></label>
          <label className="text-sm">Monthly ($)<input name="recurringPayment" type="number" min="0" step="0.01" className="mt-1 block w-full rounded-md border border-line px-2 py-1.5 num" /></label>
          <label className="text-sm">Months<input name="recurringMonths" type="number" min="0" max="120" className="mt-1 block w-full rounded-md border border-line px-2 py-1.5 num" /></label>
          <label className="col-span-2 text-sm">Salesperson<input name="salesperson" maxLength={80} className="mt-1 block w-full rounded-md border border-line px-2 py-1.5" /></label>
          <button disabled={busy} className="col-span-2 rounded-md bg-tide px-3 py-2 text-sm font-medium text-white disabled:opacity-50">Record won deal</button>
        </form>
      )}
      {msg && <p role={msg.ok ? "status" : "alert"} className={`text-sm ${msg.ok ? "text-good" : "text-bad"}`}>{msg.text}</p>}
    </div>
  );
}
