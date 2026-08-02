// @vitest-environment node
//
// REGRESSION TEST for the internal security audit F-01 (HIGH).
//
// The original limiter was `SELECT count` -> `await verifySecret()` (50-200 ms of
// argon2id) -> `INSERT`. Nothing made those three steps atomic and the slowest sat in the
// middle, so every concurrent request read a count that did not yet include any request
// in flight. Measured before the fix: 20 simultaneous wrong-password logins against a
// per-account cap of 8 produced 0 x 429. The cap bounded sequential attempts only.
//
// This suite pins the fix at the level where it is DETERMINISTIC: `reserveAttempt` counts
// and inserts in one statement, so no matter how the calls interleave, the number of
// reservations handed out inside one window is exactly `maxAttempts`. That is an
// invariant, not a timing observation — which is the whole point, because the previous
// symptom was dismissed as flake twice.
import { count, eq } from 'drizzle-orm';
import { authAttempts } from '../db/schema.js';
import { freshTestDb, TEST_PEPPER, type TestDb } from '../db/testDb.js';
import {
  isRateLimited,
  markAttemptSucceeded,
  recordAttempt,
  reserveAttempt,
  reserveAttemptPair,
} from './rate-limit-db.js';

let testDb: TestDb;
beforeEach(async () => { testDb = await freshTestDb(); });
afterEach(async () => { await testDb.close(); });

const rule = { windowMs: 60_000, maxAttempts: 8 };

describe('reserveAttempt under concurrency — F-01', () => {
  it('hands out exactly maxAttempts reservations no matter how many callers race', async () => {
    const { db } = testDb;
    const results = await Promise.all(
      Array.from({ length: 40 }, () =>
        reserveAttempt(db, { key: 'victim@example.com', scope: 'account', action: 'login', rule }),
      ),
    );

    const granted = results.filter((r) => !r.limited);
    const refused = results.filter((r) => r.limited);
    expect(granted).toHaveLength(rule.maxAttempts);
    expect(refused).toHaveLength(40 - rule.maxAttempts);
    // Every granted reservation carries the id of a row that really exists.
    expect(new Set(granted.map((r) => r.attemptId)).size).toBe(rule.maxAttempts);
  }, 120_000);

  it('records every granted attempt and NOTHING for a refused one', async () => {
    const { db } = testDb;
    await Promise.all(
      Array.from({ length: 40 }, () =>
        reserveAttempt(db, { key: 'victim2@example.com', scope: 'account', action: 'login', rule }),
      ),
    );
    const [row] = await db
      .select({ total: count() })
      .from(authAttempts)
      .where(eq(authAttempts.key, 'victim2@example.com'));
    // A refused attempt must not extend its own window, or one request per window could
    // hold a victim locked out forever.
    expect(row?.total).toBe(rule.maxAttempts);
  }, 120_000);

  it('a success flips its row out of the account failure count, freeing the window', async () => {
    const { db } = testDb;
    const first = await reserveAttempt(db, { key: 'ok@example.com', scope: 'account', action: 'login', rule: { windowMs: 60_000, maxAttempts: 1 } });
    expect(first.limited).toBe(false);

    const blocked = await reserveAttempt(db, { key: 'ok@example.com', scope: 'account', action: 'login', rule: { windowMs: 60_000, maxAttempts: 1 } });
    expect(blocked.limited).toBe(true);

    await markAttemptSucceeded(db, first.attemptId);

    const afterSuccess = await reserveAttempt(db, { key: 'ok@example.com', scope: 'account', action: 'login', rule: { windowMs: 60_000, maxAttempts: 1 } });
    expect(afterSuccess.limited).toBe(false);
  }, 120_000);

  it('the ip bucket counts successes too, so flipping one does not free its window', async () => {
    const ipKey = 'b'.repeat(64);
    const { db } = testDb;
    const one = { windowMs: 60_000, maxAttempts: 1 };
    const first = await reserveAttempt(db, { key: ipKey, scope: 'ip', action: 'login', rule: one });
    expect(first.limited).toBe(false);
    await markAttemptSucceeded(db, first.attemptId);
    const second = await reserveAttempt(db, { key: ipKey, scope: 'ip', action: 'login', rule: one });
    expect(second.limited).toBe(true);
  }, 120_000);

  it('reserveAttemptPair is limited if EITHER bucket is full, and always burns the ip budget', async () => {
    const { db } = testDb;
    const ipKey = 'c'.repeat(64);
    // Fill the account bucket only (login.account = 8).
    await Promise.all(
      Array.from({ length: 10 }, () =>
        reserveAttempt(db, { key: 'pair@example.com', scope: 'account', action: 'login', rule }),
      ),
    );
    const gate = await reserveAttemptPair(db, { ipKey, accountKey: 'pair@example.com', action: 'login' });
    expect(gate.limited).toBe(true);
    expect(gate.account.limited).toBe(true);
    // The ip half still recorded: an attempt refused by the account bucket must not be a
    // free request from that IP's point of view.
    expect(gate.ip.limited).toBe(false);
    expect(gate.ip.attemptId).not.toBeNull();
  }, 120_000);
});

