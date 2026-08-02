import { describe, expect, it } from 'vitest';
import { clientIpFrom, RateLimiter } from './rate-limit.js';

describe('RateLimiter', () => {
  it('allows up to the limit then blocks', () => {
    const limiter = new RateLimiter(3, 60_000);
    const now = 1_000_000;

    expect(limiter.check('ip', now).allowed).toBe(true);
    expect(limiter.check('ip', now).allowed).toBe(true);
    expect(limiter.check('ip', now).allowed).toBe(true);

    const blocked = limiter.check('ip', now);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(60);
  });

  it('keeps separate budgets per key', () => {
    const limiter = new RateLimiter(1, 60_000);
    const now = 0;

    expect(limiter.check('a', now).allowed).toBe(true);
    expect(limiter.check('a', now).allowed).toBe(false);
    // A different caller is unaffected by the first one's exhaustion.
    expect(limiter.check('b', now).allowed).toBe(true);
  });

  it('opens a fresh window once the old one expires', () => {
    const limiter = new RateLimiter(1, 1_000);

    expect(limiter.check('ip', 0).allowed).toBe(true);
    expect(limiter.check('ip', 500).allowed).toBe(false);
    // Boundary: resetAt <= now means the window is over.
    expect(limiter.check('ip', 1_000).allowed).toBe(true);
  });

  it('reports a retry-after of at least one second', () => {
    const limiter = new RateLimiter(1, 1_000);
    limiter.check('ip', 0);
    // 1ms left would floor to 0 seconds — that would tell the caller to retry instantly.
    expect(limiter.check('ip', 999).retryAfterSeconds).toBe(1);
  });
});

describe('clientIpFrom', () => {
  it('prefers the Vercel proxy header, which a client cannot spoof', () => {
    const headers = new Headers({
      'x-vercel-forwarded-for': '1.1.1.1',
      'x-real-ip': '2.2.2.2',
      'x-forwarded-for': '3.3.3.3',
    });
    expect(clientIpFrom(headers)).toBe('1.1.1.1');
  });

  it('falls back through x-real-ip to x-forwarded-for', () => {
    expect(clientIpFrom(new Headers({ 'x-real-ip': '2.2.2.2' }))).toBe('2.2.2.2');
    expect(clientIpFrom(new Headers({ 'x-forwarded-for': '3.3.3.3' }))).toBe('3.3.3.3');
  });

  it('takes only the first hop of x-forwarded-for', () => {
    const headers = new Headers({ 'x-forwarded-for': '3.3.3.3, 4.4.4.4, 5.5.5.5' });
    expect(clientIpFrom(headers)).toBe('3.3.3.3');
  });

  it('shares one conservative bucket when the caller cannot be identified', () => {
    expect(clientIpFrom(new Headers())).toBe('unknown');
  });
});
