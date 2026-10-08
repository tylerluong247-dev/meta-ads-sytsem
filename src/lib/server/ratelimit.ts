/**
 * Best-effort sliding-window limiter, per process. Good enough to blunt a single noisy client on one instance;
 * on serverless, put a shared limiter (Upstash/Redis or your edge provider's WAF) in front for real protection.
 */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(private readonly limit: number, private readonly windowMs: number) {}
  allow(key: string, now = Date.now()): boolean {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 10000) for (const [k, v] of this.hits) if (v.every((t) => now - t >= this.windowMs)) this.hits.delete(k);
    return true;
  }
}
