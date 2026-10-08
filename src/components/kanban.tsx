"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { DndContext, PointerSensor, KeyboardSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { canTransition } from "@/lib/core/pipeline";
import { PIPELINE_STAGES, type LeadTier, type PipelineStage } from "@/lib/core/types";
import { postAction } from "./ui/post";

export interface CardLead {
  id: string;
  name: string;
  business?: string;
  stage: PipelineStage;
  tier: LeadTier;
  score: number;
  source: string;
  campaign?: string;
  nextAction?: string;
  waitingMinutes?: number;
  createdAt: string;
}

const TIER_CLASS: Record<LeadTier, string> = { HOT: "bg-bad-bg text-bad", WARM: "bg-warn-bg text-warn", COLD: "bg-slate-100 text-ink-soft", DISQUALIFIED: "bg-slate-100 text-ink-soft line-through" };
const LABEL: Record<PipelineStage, string> = { NEW_LEAD: "New lead", QUALIFIED: "Qualified", BOOKED: "Booked", CONFIRMED: "Confirmed", SHOWED: "Showed", PROPOSAL: "Proposal", WON: "Won", LOST: "Lost" };

function Card({ lead, slug }: { lead: CardLead; slug: string }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: lead.id });
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined;
  return (
    <li ref={setNodeRef} style={style} className={`rounded-md border border-line bg-white p-2.5 text-sm shadow-sm ${isDragging ? "z-10 opacity-80 shadow-md" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <Link href={`/app/${slug}/leads/${lead.id}`} className="font-medium text-tide hover:underline">{lead.name}</Link>
        <button {...listeners} {...attributes} aria-label={`Drag ${lead.name}`} className="cursor-grab touch-none rounded px-1 text-ink-soft hover:bg-slate-100">⠿</button>
      </div>
      {lead.business && <p className="truncate text-xs text-ink-soft">{lead.business}</p>}
      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${TIER_CLASS[lead.tier]}`}>{lead.tier.toLowerCase()} {lead.score}</span>
        {lead.waitingMinutes !== undefined && <span className="rounded bg-bad-bg px-1.5 py-0.5 text-xs font-medium text-bad">no reply {Math.round(lead.waitingMinutes)}m</span>}
      </div>
      {lead.nextAction && <p className="mt-1 text-xs text-ink-soft">Next: {lead.nextAction}</p>}
      {lead.campaign && <p className="truncate text-xs text-ink-soft">{lead.campaign}</p>}
    </li>
  );
}

