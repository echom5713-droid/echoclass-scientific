import type { RateLimiter } from "../application/ports.js";

export class SlidingWindowRateLimiter implements RateLimiter {
  private readonly buckets = new Map<string, number[]>();

  constructor(
    private readonly windowMs: number,
    private readonly maximum: number,
    private readonly clock: () => number = Date.now,
  ) {}

  allow(key: string): boolean {
    const now = this.clock();
    const recent = (this.buckets.get(key) ?? []).filter(
      (timestamp) => now - timestamp < this.windowMs,
    );
    if (recent.length >= this.maximum) return false;
    recent.push(now);
    this.buckets.set(key, recent);
    return true;
  }
}
