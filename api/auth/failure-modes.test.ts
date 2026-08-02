// @vitest-environment node
/**
 * Proof for the P2.4 audit's second batch of auth findings — the internal security audit F-07,
 * F-09, F-10, F-11. Every case runs the REAL handler against a REAL Postgres (PGlite,
 * full committed migration chain per `beforeEach`), matching the standard §0 sets: an
 * attack is executed, not reasoned about.
 *
 * Two of these findings are about what happens when a statement DOESN'T run — there is
 * no transaction on `neon-http`, so a process death between two statements is a real
 * state the deployment can reach. That is simulated by a fault-injecting `db` proxy
 * (`dbFailingUpdateOn` below) rather than described in prose, because "which of the two
 * writes already committed?" is precisely the thing a comment cannot prove.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { sessions, users } from '../_lib/db/schema.js';
import { freshTestDb, TEST_PEPPER, type TestDb } from '../_lib/db/testDb.js';
import type { Db } from '../_lib/db/client.js';
import { createHandler as createSignupHandler } from './signup.js';
import { createHandler as createLoginHandler } from './login.js';
import { createHandler as createRecoveryHandler } from './recovery-redeem.js';
import { createHandler as createChangePasswordHandler } from './change-password.js';

const ORIGIN = 'https://fitmacro.test';

function req(path: string, method: string, headers: Record<string, string> = {}, body?: unknown): Request {
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers: { 'content-type': 'application/json', origin: ORIGIN, ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

function cookieFromSetCookie(setCookie: string | null): string {
  const value = setCookie?.split(';')[0];
  if (!value) throw new Error('test setup: no Set-Cookie header');
  return value;
}

let testDb: TestDb;

beforeEach(async () => {
  testDb = await freshTestDb();
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await testDb.close();
});

async function signUp(email: string, password: string) {
  const handler = createSignupHandler({ db: testDb.db, pepper: TEST_PEPPER });
  const response = await handler(req('/api/auth/signup', 'POST', {}, { email, password }));
  if (response.status !== 201) throw new Error(`test setup: signup returned ${response.status}`);
  const body = (await response.json()) as { user: { id: string }; recoveryCode: string };
  return {
    userId: body.user.id,
    recoveryCode: body.recoveryCode,
    cookie: cookieFromSetCookie(response.headers.get('Set-Cookie')),
  };
}

async function liveSessionCount(userId: string): Promise<number> {
  const rows = await testDb.db
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
  return rows.length;
}

async function passwordHashOf(userId: string): Promise<string> {
  const [row] = await testDb.db.select({ h: users.passwordHash }).from(users).where(eq(users.id, userId)).limit(1);
  if (!row) throw new Error('test setup: user vanished');
  return row.h;
}

/**
 * A `db` that behaves exactly like the real one until someone tries to `update()` the
 * given table, at which point it throws — standing in for the process dying between two
 * un-transacted statements. Only `update` is intercepted; every other method passes
 * straight through to the real PGlite handle, so the rest of the handler is genuinely
 * exercised.
 */
