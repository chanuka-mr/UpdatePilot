import type { IncomingMessage } from 'node:http';

type Bucket = { count: number; resetAt: number };

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private lastPrune = Date.now();

  constructor(
    private readonly maxRequests: number,
    private readonly windowMs: number,
  ) {}

  check(key: string, now = Date.now()): { allowed: boolean; retryAfterSeconds: number } {
    if (now - this.lastPrune > this.windowMs) {
      for (const [k, b] of this.buckets) {
        if (b.resetAt <= now) this.buckets.delete(k);
      }
      this.lastPrune = now;
    }

    const existing = this.buckets.get(key);
    if (!existing || existing.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
      return { allowed: true, retryAfterSeconds: 0 };
    }

    if (existing.count >= this.maxRequests) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
      };
    }

    existing.count += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  }
}

export function clientIp(req: IncomingMessage): string {
  if (process.env.TRUST_PROXY === 'true') {
    const forwarded = req.headers['x-forwarded-for'];
    const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    if (raw) {
      const first = raw.split(',')[0]?.trim();
      if (first) return first.slice(0, 64);
    }
  }
  return (req.socket.remoteAddress || 'unknown').slice(0, 64);
}

export const authLimiter = new RateLimiter(15, 15 * 60 * 1000);
export const pairLimiter = new RateLimiter(10, 15 * 60 * 1000);
export const userApiLimiter = new RateLimiter(180, 60 * 1000);
export const agentPollLimiter = new RateLimiter(240, 60 * 1000);
