// @vitest-environment node
//
// Real PGlite Postgres, not a mock — see api/_lib/db/testDb.ts. This is the durable
// replacement for api/_lib/rate-limit.ts's in-memory limiter, so it must be proven
// against a real table, not an in-memory stand-in.
import { freshTestDb, type TestDb } from '../db/testDb.js';
import { isRateLimited, recordAttempt } from './rate-limit-db.js';

let testDb: TestDb;

beforeEach(async () => {
  testDb = await freshTestDb();
});

afterEach(async () => {
  await testDb.close();
});

describe('isRateLimited / recordAttempt', () => {
  const rule = { windowMs: 60_000, maxAttempts: 3 };

  it('allows requests under the threshold', async () => {
    const { db } = testDb;
    for (let i = 0; i < 2; i += 1) {
      await recordAttempt(db, { key: 'user@example.com', scope: 'account', action: 'login', success: false });
    }
    const limited = await isRateLimited(db, { key: 'user@example.com', scope: 'account', action: 'login', rule });
    expect(limited).toBe(false);
  });

  it('blocks once the threshold is reached', async () => {
    const { db } = testDb;
    for (let i = 0; i < 3; i += 1) {
      await recordAttempt(db, { key: 'user@example.com', scope: 'account', action: 'login', success: false });
    }
    const limited = await isRateLimited(db, { key: 'user@example.com', scope: 'account', action: 'login', rule });
    expect(limited).toBe(true);
  });

  // DELIBERATE BEHAVIOUR CHANGE, P2.4 security audit (the internal security audit F-05). This test
  // previously asserted that the ACCOUNT scope counts successes toward the lockout too.
  // That is a defect, not a feature: with login.account = 8 per 15 minutes, a user
  // signing in on a handful of devices locks themselves out of their own account, and
  // `auth_attempts.success` exists precisely so that need not happen (docs/DB.md §4.3
  // anticipated this option and P2.2 did not take it). The assertion is not removed —
  // it is split, so both halves of the corrected policy are pinned.
  it('the account scope counts FAILURES only — a user cannot lock themselves out by signing in', async () => {
    const { db } = testDb;
    for (let i = 0; i < 3; i += 1) {
      await recordAttempt(db, { key: 'user@example.com', scope: 'account', action: 'login', success: true });
    }
    const limited = await isRateLimited(db, { key: 'user@example.com', scope: 'account', action: 'login', rule });
    expect(limited).toBe(false);
  });

  it('the ip scope still counts EVERY attempt, successful or not — it is a velocity brake, not a lockout', async () => {
    const { db } = testDb;
    const ipKey = 'a'.repeat(64);
    for (let i = 0; i < 3; i += 1) {
      await recordAttempt(db, { key: ipKey, scope: 'ip', action: 'login', success: true });
    }
    const limited = await isRateLimited(db, { key: ipKey, scope: 'ip', action: 'login', rule });
    expect(limited).toBe(true);
  });

  it('does not count attempts outside the window', async () => {
    const { db } = testDb;
    const longAgo = new Date(Date.now() - 10 * 60_000);
    for (let i = 0; i < 5; i += 1) {
      await recordAttempt(db, { key: 'stale@example.com', scope: 'account', action: 'login', success: false });
    }
    // Sanity check via a rule whose window predates every attempt above.
    const limited = await isRateLimited(db, {
      key: 'stale@example.com',
      scope: 'account',
      action: 'login',
      rule: { windowMs: 1, maxAttempts: 1 },
      now: new Date(longAgo.getTime() + 100_000_000),
    });
    expect(limited).toBe(false);
  });

  it('scopes are independent — an IP-scoped flood does not throttle the account scope', async () => {
    const { db } = testDb;
    const ipHash = 'a'.repeat(64);
    for (let i = 0; i < 10; i += 1) {
      await recordAttempt(db, { key: ipHash, scope: 'ip', action: 'login', success: false });
    }
    const accountLimited = await isRateLimited(db, {
      key: 'someone@example.com',
      scope: 'account',
      action: 'login',
      rule,
    });
    expect(accountLimited).toBe(false);
  });

  it('actions are independent — signup attempts do not throttle login', async () => {
    const { db } = testDb;
    for (let i = 0; i < 10; i += 1) {
      await recordAttempt(db, { key: 'someone@example.com', scope: 'account', action: 'signup', success: false });
    }
    const loginLimited = await isRateLimited(db, {
      key: 'someone@example.com',
      scope: 'account',
      action: 'login',
      rule,
    });
    expect(loginLimited).toBe(false);
  });

  it('an ip-scoped key must be a 64-hex-char hash — the DB rejects a raw IP', async () => {
    const { db } = testDb;
    await expect(
      recordAttempt(db, { key: '203.0.113.5', scope: 'ip', action: 'login', success: false }),
    ).rejects.toThrow();
  });
});
