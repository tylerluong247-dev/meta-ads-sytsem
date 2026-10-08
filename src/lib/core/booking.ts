export interface AvailabilityRule {
  /** 0 = Sunday ... 6 = Saturday, in the host timezone. */
  weekdays: number[];
  startHour: number;
  endHour: number;
}

export interface Slot {
  startUtc: string;
  endUtc: string;
}

/** Offset in minutes of an IANA timezone at a given instant (positive = ahead of UTC). */
export function tzOffsetMinutes(timeZone: string, at: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const parts = Object.fromEntries(dtf.formatToParts(at).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000);
}

/**
 * Generate bookable slots over the next `days` days in the host timezone, skipping busy intervals,
 * respecting minimum notice. Returned in UTC so each client can render in its own timezone.
 */
export function generateSlots(opts: {
  hostTimeZone: string;
  rules: AvailabilityRule;
  from: Date;
  days: number;
  durationMinutes: number;
  minNoticeMinutes?: number;
  busy?: Slot[];
}): Slot[] {
  const { hostTimeZone, rules, from, days, durationMinutes } = opts;
  const notice = (opts.minNoticeMinutes ?? 120) * 60000;
  const busy = (opts.busy ?? []).map((b) => [new Date(b.startUtc).getTime(), new Date(b.endUtc).getTime()] as const);
  const slots: Slot[] = [];

  for (let d = 0; d < days; d++) {
    const probe = new Date(from.getTime() + d * 86400000);
    const offset = tzOffsetMinutes(hostTimeZone, probe);
    const hostLocal = new Date(probe.getTime() + offset * 60000);
    if (!rules.weekdays.includes(hostLocal.getUTCDay())) continue;
    const dayStartLocal = Date.UTC(hostLocal.getUTCFullYear(), hostLocal.getUTCMonth(), hostLocal.getUTCDate());
    for (let mins = rules.startHour * 60; mins + durationMinutes <= rules.endHour * 60; mins += durationMinutes) {
      const startMs = dayStartLocal + mins * 60000 - offset * 60000;
      const endMs = startMs + durationMinutes * 60000;
      if (startMs < from.getTime() + notice) continue;
      if (busy.some(([bs, be]) => startMs < be && endMs > bs)) continue;
      slots.push({ startUtc: new Date(startMs).toISOString(), endUtc: new Date(endMs).toISOString() });
    }
  }
  return slots;
}

export function isSlotAvailable(slot: Slot, slots: Slot[]): boolean {
  return slots.some((s) => s.startUtc === slot.startUtc && s.endUtc === slot.endUtc);
}

export function formatInZone(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(iso));
}

export function reminderTimes(startUtc: string): { dayBefore: Date; hourBefore: Date } {
  const start = new Date(startUtc).getTime();
  return { dayBefore: new Date(start - 24 * 3600000), hourBefore: new Date(start - 3600000) };
}
