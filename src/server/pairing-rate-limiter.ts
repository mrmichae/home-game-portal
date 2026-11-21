const DEFAULT_WINDOW_MS = 10 * 60 * 1000;
const DEFAULT_MAXIMUM_ATTEMPTS = 5;

interface RateBucket {
  startedAt: number;
  count: number;
}

/** Bounds unauthenticated Pairing Request creation per remote address. */
export class PairingRateLimiter {
  private readonly buckets = new Map<string, RateBucket>();

  constructor(
    private readonly maximumAttempts = DEFAULT_MAXIMUM_ATTEMPTS,
    private readonly windowMs = DEFAULT_WINDOW_MS,
  ) {}

  allow(address: string, now = Date.now()): boolean {
    this.prune(now);
    const key = address || "unknown";
    const bucket = this.buckets.get(key);
    if (!bucket) {
      this.buckets.set(key, { startedAt: now, count: 1 });
      return true;
    }
    if (bucket.count >= this.maximumAttempts) return false;
    bucket.count += 1;
    return true;
  }

  private prune(now: number): void {
    for (const [address, bucket] of this.buckets) {
      if (bucket.startedAt + this.windowMs <= now) this.buckets.delete(address);
    }
  }
}
