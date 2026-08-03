// @vitest-environment node
import { sessions } from '../_lib/db/schema.js';
import { freshTestDb, TEST_PEPPER, type TestDb } from '../_lib/db/testDb.js';
import { createHandler as createSignupHandler } from './signup.js';
import { createHandler as createLogoutHandler } from './logout.js';
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
    const response = await createLogoutHandler()(req('/api/auth/logout', 'POST'));
    expect(response.status).toBe(503);
  });
});

describe('logout — revokes the session, replay fails', () => {
  it('a replayed cookie stops authenticating after logout', async () => {
    const cookie = await signUpAndGetCookie('logout1@example.com', 'password123');
    const logoutHandler = createLogoutHandler({ db: testDb.db, pepper: TEST_PEPPER });
    const meHandler = createMeHandler({ db: testDb.db, pepper: TEST_PEPPER });

    const before = await meHandler(req('/api/auth/me', 'GET', { cookie }));
    expect(before.status).toBe(200);

    const logoutResponse = await logoutHandler(req('/api/auth/logout', 'POST', { cookie }));
    expect(logoutResponse.status).toBe(200);
    expect(logoutResponse.headers.get('Set-Cookie')).toContain('Max-Age=0');

    // The exact same cookie, replayed, must now fail — this is what "logout invalidates
    // the row" means (the project plan P2.2 acceptance criterion).
    const after = await meHandler(req('/api/auth/me', 'GET', { cookie }));
    expect(after.status).toBe(401);
  });

  it('marks the session row revoked in the database, not merely "not returned"', async () => {
    const cookie = await signUpAndGetCookie('logout2@example.com', 'password123');
    const logoutHandler = createLogoutHandler({ db: testDb.db, pepper: TEST_PEPPER });
    await logoutHandler(req('/api/auth/logout', 'POST', { cookie }));

    const rows = await testDb.db.select().from(sessions);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.revokedAt).not.toBeNull();
  });

  it('is idempotent and always 200, even with no cookie at all', async () => {
    const logoutHandler = createLogoutHandler({ db: testDb.db, pepper: TEST_PEPPER });
    const response = await logoutHandler(req('/api/auth/logout', 'POST'));
    expect(response.status).toBe(200);
  });

  it('is idempotent when called twice with the same cookie', async () => {
    const cookie = await signUpAndGetCookie('logout3@example.com', 'password123');
    const logoutHandler = createLogoutHandler({ db: testDb.db, pepper: TEST_PEPPER });
    expect((await logoutHandler(req('/api/auth/logout', 'POST', { cookie }))).status).toBe(200);
    expect((await logoutHandler(req('/api/auth/logout', 'POST', { cookie }))).status).toBe(200);
  });

  it('rejects a cross-site Origin', async () => {
    const cookie = await signUpAndGetCookie('logout4@example.com', 'password123');
    const logoutHandler = createLogoutHandler({ db: testDb.db, pepper: TEST_PEPPER });
    const response = await logoutHandler(
      req('/api/auth/logout', 'POST', { cookie, origin: 'https://evil.example' }),
    );
    expect(response.status).toBe(403);
  });
});
