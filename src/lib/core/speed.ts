import { mean, median } from "./math";

export interface SpeedThresholds {
  targetMinutes: number; // good at or below
  warningMinutes: number; // warning above this
  criticalMinutes: number; // critical above this
}

export const DEFAULT_SPEED_THRESHOLDS: SpeedThresholds = { targetMinutes: 5, warningMinutes: 5, criticalMinutes: 15 };

export type SpeedBand = "ON_TARGET" | "WARNING" | "CRITICAL";

export function responseMinutes(createdAt: Date | string, firstResponseAt: Date | string | null | undefined): number | null {
  if (!firstResponseAt) return null;
  const ms = new Date(firstResponseAt).getTime() - new Date(createdAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  return ms / 60000;
}

export function classifySpeed(minutes: number, t: SpeedThresholds = DEFAULT_SPEED_THRESHOLDS): SpeedBand {
  if (minutes > t.criticalMinutes) return "CRITICAL";
  if (minutes > t.warningMinutes) return "WARNING";
  return "ON_TARGET";
}

export interface SpeedStats {
  count: number;
  averageMinutes: number | null;
  medianMinutes: number | null;
  fastestMinutes: number | null;
  slowestMinutes: number | null;
  withinTargetShare: number | null;
}

export function speedStats(minutes: number[], t: SpeedThresholds = DEFAULT_SPEED_THRESHOLDS): SpeedStats {
  if (minutes.length === 0) {
    return { count: 0, averageMinutes: null, medianMinutes: null, fastestMinutes: null, slowestMinutes: null, withinTargetShare: null };
  }
  return {
    count: minutes.length,
    averageMinutes: mean(minutes),
    medianMinutes: median(minutes),
    fastestMinutes: Math.min(...minutes),
    slowestMinutes: Math.max(...minutes),
    withinTargetShare: minutes.filter((m) => m <= t.targetMinutes).length / minutes.length,
  };
}

export interface WaitingLead {
  id: string;
  name: string;
  createdAt: Date | string;
}

/** Leads still waiting for a first response, with how long they've waited. */
export function overdueLeads(
  leads: WaitingLead[],
  now: Date,
  t: SpeedThresholds = DEFAULT_SPEED_THRESHOLDS,
): Array<WaitingLead & { waitingMinutes: number; band: SpeedBand }> {
  return leads
    .map((l) => ({ ...l, waitingMinutes: (now.getTime() - new Date(l.createdAt).getTime()) / 60000 }))
    .filter((l) => l.waitingMinutes > t.warningMinutes)
    .map((l) => ({ ...l, band: classifySpeed(l.waitingMinutes, t) }))
    .sort((a, b) => b.waitingMinutes - a.waitingMinutes);
}
