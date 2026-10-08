"use client";

import { useState } from "react";
import { postAction } from "./ui/post";

interface Msg { role: "you" | "analyst"; text: string; note?: string }
const SUGGESTED = ["Are my ads profitable?", "Which stage of the funnel is the weakest?", "Should I increase budget?", "Which creative should I pause?", "Why did lead cost change?"];

export function AnalystChat({ slug }: { slug: string }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  async function ask(question: string) {
    if (question.trim().length < 3 || busy) return;
    setMsgs((m) => [...m, { role: "you", text: question }]);
    setQ(""); setBusy(true);
    try {
      const r = await postAction<{ answer: string; source: string; note?: string }>(slug, "analyst", { question, preset: "last_30_days" });
      setMsgs((m) => [...m, { role: "analyst", text: r.answer, note: r.source === "rules" ? "Answered from the rule-based analysis" + (r.note ? `: ${r.note}` : "") : undefined }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: "analyst", text: e instanceof Error ? e.message : "Something went wrong" }]);
    } finally { setBusy(false); }
  }
  return (
    <div className="max-w-3xl space-y-3">
      <div className="flex flex-wrap gap-2">{SUGGESTED.map((s) => <button key={s} onClick={() => ask(s)} disabled={busy} className="rounded-full border border-line bg-white px-3 py-1 text-sm hover:bg-slate-50 disabled:opacity-50">{s}</button>)}</div>
      <div className="space-y-3" aria-live="polite">
        {msgs.map((m, i) => (
          <div key={i} className={`rounded-lg px-3 py-2 text-sm ${m.role === "you" ? "ml-10 bg-teal-50" : "mr-10 border border-line bg-panel"}`}>
            <p className="whitespace-pre-wrap">{m.text}</p>
            {m.note && <p className="mt-1 text-xs text-ink-soft">{m.note}</p>}
          </div>
        ))}
        {busy && <p className="text-sm text-ink-soft">Looking at the numbers…</p>}
      </div>
      <form onSubmit={(e) => { e.preventDefault(); ask(q); }} className="flex gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} maxLength={500} aria-label="Ask the analyst" placeholder="Ask about this client's last 30 days" className="min-w-0 flex-1 rounded-md border border-line px-3 py-2 text-sm" />
        <button disabled={busy} className="rounded-md bg-tide px-3 py-2 text-sm font-medium text-white disabled:opacity-50">Ask</button>
      </form>
    </div>
  );
}
