// @vitest-environment node
import { eq } from 'drizzle-orm';
import { customFoods, entries, favourites, profiles, sessions, userSettings, users, weights } from '../_lib/db/schema.js';
import { freshTestDb, TEST_PEPPER, type TestDb } from '../_lib/db/testDb.js';
import { createHandler as createSignupHandler } from './signup.js';
import { createHandler as createDeleteHandler } from './delete-account.js';
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

async function signUpAndGetCookie(email: string, password: string) {
  const handler = createSignupHandler({ db: testDb.db, pepper: TEST_PEPPER });
  const response = await handler(req('/api/auth/signup', 'POST', {}, { email, password }));
  const body = (await response.json()) as { user: { id: string } };
  return { cookie: cookieFromSetCookie(response.headers.get('Set-Cookie')), userId: body.user.id };
}

describe('the 503 contract', () => {
  it('returns 503 when DATABASE_URL is unset', async () => {
    vi.stubEnv('DATABASE_URL', '');
    vi.stubEnv('SESSION_PEPPER', TEST_PEPPER);
    const response = await createDeleteHandler()(req('/api/auth/delete-account', 'POST'));
    expect(response.status).toBe(503);
  });
});

describe('request handling', () => {
  it('requires authentication', async () => {
    const handler = createDeleteHandler({ db: testDb.db, pepper: TEST_PEPPER });
    const response = await handler(req('/api/auth/delete-account', 'POST', {}, { password: 'password123' }));
    expect(response.status).toBe(401);
  });

  it('requires the correct password even with a valid session', async () => {
    const { cookie } = await signUpAndGetCookie('del-wrong@example.com', 'password123');
    const handler = createDeleteHandler({ db: testDb.db, pepper: TEST_PEPPER });
    const response = await handler(
      req('/api/auth/delete-account', 'POST', { cookie }, { password: 'wrong-password-entirely' }),
    );
    expect(response.status).toBe(401);

    const rows = await testDb.db.select().from(users).where(eq(users.email, 'del-wrong@example.com'));
    expect(rows).toHaveLength(1);
  });
});

describe('happy path — real deletion, cascades everywhere', () => {
  it('deletes the user row and every row they own in one statement', async () => {
    const { cookie, userId } = await signUpAndGetCookie('del-ok@example.com', 'password123');
    const handler = createDeleteHandler({ db: testDb.db, pepper: TEST_PEPPER });
    const meHandler = createMeHandler({ db: testDb.db, pepper: TEST_PEPPER });

    // Give the account owned rows across the sync tables, same shape as
    // api/_lib/db/schema.test.ts's cascade proof, so this endpoint proves the same
    // thing end-to-end through the HTTP layer, not just at the schema layer.
    await testDb.db.insert(profiles).values({
      userId,
      sex: 'male',
      age: 30,
      heightCm: '180.0',
      weightKg: '80.0',
      activity: 'moderate',
      goal: 'maintain',
    });
    await testDb.db.insert(entries).values({
      id: '11111111-1111-1111-1111-111111111111',
      userId,
      day: '2026-07-31',
      name: 'Test food',
      grams: '100',
      kcal: '100',
      protein: '10',
      carbs: '10',
      fat: '1',
      meal: 'lunch',
      source: 'manual',
      loggedAt: new Date(),
    });
    await testDb.db.insert(weights).values({
      id: '22222222-2222-2222-2222-222222222222',
      userId,
      day: '2026-07-31',
      weightKg: '80.0',
    });
    await testDb.db.insert(customFoods).values({
      id: '33333333-3333-3333-3333-333333333333',
      userId,
      name: 'Custom snack',
      category: 'snacks',
      kcal: '200',
      protein: '5',
      carbs: '20',
      fat: '5',
    });
    await testDb.db.insert(favourites).values({ userId, foodId: 'chicken-breast' });
    await testDb.db.insert(userSettings).values({ userId });

    const response = await handler(
      req('/api/auth/delete-account', 'POST', { cookie }, { password: 'password123' }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('Set-Cookie')).toContain('Max-Age=0');

    expect(await testDb.db.select().from(users).where(eq(users.id, userId))).toHaveLength(0);
    expect(await testDb.db.select().from(sessions).where(eq(sessions.userId, userId))).toHaveLength(0);
    expect(await testDb.db.select().from(profiles).where(eq(profiles.userId, userId))).toHaveLength(0);
    expect(await testDb.db.select().from(entries).where(eq(entries.userId, userId))).toHaveLength(0);
    expect(await testDb.db.select().from(weights).where(eq(weights.userId, userId))).toHaveLength(0);
    expect(await testDb.db.select().from(customFoods).where(eq(customFoods.userId, userId))).toHaveLength(0);
    expect(await testDb.db.select().from(favourites).where(eq(favourites.userId, userId))).toHaveLength(0);
    expect(await testDb.db.select().from(userSettings).where(eq(userSettings.userId, userId))).toHaveLength(0);

    // The now-deleted session can no longer authenticate.
    expect((await meHandler(req('/api/auth/me', 'GET', { cookie }))).status).toBe(401);
  });

  it('only ever deletes the caller\'s own account, never another user\'s (IDOR check)', async () => {
    const victim = await signUpAndGetCookie('del-victim@example.com', 'password123');
    const attacker = await signUpAndGetCookie('del-attacker@example.com', 'password123');
    const handler = createDeleteHandler({ db: testDb.db, pepper: TEST_PEPPER });

    // The request body has no user-id field to spoof at all — delete-account always
    // targets the session's own user, which is the IDOR defence by construction.
    await handler(req('/api/auth/delete-account', 'POST', { cookie: attacker.cookie }, { password: 'password123' }));

    expect(await testDb.db.select().from(users).where(eq(users.id, victim.userId))).toHaveLength(1);
    expect(await testDb.db.select().from(users).where(eq(users.id, attacker.userId))).toHaveLength(0);
  });
});
