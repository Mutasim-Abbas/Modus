// @vitest-environment node
import { freshTestDb, TEST_PEPPER, type TestDb } from '../_lib/db/testDb.js';
import { createHandler as createSignupHandler } from './signup.js';
import { createHandler as createLoginHandler } from './login.js';
import { createHandler as createRecoveryHandler } from './recovery-redeem.js';
import { createHandler as createMeHandler } from './me.js';

const ORIGIN = 'https://modus.test';

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
  const body = (await response.json()) as { user: { id: string }; recoveryCode: string };
  return { recoveryCode: body.recoveryCode, cookie: cookieFromSetCookie(response.headers.get('Set-Cookie')) };
}

describe('the 503 contract', () => {
  it('returns 503 when DATABASE_URL is unset', async () => {
    vi.stubEnv('DATABASE_URL', '');
    vi.stubEnv('SESSION_PEPPER', TEST_PEPPER);
    const response = await createRecoveryHandler()(req('/api/auth/recovery-redeem', 'POST'));
    expect(response.status).toBe(503);
  });
});

describe('no user/code enumeration', () => {
  it('a wrong code and a non-existent email produce the identical status and body', async () => {
    await signUp('recover@example.com', 'password123');
    const handler = createRecoveryHandler({ db: testDb.db, pepper: TEST_PEPPER });

    const wrongCode = await handler(
      req(
        '/api/auth/recovery-redeem',
        'POST',
        {},
        { email: 'recover@example.com', recoveryCode: 'WRONG-CODE-1234-ABCD', newPassword: 'newPassword123' },
      ),
    );
    const wrongEmail = await handler(
      req(
        '/api/auth/recovery-redeem',
        'POST',
        {},
        {
          email: 'nobody-registered@example.com',
          recoveryCode: 'WRONG-CODE-1234-ABCD',
          newPassword: 'newPassword123',
        },
      ),
    );

    expect(wrongCode.status).toBe(wrongEmail.status);
    expect(wrongCode.status).toBe(401);
    await expect(wrongCode.json()).resolves.toEqual({ error: 'recovery_invalid' });
    await expect(wrongEmail.json()).resolves.toEqual({ error: 'recovery_invalid' });
  });
});

describe('happy path — single-use, regenerable', () => {
  it('redeems the code, sets a new password, logs in fresh, and shows a NEW recovery code once', async () => {
    const { recoveryCode } = await signUp('redeem@example.com', 'password123');
    const handler = createRecoveryHandler({ db: testDb.db, pepper: TEST_PEPPER });
    const loginHandler = createLoginHandler({ db: testDb.db, pepper: TEST_PEPPER });
    const meHandler = createMeHandler({ db: testDb.db, pepper: TEST_PEPPER });

    const response = await handler(
      req(
        '/api/auth/recovery-redeem',
        'POST',
        {},
        { email: 'redeem@example.com', recoveryCode, newPassword: 'freshPassword456' },
      ),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { recoveryCode: string };
    expect(body.recoveryCode).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(body.recoveryCode).not.toBe(recoveryCode);

    const newCookie = cookieFromSetCookie(response.headers.get('Set-Cookie'));
    expect((await meHandler(req('/api/auth/me', 'GET', { cookie: newCookie }))).status).toBe(200);

    // The new password works.
    const newLogin = await loginHandler(
      req('/api/auth/login', 'POST', {}, { email: 'redeem@example.com', password: 'freshPassword456' }),
    );
    expect(newLogin.status).toBe(200);
    // The old password no longer works.
    const oldLogin = await loginHandler(
      req('/api/auth/login', 'POST', {}, { email: 'redeem@example.com', password: 'password123' }),
    );
    expect(oldLogin.status).toBe(401);
  });

  it('the old recovery code is single-use — reusing it fails', async () => {
    const { recoveryCode } = await signUp('single-use@example.com', 'password123');
    const handler = createRecoveryHandler({ db: testDb.db, pepper: TEST_PEPPER });

    const first = await handler(
      req(
        '/api/auth/recovery-redeem',
        'POST',
        {},
        { email: 'single-use@example.com', recoveryCode, newPassword: 'firstNewPassword1' },
      ),
    );
    expect(first.status).toBe(200);

    const second = await handler(
      req(
        '/api/auth/recovery-redeem',
        'POST',
        {},
        { email: 'single-use@example.com', recoveryCode, newPassword: 'secondNewPassword2' },
      ),
    );
    expect(second.status).toBe(401);
    await expect(second.json()).resolves.toEqual({ error: 'recovery_invalid' });
  });

  it('is case/dash-insensitive on the recovery code (normalized before hashing/verifying)', async () => {
    const { recoveryCode } = await signUp('normalize@example.com', 'password123');
    const handler = createRecoveryHandler({ db: testDb.db, pepper: TEST_PEPPER });

    const retyped = recoveryCode.toLowerCase().replace(/-/g, ' ');
    const response = await handler(
      req(
        '/api/auth/recovery-redeem',
        'POST',
        {},
        { email: 'normalize@example.com', recoveryCode: retyped, newPassword: 'newPassword123' },
      ),
    );
    expect(response.status).toBe(200);
  });

  it('rejects a cross-site Origin', async () => {
    const { recoveryCode } = await signUp('origin@example.com', 'password123');
    const handler = createRecoveryHandler({ db: testDb.db, pepper: TEST_PEPPER });
    const response = await handler(
      req(
        '/api/auth/recovery-redeem',
        'POST',
        { origin: 'https://evil.example' },
        { email: 'origin@example.com', recoveryCode, newPassword: 'newPassword123' },
      ),
    );
    expect(response.status).toBe(403);
  });
});

describe('rate limiting', () => {
  it('blocks after the per-account threshold', async () => {
    await signUp('throttled@example.com', 'password123');
    const handler = createRecoveryHandler({ db: testDb.db, pepper: TEST_PEPPER });

    for (let i = 0; i < 5; i += 1) {
      await handler(
        req(
          '/api/auth/recovery-redeem',
          'POST',
          { 'x-real-ip': `172.16.0.${i}` },
          { email: 'throttled@example.com', recoveryCode: 'WRONG-CODE-0000-ZZZZ', newPassword: 'newPassword123' },
        ),
      );
    }
    const blocked = await handler(
      req(
        '/api/auth/recovery-redeem',
        'POST',
        { 'x-real-ip': '172.16.0.99' },
        { email: 'throttled@example.com', recoveryCode: 'WRONG-CODE-0000-ZZZZ', newPassword: 'newPassword123' },
      ),
    );
    expect(blocked.status).toBe(429);
  });
});
