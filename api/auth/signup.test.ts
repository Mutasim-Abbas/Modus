// @vitest-environment node
import { eq } from 'drizzle-orm';
import { sessions, users } from '../_lib/db/schema.js';
import { freshTestDb, TEST_PEPPER, type TestDb } from '../_lib/db/testDb.js';
import { createHandler } from './signup.js';

const ORIGIN = 'https://modus.test';

function signupRequest(
  body: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request(`${ORIGIN}/api/auth/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN, ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

let testDb: TestDb;

beforeEach(async () => {
  testDb = await freshTestDb();
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await testDb.close();
});

describe('the 503 contract — sync_unconfigured, never a 500', () => {
  it('returns 503 when DATABASE_URL is unset', async () => {
    vi.stubEnv('DATABASE_URL', '');
    vi.stubEnv('SESSION_PEPPER', TEST_PEPPER);
    const response = await createHandler()(
      signupRequest({ email: 'a@example.com', password: 'password123' }),
    );
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: 'sync_unconfigured' });
  });

  it('returns 503 when SESSION_PEPPER is unset, even with a real db', async () => {
    const handler = createHandler({ db: testDb.db });
    vi.stubEnv('SESSION_PEPPER', '');
    const response = await handler(signupRequest({ email: 'a@example.com', password: 'password123' }));
    expect(response.status).toBe(503);
  });
});

describe('request handling', () => {
  it('rejects non-POST with 405', async () => {
    const handler = createHandler({ db: testDb.db, pepper: TEST_PEPPER });
    const response = await handler(new Request(`${ORIGIN}/api/auth/signup`, { method: 'GET' }));
    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('POST');
  });

  it('rejects a cross-site Origin with 403', async () => {
    const handler = createHandler({ db: testDb.db, pepper: TEST_PEPPER });
    const response = await handler(
      signupRequest({ email: 'a@example.com', password: 'password123' }, { origin: 'https://evil.example' }),
    );
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'origin_rejected' });
  });

  it('rejects a missing/malformed email', async () => {
    const handler = createHandler({ db: testDb.db, pepper: TEST_PEPPER });
    const response = await handler(signupRequest({ email: 'not-an-email', password: 'password123' }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'invalid_input' });
  });

  it('rejects a too-short password', async () => {
    const handler = createHandler({ db: testDb.db, pepper: TEST_PEPPER });
    const response = await handler(signupRequest({ email: 'a@example.com', password: 'short' }));
    expect(response.status).toBe(400);
  });

  it('rejects an unrecognised extra field (mass-assignment guard)', async () => {
    const handler = createHandler({ db: testDb.db, pepper: TEST_PEPPER });
    const response = await handler(
      signupRequest({ email: 'a@example.com', password: 'password123', isAdmin: true }),
    );
    expect(response.status).toBe(400);
  });

  it('rejects a SQL-meta-character-laden email as invalid input, not a server error', async () => {
    const handler = createHandler({ db: testDb.db, pepper: TEST_PEPPER });
    const response = await handler(
      signupRequest({ email: "a'; DROP TABLE users; --@example.com", password: 'password123' }),
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'invalid_input' });
  });

  it('an unparseable JSON body is invalid_input, not a crash', async () => {
    const handler = createHandler({ db: testDb.db, pepper: TEST_PEPPER });
    const response = await handler(signupRequest('{{{not json'));
    expect(response.status).toBe(400);
  });

  it('rejects an oversized body with 413 too_large, without ever buffering or parsing it', async () => {
    const handler = createHandler({ db: testDb.db, pepper: TEST_PEPPER });
    // Nowhere near a real auth body (email+password) — a JSON-bomb-shaped payload.
    const hugePassword = 'a'.repeat(2_000_000);
    const response = await handler(
      signupRequest({ email: 'huge@example.com', password: hugePassword }),
    );
    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({ error: 'too_large' });

    // Confirms nothing was created — the oversized body never reached validation/insert.
    const rows = await testDb.db.select({ id: users.id }).from(users).where(eq(users.email, 'huge@example.com'));
    expect(rows).toHaveLength(0);
  });
});

describe('happy path', () => {
  it('creates the account, sets a correctly-flagged cookie, and returns the recovery code once', async () => {
    const handler = createHandler({ db: testDb.db, pepper: TEST_PEPPER });
    const response = await handler(signupRequest({ email: ' New@Example.com ', password: 'password123' }));

    expect(response.status).toBe(201);
    const body = (await response.json()) as { user: { id: string; email: string }; recoveryCode: string };
    expect(body.user.email).toBe('new@example.com');
    expect(body.recoveryCode).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);

    const setCookie = response.headers.get('Set-Cookie');
    expect(setCookie).toContain('__Host-fm_session=');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Secure');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).toContain('Path=/');

    // Never leaked in the response body.
    const raw = JSON.stringify(body);
    expect(raw).not.toContain('passwordHash');
    expect(raw).not.toContain('recoveryCodeHash');
    expect(raw).not.toMatch(/\$argon2/);

    const [row] = await testDb.db.select().from(users).where(eq(users.email, 'new@example.com'));
    expect(row).toBeDefined();
    expect(row?.passwordHash.startsWith('$argon2id$') || row?.passwordHash.startsWith('scrypt$')).toBe(true);
    expect(row?.passwordHash).not.toContain('password123');
    expect(row?.recoveryCodeHash).not.toBe(body.recoveryCode);

    const sessionRows = await testDb.db.select().from(sessions).where(eq(sessions.userId, row!.id));
    expect(sessionRows).toHaveLength(1);
    expect(sessionRows[0]?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(sessionRows[0]?.ipHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects a duplicate email (case-insensitively) with 409, without leaking a hash', async () => {
    const handler = createHandler({ db: testDb.db, pepper: TEST_PEPPER });
    await handler(signupRequest({ email: 'dupe@example.com', password: 'password123' }));

    const second = await handler(
      signupRequest({ email: 'DUPE@Example.com', password: 'anotherPassword1' }),
    );
    expect(second.status).toBe(409);
    await expect(second.json()).resolves.toEqual({ error: 'email_taken' });
  });
});

describe('rate limiting — durable across the equivalent of a cold start', () => {
  it('blocks after the per-IP signup threshold, even across unique emails', async () => {
    const handler = createHandler({ db: testDb.db, pepper: TEST_PEPPER });
    const headers = { 'x-real-ip': '9.9.9.9' };

    for (let i = 0; i < 10; i += 1) {
      const response = await handler(
        signupRequest({ email: `user${i}@example.com`, password: 'password123' }, headers),
      );
      expect(response.status).toBe(201);
    }

    const blocked = await handler(
      signupRequest({ email: 'user-overflow@example.com', password: 'password123' }, headers),
    );
    expect(blocked.status).toBe(429);
    await expect(blocked.json()).resolves.toEqual({ error: 'rate_limited' });
    expect(blocked.headers.get('Retry-After')).toBeTruthy();
  });
});
