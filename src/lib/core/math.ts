/** Division that returns null instead of Infinity/NaN so the UI can show "—". */
export function safeDiv(n: number, d: number): number | null {
  if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return null;
  return n / d;
}

export function round(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round((n + Number.EPSILON) * f) / f;
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  const lo = s[mid - 1];
  const hi = s[mid];
  if (hi === undefined) return null;
  return s.length % 2 === 0 && lo !== undefined ? (lo + hi) / 2 : hi;
}

export function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}
