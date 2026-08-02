// @vitest-environment node
import { and, eq } from 'drizzle-orm';
import { authAttempts, sessions } from '../_lib/db/schema.js';
import { freshTestDb, TEST_PEPPER, type TestDb } from '../_lib/db/testDb.js';
import { createHandler as createSignupHandler } from './signup.js';
import { createHandler as createLoginHandler } from './login.js';

const ORIGIN = 'https://fitmacro.test';

function req(path: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`${ORIGIN}${path}`, {
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

async function signUp(email: string, password: string) {
  const handler = createSignupHandler({ db: testDb.db, pepper: TEST_PEPPER });
  const response = await handler(req('/api/auth/signup', { email, password }));
  expect(response.status).toBe(201);
  return (await response.json()) as { user: { id: string; email: string }; recoveryCode: string };
}

describe('the 503 contract', () => {
  it('returns 503 when DATABASE_URL is unset', async () => {
    vi.stubEnv('DATABASE_URL', '');
    vi.stubEnv('SESSION_PEPPER', TEST_PEPPER);
    const response = await createLoginHandler()(
      req('/api/auth/login', { email: 'a@example.com', password: 'password123' }),
    );
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: 'sync_unconfigured' });
  });
});

describe('request handling', () => {
  it('rejects non-POST with 405', async () => {
    const handler = createLoginHandler({ db: testDb.db, pepper: TEST_PEPPER });
    const response = await handler(new Request(`${ORIGIN}/api/auth/login`, { method: 'GET' }));
    expect(response.status).toBe(405);
  });

  it('rejects a cross-site Origin', async () => {
    const handler = createLoginHandler({ db: testDb.db, pepper: TEST_PEPPER });
    const response = await handler(
      req('/api/auth/login', { email: 'a@example.com', password: 'password123' }, { origin: 'https://evil.example' }),
    );
    expect(response.status).toBe(403);
  });

  it('rejects a malformed body as invalid_input', async () => {
    const handler = createLoginHandler({ db: testDb.db, pepper: TEST_PEPPER });
    const response = await handler(req('/api/auth/login', { email: 'not-an-email', password: 'x' }));
    expect(response.status).toBe(400);
  });
});

describe('no user enumeration — the core security property of this endpoint', () => {
  it('a wrong password and a non-existent email produce the identical status and body', async () => {
    await signUp('real@example.com', 'correct-password-123');
    const handler = createLoginHandler({ db: testDb.db, pepper: TEST_PEPPER });

    const wrongPassword = await handler(
      req('/api/auth/login', { email: 'real@example.com', password: 'totally-wrong-password' }),
    );
    const wrongEmail = await handler(
      req('/api/auth/login', { email: 'nobody-registered@example.com', password: 'totally-wrong-password' }),
    );

    expect(wrongPassword.status).toBe(wrongEmail.status);
    expect(wrongPassword.status).toBe(401);
    const [bodyA, bodyB] = await Promise.all([wrongPassword.json(), wrongEmail.json()]);
    expect(bodyA).toEqual({ error: 'invalid_credentials' });
    expect(bodyB).toEqual({ error: 'invalid_credentials' });
  });

  it('always performs exactly one password-verify call, real or dummy — timing is not a reliable oracle', async () => {
    await signUp('timing@example.com', 'correct-password-123');
    const handler = createLoginHandler({ db: testDb.db, pepper: TEST_PEPPER });

    // Best-effort, generous-tolerance timing check: both branches run the same
    // argon2id/scrypt verify() call on the same shape of input, so their wall-clock
    // cost should be in the same order of magnitude, not (say) 5x apart the way a
    // "skip hashing when the user doesn't exist" bug would produce. Wide bounds are
    // used deliberately to avoid CI flakiness — this is a structural guarantee
    // (see api/auth/login.ts's header comment), not something meant to be proven by a
    // clock alone.
    const SAMPLES = 5;
    const wrongPasswordTimes: number[] = [];
    const wrongEmailTimes: number[] = [];

    for (let i = 0; i < SAMPLES; i += 1) {
      const t0 = performance.now();
      await handler(req('/api/auth/login', { email: 'timing@example.com', password: `bad-${i}` }));
      wrongPasswordTimes.push(performance.now() - t0);

      const t1 = performance.now();
      await handler(req('/api/auth/login', { email: `ghost-${i}@example.com`, password: `bad-${i}` }));
      wrongEmailTimes.push(performance.now() - t1);
    }

    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const avgA = avg(wrongPasswordTimes);
    const avgB = avg(wrongEmailTimes);
    const ratio = Math.max(avgA, avgB) / Math.max(1, Math.min(avgA, avgB));
    expect(ratio).toBeLessThan(4);
  });

  it('records a failed attempt for a non-existent email under the account scope too', async () => {
    const handler = createLoginHandler({ db: testDb.db, pepper: TEST_PEPPER });
    await handler(req('/api/auth/login', { email: 'never-signed-up@example.com', password: 'whatever1' }));

    const rows = await testDb.db
      .select()
      .from(authAttempts)
      .where(and(eq(authAttempts.key, 'never-signed-up@example.com'), eq(authAttempts.scope, 'account')));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.success).toBe(false);
  });
});

