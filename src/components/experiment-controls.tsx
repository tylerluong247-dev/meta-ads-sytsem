"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { EXPERIMENT_TYPES } from "@/lib/core/experiments";
import { postAction } from "./ui/post";

export function NewExperiment({ slug, pages }: { slug: string; pages: string[] }) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const inp = "mt-1 block w-full rounded-md border border-line px-2 py-1.5 text-sm";
  async function create(f: FormData) {
    setErr(null);
    const key = String(f.get("type")) === "cta" ? "cta" : String(f.get("type")) === "offer" ? "offer" : "headline";
    try {
      await postAction(slug, "experiments", {
        name: String(f.get("name")), type: String(f.get("type")), controlLabel: String(f.get("controlLabel") || "Control"), variantLabel: String(f.get("variantLabel") || "Variant"),
        landingSlug: String(f.get("landingSlug") || "") || undefined, variant: f.get("variantText") ? { [key]: String(f.get("variantText")) } : {},
      });
      router.refresh();
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not create the test"); }
  }
  return (
    <form action={create} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <label className="text-sm">Test name<input name="name" required minLength={2} className={inp} placeholder="Storm-damage headline" /></label>
      <label className="text-sm">What changes<select name="type" className={inp}>{EXPERIMENT_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}</select></label>
      <label className="text-sm">Landing page<select name="landingSlug" className={inp}><option value="">—</option>{pages.map((p) => <option key={p}>{p}</option>)}</select></label>
      <label className="text-sm">Variant text (replaces the headline, offer or button)<input name="variantText" maxLength={500} className={inp} /></label>
      <label className="text-sm">Control label<input name="controlLabel" className={inp} placeholder="Current headline" /></label>
      <label className="text-sm">Variant label<input name="variantLabel" className={inp} placeholder="Storm headline" /></label>
      <div className="flex items-end"><button className="rounded-md bg-tide px-3 py-2 text-sm font-medium text-white">Start test</button></div>
      {err && <p role="alert" className="text-sm text-bad sm:col-span-2">{err}</p>}
    </form>
  );
}

export function StopExperiment({ slug, id }: { slug: string; id: string }) {
  const router = useRouter();
  return <button className="text-sm text-bad underline" onClick={async () => { if (confirm("Stop this test? Visitors will see the original page.")) { await postAction(slug, `experiments/${id}/stop`); router.refresh(); } }}>Stop test</button>;
}
