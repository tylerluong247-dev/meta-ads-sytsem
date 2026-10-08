export const DATE_PRESETS = ["today", "yesterday", "last_7_days", "last_30_days", "this_month", "last_month", "custom"] as const;
export type DatePreset = (typeof DATE_PRESETS)[number];

export interface DateRange {
  from: Date; // inclusive
  to: Date; // exclusive
  label: string;
}

/** Calendar math happens in the reporting timezone's offset (minutes ahead of UTC) so "today" matches the owner's day. */
export function resolveRange(preset: DatePreset, now: Date, utcOffsetMinutes = 0, custom?: { from: string; to: string }): DateRange {
  const local = new Date(now.getTime() + utcOffsetMinutes * 60000);
  const y = local.getUTCFullYear();
  const mo = local.getUTCMonth();
  const d = local.getUTCDate();
  const startOfLocalDay = (yy: number, mm: number, dd: number) => new Date(Date.UTC(yy, mm, dd) - utcOffsetMinutes * 60000);

  switch (preset) {
    case "today":
      return { from: startOfLocalDay(y, mo, d), to: startOfLocalDay(y, mo, d + 1), label: "Today" };
    case "yesterday":
      return { from: startOfLocalDay(y, mo, d - 1), to: startOfLocalDay(y, mo, d), label: "Yesterday" };
    case "last_7_days":
      return { from: startOfLocalDay(y, mo, d - 6), to: startOfLocalDay(y, mo, d + 1), label: "Last 7 days" };
    case "last_30_days":
      return { from: startOfLocalDay(y, mo, d - 29), to: startOfLocalDay(y, mo, d + 1), label: "Last 30 days" };
    case "this_month":
      return { from: startOfLocalDay(y, mo, 1), to: startOfLocalDay(y, mo, d + 1), label: "This month" };
    case "last_month":
      return { from: startOfLocalDay(y, mo - 1, 1), to: startOfLocalDay(y, mo, 1), label: "Last month" };
    case "custom": {
      if (!custom) throw new Error("Custom range requires from and to dates");
      const f = new Date(`${custom.from}T00:00:00.000Z`);
      const t = new Date(`${custom.to}T00:00:00.000Z`);
      if (Number.isNaN(f.getTime()) || Number.isNaN(t.getTime())) throw new Error("Invalid custom date");
      if (t < f) throw new Error("Custom range end must not be before start");
      return {
        from: startOfLocalDay(f.getUTCFullYear(), f.getUTCMonth(), f.getUTCDate()),
        to: startOfLocalDay(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate() + 1),
        label: `${custom.from} – ${custom.to}`,
      };
    }
  }
}

/** The equal-length window immediately before a range, for period-over-period comparisons. */
export function previousRange(r: DateRange): DateRange {
  const len = r.to.getTime() - r.from.getTime();
  return { from: new Date(r.from.getTime() - len), to: r.from, label: "Previous period" };
}

export function dayKey(d: Date, utcOffsetMinutes = 0): string {
  return new Date(d.getTime() + utcOffsetMinutes * 60000).toISOString().slice(0, 10);
}