/**
 * The same defect, proven end to end through the real `POST /api/auth/login` handler —
 * this is the shape an attacker actually uses (N sockets open at once), and the shape the
 * pre-fix code let through completely.
 */
describe('POST /api/auth/login under concurrency — F-01 end to end', () => {
  const ORIGIN = 'https://fitmacro.test';
  const loginReq = (email: string, password: string, ip: string) =>
    new Request(ORIGIN + '/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN, 'x-real-ip': ip },
      body: JSON.stringify({ email, password }),
    });

  it('20 simultaneous wrong-password logins from 20 different IPs cannot exceed the per-account cap of 8', async () => {
    const { db } = testDb;
    const signup = (await import('../../auth/signup.js')).createHandler({ db, pepper: TEST_PEPPER });
    const created = await signup(
      new Request(ORIGIN + '/api/auth/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: ORIGIN },
        body: JSON.stringify({ email: 'brute@example.com', password: 'correct-password-123' }),
      }),
    );
    expect(created.status).toBe(201);

    const login = (await import('../../auth/login.js')).createHandler({ db, pepper: TEST_PEPPER });
    const responses = await Promise.all(
      // Rotating the IP defeats the per-IP bucket on purpose, so the per-account bucket
      // is the only thing left holding the line — exactly the attack F-01 described.
      Array.from({ length: 20 }, (_, i) => login(loginReq('brute@example.com', 'wrong-password-' + i, '10.1.1.' + i))),
    );
    const statuses = responses.map((r) => r.status);
    const tally = statuses.reduce<Record<number, number>>((acc, s) => ({ ...acc, [s]: (acc[s] ?? 0) + 1 }), {});

    // Every password below is >= 8 chars so zod never rejects one: all 20 requests must
    // reach the limiter, or the test would silently be measuring validation, not throttling.
    expect(tally[400] ?? 0).toBe(0);
    // Nothing may fall over: a limiter that throws is not a limiter.
    expect(tally[500] ?? 0).toBe(0);
    expect((tally[401] ?? 0) + (tally[429] ?? 0)).toBe(20);
    // The invariant that failed before the fix (it was 20 allowed / 0 blocked).
    expect(tally[401] ?? 0).toBeLessThanOrEqual(8);
    expect(tally[429] ?? 0).toBeGreaterThanOrEqual(12);
  }, 300_000);
});

/**
 * Why `reserveAttempt` exists at all, pinned as an executable fact rather than a comment.
 *
 * `isRateLimited` and `recordAttempt` are still exported and unchanged — they are the
 * primitives. This test drives them in the ORIGINAL order (check -> do slow work ->
 * record) and shows that order is unsound under concurrency, so nobody re-introduces it
 * believing the threshold alone is the control.
 */
describe('the check-then-work-then-record ordering is unsound — F-01 root cause', () => {
  it('every concurrent caller passes a check that none of them has yet recorded', async () => {
    const { db } = testDb;
    const key = 'rootcause@example.com';

    const oldStyleAttempt = async () => {
      const limited = await isRateLimited(db, { key, scope: 'account', action: 'login', rule });
      if (limited) return 'blocked' as const;
      // Stand-in for `await verifySecret(...)`: the real handler spent 50-200 ms of
      // argon2id here, holding the window open the whole time.
      await new Promise((r) => setTimeout(r, 5));
      await recordAttempt(db, { key, scope: 'account', action: 'login', success: false });
      return 'allowed' as const;
    };

    const outcomes = await Promise.all(Array.from({ length: 20 }, oldStyleAttempt));
    const allowed = outcomes.filter((o) => o === 'allowed').length;

    // The defect, stated as an assertion: the cap is 8 and the old ordering lets all 20
    // through. If a future change ever makes this pass at <= 8, the ordering has been
    // made atomic and this test should be revisited, not deleted.
    expect(allowed).toBeGreaterThan(rule.maxAttempts);
    expect(allowed).toBe(20);
  }, 300_000);
});