function Column({ stage, leads, slug, droppable }: { stage: PipelineStage; leads: CardLead[]; slug: string; droppable: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  return (
    <section ref={setNodeRef} aria-label={LABEL[stage]} className={`w-60 shrink-0 rounded-lg border bg-slate-50 ${isOver && droppable ? "border-tide bg-teal-50" : isOver ? "border-bad" : "border-line"}`}>
      <h2 className="flex justify-between px-3 py-2 text-sm font-semibold">{LABEL[stage]}<span className="num text-ink-soft">{leads.length}</span></h2>
      <ul className="min-h-16 space-y-2 px-2 pb-2">{leads.map((l) => <Card key={l.id} lead={l} slug={slug} />)}</ul>
    </section>
  );
}

export function Kanban({ slug, initial }: { slug: string; initial: CardLead[] }) {
  const router = useRouter();
  const [leads, setLeads] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [closing, setClosing] = useState<CardLead | null>(null);
  const [lostFor, setLostFor] = useState<CardLead | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor));

  async function onDragEnd(e: DragEndEvent) {
    const lead = leads.find((l) => l.id === e.active.id);
    const to = e.over?.id as PipelineStage | undefined;
    if (!lead || !to || lead.stage === to) return;
    setError(null);
    if (!canTransition(lead.stage, to)) return setError(`A lead can't move from ${LABEL[lead.stage]} to ${LABEL[to]}.`);
    if (to === "WON") return setClosing(lead);
    if (to === "LOST") return setLostFor(lead);
    await move(lead, to);
  }
  async function move(lead: CardLead, to: PipelineStage, lostReason?: string) {
    const prev = leads;
    setLeads((ls) => ls.map((l) => (l.id === lead.id ? { ...l, stage: to } : l)));
    try {
      await postAction(slug, `leads/${lead.id}/move`, { to, lostReason });
      router.refresh();
    } catch (err) {
      setLeads(prev);
      setError(err instanceof Error ? err.message : "Move failed");
    }
  }
  async function submitClose(form: FormData) {
    if (!closing) return;
    const num = (k: string) => Number(form.get(k) || 0);
    try {
      await postAction(slug, `leads/${closing.id}/close`, { initialPayment: num("initialPayment"), recurringPayment: num("recurringPayment"), recurringMonths: num("recurringMonths"), oneTimeFees: num("oneTimeFees") });
      setLeads((ls) => ls.map((l) => (l.id === closing.id ? { ...l, stage: "WON" } : l)));
      setClosing(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record the deal");
    }
  }
  const inp = "mt-1 block w-full rounded-md border border-line px-2 py-1.5 text-sm num";
  return (
    <>
      {error && <p role="alert" className="mb-3 rounded-md bg-bad-bg px-3 py-2 text-sm text-bad">{error}</p>}
      {/* Stable id: dnd-kit otherwise generates ids that differ between server and client render (hydration mismatch). */}
      <DndContext id="pipeline-kanban" sensors={sensors} onDragEnd={onDragEnd}>
        <div className="flex gap-3 overflow-x-auto pb-3">
          {PIPELINE_STAGES.map((s) => <Column key={s} stage={s} slug={slug} leads={leads.filter((l) => l.stage === s)} droppable />)}
        </div>
      </DndContext>
      {closing && (
        <div role="dialog" aria-modal="true" aria-label="Record deal" className="fixed inset-0 z-20 grid place-items-center bg-ink/40 p-4">
          <form action={submitClose} className="w-full max-w-sm space-y-3 rounded-lg bg-panel p-4">
            <h2 className="font-semibold">Won: {closing.name}</h2>
            <p className="text-sm text-ink-soft">Revenue is recorded from these amounts and credited to the campaign and creative that produced the lead.</p>
            <label className="block text-sm">First payment ($)<input name="initialPayment" type="number" min="0" step="0.01" required className={inp} autoFocus /></label>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-sm">Monthly ($)<input name="recurringPayment" type="number" min="0" step="0.01" className={inp} /></label>
              <label className="text-sm">Months<input name="recurringMonths" type="number" min="0" max="120" className={inp} /></label>
            </div>
            <label className="block text-sm">One-time fees ($)<input name="oneTimeFees" type="number" min="0" step="0.01" className={inp} /></label>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setClosing(null)} className="rounded-md px-3 py-1.5 text-sm hover:bg-slate-100">Cancel</button>
              <button className="rounded-md bg-tide px-3 py-1.5 text-sm font-medium text-white">Record deal</button>
            </div>
          </form>
        </div>
      )}
      {lostFor && (
        <div role="dialog" aria-modal="true" aria-label="Mark lost" className="fixed inset-0 z-20 grid place-items-center bg-ink/40 p-4">
          <form action={async (f) => { const l = lostFor; setLostFor(null); await move(l, "LOST", String(f.get("reason") || "Marked lost")); }} className="w-full max-w-sm space-y-3 rounded-lg bg-panel p-4">
            <h2 className="font-semibold">Mark {lostFor.name} as lost</h2>
            <label className="block text-sm">Reason<select name="reason" className={inp}>{["Not a fit", "Price", "No budget", "Chose another provider", "Went silent", "Not ready yet"].map((r) => <option key={r}>{r}</option>)}</select></label>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setLostFor(null)} className="rounded-md px-3 py-1.5 text-sm hover:bg-slate-100">Cancel</button>
              <button className="rounded-md bg-bad px-3 py-1.5 text-sm font-medium text-white">Mark lost</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
