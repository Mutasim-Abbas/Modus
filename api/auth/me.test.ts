// @vitest-environment node
import { freshTestDb, TEST_PEPPER, type TestDb } from '../_lib/db/testDb.js';
import { createHandler as createSignupHandler } from './signup.js';
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

describe('the 503 contract', () => {
  it('returns 503 when DATABASE_URL is unset', async () => {
    vi.stubEnv('DATABASE_URL', '');
    vi.stubEnv('SESSION_PEPPER', TEST_PEPPER);
    const response = await createMeHandler()(req('/api/auth/me', 'GET'));
    expect(response.status).toBe(503);
  });
});

describe('GET /api/auth/me', () => {
  it('rejects non-GET with 405', async () => {
    const handler = createMeHandler({ db: testDb.db, pepper: TEST_PEPPER });
    const response = await handler(req('/api/auth/me', 'POST'));
    expect(response.status).toBe(405);
  });

  it('returns 401 with no cookie', async () => {
    const handler = createMeHandler({ db: testDb.db, pepper: TEST_PEPPER });
    const response = await handler(req('/api/auth/me', 'GET'));
    expect(response.status).toBe(401);
  });

  it('returns 401 for a garbage/forged cookie value', async () => {
    const handler = createMeHandler({ db: testDb.db, pepper: TEST_PEPPER });
    const response = await handler(req('/api/auth/me', 'GET', { cookie: '__Host-fm_session=not-a-real-token' }));
    expect(response.status).toBe(401);
  });

  it('returns the user, never the password/recovery hashes, for a valid session', async () => {
    const signupHandler = createSignupHandler({ db: testDb.db, pepper: TEST_PEPPER });
    const signupResponse = await signupHandler(
      req('/api/auth/signup', 'POST', {}, { email: 'me@example.com', password: 'password123' }),
    );
    const cookie = cookieFromSetCookie(signupResponse.headers.get('Set-Cookie'));

    const meHandler = createMeHandler({ db: testDb.db, pepper: TEST_PEPPER });
    const response = await meHandler(req('/api/auth/me', 'GET', { cookie }));
    expect(response.status).toBe(200);

    const body = (await response.json()) as { user: Record<string, unknown> };
    expect(body.user.email).toBe('me@example.com');
    expect(body.user).not.toHaveProperty('passwordHash');
    expect(body.user).not.toHaveProperty('recoveryCodeHash');
    expect(JSON.stringify(body)).not.toMatch(/\$argon2/);
  });

  it('slides the session forward and returns a refreshed Set-Cookie', async () => {
    const signupHandler = createSignupHandler({ db: testDb.db, pepper: TEST_PEPPER });
    const signupResponse = await signupHandler(
      req('/api/auth/signup', 'POST', {}, { email: 'slide@example.com', password: 'password123' }),
    );
    const cookie = cookieFromSetCookie(signupResponse.headers.get('Set-Cookie'));

    const meHandler = createMeHandler({ db: testDb.db, pepper: TEST_PEPPER });
    const response = await meHandler(req('/api/auth/me', 'GET', { cookie }));
    expect(response.headers.get('Set-Cookie')).toContain('__Host-fm_session=');
    expect(response.headers.get('Set-Cookie')).toContain('Max-Age=');
  });
});