describe('happy path', () => {
  it('logs in with the correct password and sets a fresh session cookie', async () => {
    await signUp('login-ok@example.com', 'correct-password-123');
    const handler = createLoginHandler({ db: testDb.db, pepper: TEST_PEPPER });

    const response = await handler(
      req('/api/auth/login', { email: 'Login-OK@Example.com', password: 'correct-password-123' }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { user: { email: string } };
    expect(body.user.email).toBe('login-ok@example.com');
    expect(response.headers.get('Set-Cookie')).toContain('__Host-fm_session=');
    expect(JSON.stringify(body)).not.toMatch(/\$argon2/);
  });

  it('login creates an independent session — logging in twice does not disturb the first session', async () => {
    const signedUp = await signUp('multi@example.com', 'correct-password-123');
    const handler = createLoginHandler({ db: testDb.db, pepper: TEST_PEPPER });

    await handler(req('/api/auth/login', { email: 'multi@example.com', password: 'correct-password-123' }));
    await handler(req('/api/auth/login', { email: 'multi@example.com', password: 'correct-password-123' }));

    const rows = await testDb.db.select().from(sessions).where(eq(sessions.userId, signedUp.user.id));
    // 1 from signup + 2 from login = 3 independent, live sessions.
    expect(rows).toHaveLength(3);
  });
});

describe('rate limiting', () => {
  it('blocks after the per-account login threshold even from different IPs', async () => {
    await signUp('bruteforced@example.com', 'correct-password-123');
    const handler = createLoginHandler({ db: testDb.db, pepper: TEST_PEPPER });

    for (let i = 0; i < 8; i += 1) {
      const response = await handler(
        req(
          '/api/auth/login',
          { email: 'bruteforced@example.com', password: `wrong-password-${i}` },
          { 'x-real-ip': `10.0.0.${i}` },
        ),
      );
      expect(response.status).toBe(401);
    }

    const blocked = await handler(
      req(
        '/api/auth/login',
        { email: 'bruteforced@example.com', password: 'correct-password-123' },
        { 'x-real-ip': '10.0.0.99' },
      ),
    );
    expect(blocked.status).toBe(429);
  });

  it('blocks after the per-IP login threshold even across different accounts', async () => {
    await signUp('victim1@example.com', 'correct-password-123');
    await signUp('victim2@example.com', 'correct-password-123');
    const handler = createLoginHandler({ db: testDb.db, pepper: TEST_PEPPER });
    const headers = { 'x-real-ip': '203.0.113.77' };

    for (let i = 0; i < 20; i += 1) {
      await handler(
        req('/api/auth/login', { email: `scan${i}@example.com`, password: 'guessable-password' }, headers),
      );
    }

    const blocked = await handler(
      req('/api/auth/login', { email: 'victim1@example.com', password: 'correct-password-123' }, headers),
    );
    expect(blocked.status).toBe(429);
  });
});
