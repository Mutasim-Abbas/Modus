/**
 * Per-IP fixed-window rate limiter.
 *
 * HONEST LIMITATION — read before trusting this:
 * the counters live in the memory of one serverless instance. Vercel runs many
 * instances and reclaims them freely, so the real ceiling is roughly
 * `MAX_REQUESTS_PER_WINDOW x active instances`, and every cold start resets to zero.
 * It is a courtesy brake against a single client looping the scan button, NOT a
 * durable defence against a determined attacker. Durable limiting needs shared
 * state (Vercel KV / Upstash). This limitation is documented in docs/API.md rather
 * than papered over.
 */

const MAX_REQUESTS_PER_WINDOW = 10;
const WINDOW_MS = 60_000;

/** Bounds memory if a lot of distinct IPs arrive: past this we evict the oldest windows. */
const MAX_TRACKED_IPS = 5_000;

interface Window {
  count: number;
  /** Epoch ms at which this window expires. */
  resetAt: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  /** Seconds until the caller may retry. Only meaningful when `allowed` is false. */
  retryAfterSeconds: number;
}

export class RateLimiter {
  readonly #windows = new Map<string, Window>();
  readonly #maxRequests: number;
  readonly #windowMs: number;

  constructor(maxRequests: number = MAX_REQUESTS_PER_WINDOW, windowMs: number = WINDOW_MS) {
    this.#maxRequests = maxRequests;
    this.#windowMs = windowMs;
  }

  /** Records a hit for `key` and says whether it is allowed. `now` is injectable for tests. */
  check(key: string, now: number = Date.now()): RateLimitDecision {
    this.#evictExpired(now);

    const existing = this.#windows.get(key);

    if (!existing || existing.resetAt <= now) {
      this.#windows.set(key, { count: 1, resetAt: now + this.#windowMs });
      return { allowed: true, retryAfterSeconds: 0 };
    }

    if (existing.count >= this.#maxRequests) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
      };
    }

    existing.count += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  }

  #evictExpired(now: number): void {
    if (this.#windows.size < MAX_TRACKED_IPS) {
      // Cheap path: only sweep once the map is actually large.
      return;
    }
    for (const [key, window] of this.#windows) {
      if (window.resetAt <= now) this.#windows.delete(key);
    }
    // Still full of live windows: drop the oldest insertions to bound memory.
    if (this.#windows.size >= MAX_TRACKED_IPS) {
      const overflow = this.#windows.size - MAX_TRACKED_IPS + 1;
      let removed = 0;
      for (const key of this.#windows.keys()) {
        if (removed >= overflow) break;
        this.#windows.delete(key);
        removed += 1;
      }
    }
  }
}

/**
 * Best-effort client IP.
 *
 * `x-vercel-forwarded-for` and `x-real-ip` are set by Vercel's proxy and cannot be
 * spoofed by the client; `x-forwarded-for` is the last resort and we take only its
 * first hop. If we cannot identify the caller we fall back to a shared bucket, which
 * is deliberately conservative: unknown callers share one allowance.
 */
export function clientIpFrom(headers: Headers): string {
  const vercelIp = headers.get('x-vercel-forwarded-for');
  if (vercelIp) return vercelIp.trim();

  const realIp = headers.get('x-real-ip');
  if (realIp) return realIp.trim();

  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }

  return 'unknown';
}
