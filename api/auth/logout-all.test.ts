// @vitest-environment node
import { sessions } from '../_lib/db/schema.js';
import { freshTestDb, TEST_PEPPER, type TestDb } from '../_lib/db/testDb.js';
import { createHandler as createSignupHandler } from './signup.js';
import { createHandler as createLoginHandler } from './login.js';
import { createHandler as createLogoutAllHandler } from './logout-all.js';
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

describe('logout-all — log out everywhere', () => {
  it('revokes every session for the user, including the calling device', async () => {
    const signupHandler = createSignupHandler({ db: testDb.db, pepper: TEST_PEPPER });
    const loginHandler = createLoginHandler({ db: testDb.db, pepper: TEST_PEPPER });
    const logoutAllHandler = createLogoutAllHandler({ db: testDb.db, pepper: TEST_PEPPER });
    const meHandler = createMeHandler({ db: testDb.db, pepper: TEST_PEPPER });

    const signupResponse = await signupHandler(
      req('/api/auth/signup', 'POST', {}, { email: 'everywhere@example.com', password: 'password123' }),
    );
    const deviceACookie = cookieFromSetCookie(signupResponse.headers.get('Set-Cookie'));

    const loginResponse = await loginHandler(
      req('/api/auth/login', 'POST', {}, { email: 'everywhere@example.com', password: 'password123' }),
    );
    const deviceBCookie = cookieFromSetCookie(loginResponse.headers.get('Set-Cookie'));

    // Both devices work before logout-all.
    expect((await meHandler(req('/api/auth/me', 'GET', { cookie: deviceACookie }))).status).toBe(200);
    expect((await meHandler(req('/api/auth/me', 'GET', { cookie: deviceBCookie }))).status).toBe(200);

    const logoutAllResponse = await logoutAllHandler(
      req('/api/auth/logout-all', 'POST', { cookie: deviceBCookie }),
    );
    expect(logoutAllResponse.status).toBe(200);

    // Every session is now dead — the one that called logout-all AND the other device.
    expect((await meHandler(req('/api/auth/me', 'GET', { cookie: deviceACookie }))).status).toBe(401);
    expect((await meHandler(req('/api/auth/me', 'GET', { cookie: deviceBCookie }))).status).toBe(401);

    const rows = await testDb.db.select().from(sessions);
    expect(rows.every((row) => row.revokedAt !== null)).toBe(true);
  });

  it('returns 401 without a valid session', async () => {
    const handler = createLogoutAllHandler({ db: testDb.db, pepper: TEST_PEPPER });
    const response = await handler(req('/api/auth/logout-all', 'POST'));
    expect(response.status).toBe(401);
  });

  it('never touches another user\'s sessions (IDOR check)', async () => {
    const signupHandler = createSignupHandler({ db: testDb.db, pepper: TEST_PEPPER });
    const logoutAllHandler = createLogoutAllHandler({ db: testDb.db, pepper: TEST_PEPPER });
    const meHandler = createMeHandler({ db: testDb.db, pepper: TEST_PEPPER });

    const victim = await signupHandler(
      req('/api/auth/signup', 'POST', {}, { email: 'victim@example.com', password: 'password123' }),
    );
    const victimCookie = cookieFromSetCookie(victim.headers.get('Set-Cookie'));

    const attacker = await signupHandler(
      req('/api/auth/signup', 'POST', {}, { email: 'attacker@example.com', password: 'password123' }),
    );
    const attackerCookie = cookieFromSetCookie(attacker.headers.get('Set-Cookie'));

    // The attacker can only ever act as themselves — there is no user-id field in the
    // request body for this endpoint to spoof; identity comes entirely from the
    // session cookie, which is exactly the IDOR defence.
    await logoutAllHandler(req('/api/auth/logout-all', 'POST', { cookie: attackerCookie }));

    expect((await meHandler(req('/api/auth/me', 'GET', { cookie: victimCookie }))).status).toBe(200);
  });
});
