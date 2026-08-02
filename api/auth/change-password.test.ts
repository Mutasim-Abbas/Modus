// @vitest-environment node
import { eq } from 'drizzle-orm';
import { users } from '../_lib/db/schema.js';
import { freshTestDb, TEST_PEPPER, type TestDb } from '../_lib/db/testDb.js';
import { createHandler as createSignupHandler } from './signup.js';
import { createHandler as createLoginHandler } from './login.js';
import { createHandler as createChangePasswordHandler } from './change-password.js';
import { createHandler as createMeHandler } from './me.js';

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

async function signUpAndGetCookie(email: string, password: string): Promise<string> {
  const handler = createSignupHandler({ db: testDb.db, pepper: TEST_PEPPER });
  const response = await handler(req('/api/auth/signup', 'POST', {}, { email, password }));
  return cookieFromSetCookie(response.headers.get('Set-Cookie'));
}

describe('the 503 contract', () => {
  it('returns 503 when DATABASE_URL is unset', async () => {
    vi.stubEnv('DATABASE_URL', '');
    vi.stubEnv('SESSION_PEPPER', TEST_PEPPER);
    const response = await createChangePasswordHandler()(req('/api/auth/change-password', 'POST'));
    expect(response.status).toBe(503);
  });
});

describe('request handling', () => {
  it('requires authentication', async () => {
    const handler = createChangePasswordHandler({ db: testDb.db, pepper: TEST_PEPPER });
    const response = await handler(
      req('/api/auth/change-password', 'POST', {}, { currentPassword: 'a', newPassword: 'password123' }),
    );
    expect(response.status).toBe(401);
  });

  it('rejects a cross-site Origin even with a valid cookie', async () => {
    const cookie = await signUpAndGetCookie('cp-origin@example.com', 'password123');
    const handler = createChangePasswordHandler({ db: testDb.db, pepper: TEST_PEPPER });
    const response = await handler(
      req(
        '/api/auth/change-password',
        'POST',
        { cookie, origin: 'https://evil.example' },
        { currentPassword: 'password123', newPassword: 'newPassword456' },
      ),
    );
    expect(response.status).toBe(403);
  });

  it('rejects a wrong current password with 401, unchanged', async () => {
    const cookie = await signUpAndGetCookie('cp-wrong@example.com', 'password123');
    const handler = createChangePasswordHandler({ db: testDb.db, pepper: TEST_PEPPER });
    const response = await handler(
      req(
        '/api/auth/change-password',
        'POST',
        { cookie },
        { currentPassword: 'totally-wrong', newPassword: 'newPassword456' },
      ),
    );
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'invalid_credentials' });
  });
});

describe('happy path — rotation', () => {
  it('changes the password, revokes the old session, and issues a fresh one', async () => {
    const cookie = await signUpAndGetCookie('cp-ok@example.com', 'password123');
    const handler = createChangePasswordHandler({ db: testDb.db, pepper: TEST_PEPPER });
    const meHandler = createMeHandler({ db: testDb.db, pepper: TEST_PEPPER });
    const loginHandler = createLoginHandler({ db: testDb.db, pepper: TEST_PEPPER });

    const response = await handler(
      req(
        '/api/auth/change-password',
        'POST',
        { cookie },
        { currentPassword: 'password123', newPassword: 'brandNewPassword789' },
      ),
    );
    expect(response.status).toBe(200);
    const newCookie = cookieFromSetCookie(response.headers.get('Set-Cookie'));
    expect(newCookie).not.toBe(cookie);

    // Old cookie is dead (rotation).
    expect((await meHandler(req('/api/auth/me', 'GET', { cookie }))).status).toBe(401);
    // New cookie works.
    expect((await meHandler(req('/api/auth/me', 'GET', { cookie: newCookie }))).status).toBe(200);

    // Old password no longer works; new one does.
    const oldLogin = await loginHandler(
      req('/api/auth/login', 'POST', {}, { email: 'cp-ok@example.com', password: 'password123' }),
    );
    expect(oldLogin.status).toBe(401);
    const newLogin = await loginHandler(
      req('/api/auth/login', 'POST', {}, { email: 'cp-ok@example.com', password: 'brandNewPassword789' }),
    );
    expect(newLogin.status).toBe(200);

    const [row] = await testDb.db.select().from(users).where(eq(users.email, 'cp-ok@example.com'));
    expect(row?.passwordHash).not.toContain('brandNewPassword789');
  });

  it('revoking on password change is user-scoped — another user\'s session survives', async () => {
    const victimCookie = await signUpAndGetCookie('cp-victim@example.com', 'password123');
    const attackerCookie = await signUpAndGetCookie('cp-attacker@example.com', 'password123');
    const handler = createChangePasswordHandler({ db: testDb.db, pepper: TEST_PEPPER });
    const meHandler = createMeHandler({ db: testDb.db, pepper: TEST_PEPPER });

    await handler(
      req(
        '/api/auth/change-password',
        'POST',
        { cookie: attackerCookie },
        { currentPassword: 'password123', newPassword: 'newPassword999' },
      ),
    );

    expect((await meHandler(req('/api/auth/me', 'GET', { cookie: victimCookie }))).status).toBe(200);
  });
});
