"use client";

import { useEffect, useMemo, useState } from "react";

interface Slot { startUtc: string; endUtc: string }

/** Public booking widget. The lead's private token is the only credential; availability is computed server-side. */
export function Booking({ workspaceSlug, token }: { workspaceSlug: string; token: string }) {
  const tz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", []);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [error, setError] = useState("");
  const [day, setDay] = useState<string>("");
  const [booked, setBooked] = useState<string>("");
  const [busy, setBusy] = useState("");

  useEffect(() => {
    let alive = true;
    fetch(`/api/slots?ws=${encodeURIComponent(workspaceSlug)}&token=${encodeURIComponent(token)}`)
      .then((r) => r.json())
      .then((d) => { if (!alive) return; if (d.ok) setSlots(d.slots); else setError(d.error ?? "Couldn't load times."); })
      .catch(() => alive && setError("Couldn't load times. Refresh to try again."));
    return () => { alive = false; };
  }, [workspaceSlug, token]);

  const dayFmt = useMemo(() => new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" }), [tz]);
  const timeFmt = useMemo(() => new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }), [tz]);
  const byDay = useMemo(() => {
    const m = new Map<string, Slot[]>();
    for (const s of slots ?? []) {
      const k = dayFmt.format(new Date(s.startUtc));
      m.set(k, [...(m.get(k) ?? []), s]);
    }
    return m;
  }, [slots, dayFmt]);
  const days = [...byDay.keys()];
  const activeDay = day || days[0] || "";

  async function book(s: Slot) {
    setBusy(s.startUtc);
    setError("");
    try {
      const res = await fetch("/api/book", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "book", ws: workspaceSlug, token, startUtc: s.startUtc, timeZone: tz }) });
      const d = await res.json();
      if (d.ok) setBooked(`${dayFmt.format(new Date(s.startUtc))} at ${timeFmt.format(new Date(s.startUtc))}`);
      else {
        setError(d.error ?? "Couldn't book that time.");
        // The slot may have been taken: refresh availability.
        const r = await fetch(`/api/slots?ws=${encodeURIComponent(workspaceSlug)}&token=${encodeURIComponent(token)}`);
        const fresh = await r.json();
        if (fresh.ok) setSlots(fresh.slots);
      }
    } catch {
      setError("Network problem. Try again.");
    } finally {
      setBusy("");
    }
  }

  if (booked) return <div role="status" className="mt-4 rounded-md bg-good-bg p-4 text-good"><p className="font-semibold">You&apos;re booked for {booked}.</p><p className="text-sm">A confirmation is on its way to your email. Times shown in {tz}.</p></div>;
  if (!slots && !error) return <p className="mt-4 text-sm text-ink-soft">Loading times…</p>;
  return (
    <div className="mt-4">
      {error && <p role="alert" className="mb-3 text-sm text-bad">{error}</p>}
      {days.length === 0 ? <p className="text-sm text-ink-soft">No times are open right now. We&apos;ll email you to arrange one.</p> : (
        <>
          <div role="tablist" aria-label="Day" className="flex gap-2 overflow-x-auto pb-2">
            {days.slice(0, 10).map((d) => (
              <button key={d} role="tab" aria-selected={d === activeDay} onClick={() => setDay(d)} className={`shrink-0 rounded-md border px-3 py-2 text-sm ${d === activeDay ? "border-accent bg-accent text-white" : "border-line bg-white"}`}>{d}</button>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
            {(byDay.get(activeDay) ?? []).map((s) => (
              <button key={s.startUtc} disabled={busy !== ""} onClick={() => book(s)} className="rounded-md border border-line bg-white px-2 py-2 text-sm hover:border-accent disabled:opacity-60">{busy === s.startUtc ? "Booking…" : timeFmt.format(new Date(s.startUtc))}</button>
            ))}
          </div>
          <p className="mt-2 text-xs text-ink-soft">Times shown in {tz}.</p>
        </>
      )}
    </div>
  );
}