function dbFailingUpdateOn(real: Db, table: unknown): Db {
  return new Proxy(real as object, {
    get(target, prop, receiver) {
      if (prop === 'update') {
        return (arg: unknown) => {
          if (arg === table) throw new Error('simulated process death mid-write');
          return (target as Db).update(arg as never);
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as Db;
}

/* ------------------------------------------------------------------ *
 * F-07 — concurrent signup for one email is 409, not 500              *
 * ------------------------------------------------------------------ */

describe('F-07 — a concurrent signup collision is reported as 409, not 500', () => {
  it('two simultaneous signups for one email: one 201, one 409, exactly one account', async () => {
    const handler = createSignupHandler({ db: testDb.db, pepper: TEST_PEPPER });
    const email = 'race@example.com';

    // Different IPs so the per-IP velocity brake plays no part in the outcome; the
    // per-account bucket allows both attempts.
    const [a, b] = await Promise.all([
      handler(req('/api/auth/signup', 'POST', { 'x-real-ip': '10.0.0.1' }, { email, password: 'password123' })),
      handler(req('/api/auth/signup', 'POST', { 'x-real-ip': '10.0.0.2' }, { email, password: 'password456' })),
    ]);

    const statuses = [a.status, b.status].sort();

    // The part that always worked and must keep working: the unique index means there is
    // exactly one account no matter who wins.
    const accounts = await testDb.db.select({ id: users.id }).from(users).where(eq(users.email, email));
    expect(accounts).toHaveLength(1);

    // The part F-07 was about: whatever happened, nobody gets a 500.
    expect(statuses).not.toContain(500);
    expect(statuses[0]).toBe(201);
    expect(statuses[1]).toBe(409);

    const loser = a.status === 409 ? a : b;
    await expect(loser.json()).resolves.toEqual({ error: 'email_taken' });
  });

  it('a unique violation that is NOT the email index still surfaces as a genuine 500', async () => {
    // Guards the narrowness of the fix: `isUniqueViolationOn(..., 'users_email_key')`
    // must not swallow unrelated 23505s into a confidently wrong "email_taken".
    const { isUniqueViolationOn } = await import('../_lib/db/pg-errors.js');
    const otherViolation = { cause: { code: '23505', constraint: 'sessions_token_hash_key' } };
    expect(isUniqueViolationOn(otherViolation, 'users_email_key')).toBe(false);
    expect(isUniqueViolationOn({ cause: { code: '23505', constraint: 'users_email_key' } }, 'users_email_key')).toBe(
      true,
    );
    expect(isUniqueViolationOn({ cause: { code: '23503' } }, 'users_email_key')).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * F-09 — recovery redemption is an atomic compare-and-swap            *
 * ------------------------------------------------------------------ */

describe('F-09 — concurrent redemption of one recovery code cannot hand out two codes', () => {
  it('two simultaneous redemptions: exactly one succeeds, and the winner\'s new code is the real one', async () => {
    const email = 'recover@example.com';
    const { recoveryCode } = await signUp(email, 'password123');
    const handler = createRecoveryHandler({ db: testDb.db, pepper: TEST_PEPPER });

    const [a, b] = await Promise.all([
      handler(
        req('/api/auth/recovery-redeem', 'POST', { 'x-real-ip': '10.0.1.1' }, {
          email,
          recoveryCode,
          newPassword: 'newPasswordAAA1',
        }),
      ),
      handler(
        req('/api/auth/recovery-redeem', 'POST', { 'x-real-ip': '10.0.1.2' }, {
          email,
          recoveryCode,
          newPassword: 'newPasswordBBB2',
        }),
      ),
    ]);

    const winners = [a, b].filter((r) => r.status === 200);
    const losers = [a, b].filter((r) => r.status !== 200);

    // The defect was that BOTH returned 200, each showing a different "your new recovery
    // code" — and only one of those codes actually existed on the account.
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(losers[0]!.status).toBe(401);
    expect([a.status, b.status]).not.toContain(500);

    const winnerBody = (await winners[0]!.json()) as { recoveryCode: string };

    // The code the surviving caller was shown must be the one that works. This is the
    // whole point: a user writes this down as their only way back into the account.
    const second = await handler(
      req('/api/auth/recovery-redeem', 'POST', { 'x-real-ip': '10.0.1.3' }, {
        email,
        recoveryCode: winnerBody.recoveryCode,
        newPassword: 'thirdPassword33',
      }),
    );
    expect(second.status).toBe(200);
  });

  it('sequential single-use is unchanged — the old code stops working after a redemption', async () => {
    const email = 'seq@example.com';
    const { recoveryCode } = await signUp(email, 'password123');
    const handler = createRecoveryHandler({ db: testDb.db, pepper: TEST_PEPPER });

    const first = await handler(
      req('/api/auth/recovery-redeem', 'POST', {}, { email, recoveryCode, newPassword: 'newPassword111' }),
    );
    expect(first.status).toBe(200);

    const replay = await handler(
      req('/api/auth/recovery-redeem', 'POST', {}, { email, recoveryCode, newPassword: 'newPassword222' }),
    );
    expect(replay.status).toBe(401);
  });
});

/* ------------------------------------------------------------------ *
 * F-10 — credential writes fail CLOSED, not open                      *
 * ------------------------------------------------------------------ */

describe('F-10 — a crash mid-credential-change leaves sessions dead, not the password changed', () => {
  it('change-password: the write dying leaves every session revoked and the password UNCHANGED', async () => {
    const email = 'failclosed@example.com';
    const { userId, cookie } = await signUp(email, 'password123');

    // A second live session — the "previously stolen cookie" this ordering protects.
    const login = createLoginHandler({ db: testDb.db, pepper: TEST_PEPPER });
    const other = await login(req('/api/auth/login', 'POST', {}, { email, password: 'password123' }));
    expect(other.status).toBe(200);
    expect(await liveSessionCount(userId)).toBe(2);

    const before = await passwordHashOf(userId);

    const handler = createChangePasswordHandler({
      db: dbFailingUpdateOn(testDb.db, users),
      pepper: TEST_PEPPER,
    });
    const response = await handler(
      req('/api/auth/change-password', 'POST', { cookie }, {
        currentPassword: 'password123',
        newPassword: 'brandNewPassword9',
      }),
    );

    // The request fails, as it must — nothing is being claimed to have succeeded.
    expect(response.status).toBe(500);

    // Fail CLOSED: sessions are already gone...
    expect(await liveSessionCount(userId)).toBe(0);
    // ...and the password is untouched, so no live cookie outlives a changed credential.
    expect(await passwordHashOf(userId)).toBe(before);

    // The old password still works, which is the harmless direction: the user simply retries.
    const relogin = await login(req('/api/auth/login', 'POST', {}, { email, password: 'password123' }));
    expect(relogin.status).toBe(200);
  });

  it('recovery-redeem: same ordering — sessions revoked before the credential write', async () => {
    const email = 'failclosed2@example.com';
    const { userId, recoveryCode } = await signUp(email, 'password123');
    expect(await liveSessionCount(userId)).toBe(1);

    const before = await passwordHashOf(userId);

    const handler = createRecoveryHandler({
      db: dbFailingUpdateOn(testDb.db, users),
      pepper: TEST_PEPPER,
    });
    const response = await handler(
      req('/api/auth/recovery-redeem', 'POST', {}, { email, recoveryCode, newPassword: 'newPassword777' }),
    );

    expect(response.status).toBe(500);
    expect(await liveSessionCount(userId)).toBe(0);
    expect(await passwordHashOf(userId)).toBe(before);
  });

  it('the happy path still revokes other sessions and issues exactly one fresh one', async () => {
    // The reordering must not weaken the normal outcome it exists to guarantee.
    const email = 'happy@example.com';
    const { userId, cookie } = await signUp(email, 'password123');
    const login = createLoginHandler({ db: testDb.db, pepper: TEST_PEPPER });
    await login(req('/api/auth/login', 'POST', {}, { email, password: 'password123' }));
    expect(await liveSessionCount(userId)).toBe(2);

    const handler = createChangePasswordHandler({ db: testDb.db, pepper: TEST_PEPPER });
    const response = await handler(
      req('/api/auth/change-password', 'POST', { cookie }, {
        currentPassword: 'password123',
        newPassword: 'brandNewPassword9',
      }),
    );

    expect(response.status).toBe(200);
    expect(await liveSessionCount(userId)).toBe(1);

    const withNew = await login(req('/api/auth/login', 'POST', {}, { email, password: 'brandNewPassword9' }));
    expect(withNew.status).toBe(200);
  });
});

/* ------------------------------------------------------------------ *
 * F-11 — a too-short SESSION_PEPPER is a configuration failure        *
 * ------------------------------------------------------------------ */

describe('F-11 — SESSION_PEPPER has a length floor, and a short one is 503 not silent', () => {
  it('refuses a 1-character pepper with the existing sync_unconfigured contract', async () => {
    vi.stubEnv('SESSION_PEPPER', 'x');
    const handler = createSignupHandler({ db: testDb.db });
    const response = await handler(req('/api/auth/signup', 'POST', {}, { email: 'a@example.com', password: 'password123' }));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: 'sync_unconfigured' });
  });

  it('refuses anything under the floor, and accepts a real 32-byte secret at every common encoding', async () => {
    const handler = createSignupHandler({ db: testDb.db });

    vi.stubEnv('SESSION_PEPPER', 'a'.repeat(31));
    expect((await handler(req('/api/auth/signup', 'POST', {}, { email: 'b@example.com', password: 'password123' }))).status).toBe(503);

    // 44 chars = base64 of 32 bytes; 64 chars = hex of 32 bytes. docs/DEPLOY.md §2 tells
    // the operator to generate exactly that, so neither encoding may be rejected.
    vi.stubEnv('SESSION_PEPPER', 'a'.repeat(44));
    expect((await handler(req('/api/auth/signup', 'POST', {}, { email: 'c@example.com', password: 'password123' }))).status).toBe(201);

    vi.stubEnv('SESSION_PEPPER', 'a'.repeat(64));
    expect((await handler(req('/api/auth/signup', 'POST', {}, { email: 'd@example.com', password: 'password123' }))).status).toBe(201);
  });

  it('does not log the pepper itself when refusing it', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubEnv('SESSION_PEPPER', 'super-secret-but-short');
    const handler = createSignupHandler({ db: testDb.db });
    await handler(req('/api/auth/signup', 'POST', {}, { email: 'e@example.com', password: 'password123' }));

    const logged = JSON.stringify(spy.mock.calls);
    expect(logged).not.toContain('super-secret-but-short');
    expect(logged).toContain('SESSION_PEPPER');
    spy.mockRestore();
  });
});
