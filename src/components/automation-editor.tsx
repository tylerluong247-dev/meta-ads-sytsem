"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { AutomationRule, AutomationStep } from "@/lib/server/entities";
import { postAction } from "./ui/post";

export function AutomationEditor({ slug, rule, canEdit }: { slug: string; rule: AutomationRule; canEdit: boolean }) {
  const router = useRouter();
  const [steps, setSteps] = useState<AutomationStep[]>(rule.config.steps);
  const [enabled, setEnabled] = useState(rule.enabled);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const upd = (i: number, patch: Partial<AutomationStep>) => setSteps((s) => s.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  async function save() {
    setMsg(null);
    try { await postAction(slug, `automations/${rule.id}`, { enabled, steps }); setMsg({ ok: true, text: "Saved" }); router.refresh(); } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : "Failed" }); }
  }
  const inp = "mt-1 block w-full rounded-md border border-line px-2 py-1.5 text-sm";
  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={enabled} disabled={!canEdit} onChange={(e) => setEnabled(e.target.checked)} /> Sequence is on</label>
      {steps.map((s, i) => (
        <fieldset key={s.id} className="grid gap-2 rounded-md border border-line p-3 sm:grid-cols-[8rem_7rem_1fr]">
          <legend className="px-1 text-xs text-ink-soft">Step {i + 1}{s.channel === "sms" ? " (text messages aren't sent yet; this step is skipped)" : ""}</legend>
          <label className="text-sm">Send after (min)<input type="number" min={0} disabled={!canEdit} value={s.delayMinutes} onChange={(e) => upd(i, { delayMinutes: Number(e.target.value) })} className={inp} /></label>
          <label className="text-sm">Channel<select disabled={!canEdit} value={s.channel} onChange={(e) => upd(i, { channel: e.target.value as "email" | "sms" })} className={inp}><option value="email">Email</option><option value="sms">Text</option></select></label>
          {s.channel === "email" && <label className="text-sm">Subject<input disabled={!canEdit} value={s.subject ?? ""} onChange={(e) => upd(i, { subject: e.target.value })} className={inp} /></label>}
          <label className="text-sm sm:col-span-3">Message<textarea rows={4} disabled={!canEdit} value={s.body} onChange={(e) => upd(i, { body: e.target.value })} className={inp} /></label>
        </fieldset>
      ))}
      <p className="text-xs text-ink-soft">Merge fields: {"{{firstName}} {{businessName}} {{bookingUrl}} {{senderName}}"}. Every email gets an unsubscribe link and your mailing address automatically. Sequences stop when a lead replies, books, opts out or is lost.</p>
      {canEdit && <div className="flex items-center gap-3"><button onClick={save} className="rounded-md bg-tide px-3 py-2 text-sm font-medium text-white">Save sequence</button>{msg && <span role={msg.ok ? "status" : "alert"} className={`text-sm ${msg.ok ? "text-good" : "text-bad"}`}>{msg.text}</span>}</div>}
    </div>
  );
}
