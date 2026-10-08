"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CREATIVE_STATUSES, type CreativeStatus } from "@/lib/core/types";
import { postAction } from "./ui/post";

export function CreativeStatusSelect({ slug, id, status, suggested }: { slug: string; id: string; status: CreativeStatus; suggested?: CreativeStatus }) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  async function set(next: string) {
    setErr(null);
    try { await postAction(slug, `creatives/${id}/status`, { status: next }); router.refresh(); } catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <select aria-label="Creative status" value={status} onChange={(e) => set(e.target.value)} className="rounded-md border border-line bg-white px-1.5 py-1 text-sm">{CREATIVE_STATUSES.map((s) => <option key={s} value={s}>{s.toLowerCase()}</option>)}</select>
      {suggested && suggested !== status && <button type="button" onClick={() => set(suggested)} className="text-xs text-tide underline">Apply suggested: {suggested.toLowerCase()}</button>}
      {err && <span role="alert" className="text-xs text-bad">{err}</span>}
    </span>
  );
}
