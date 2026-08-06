// @vitest-environment node
import { freshTestDb, TEST_PEPPER, type TestDb } from '../_lib/db/testDb.js';
import { createHandler as createSignupHandler } from '../auth/signup.js';
import { createHandler as createPushHandler } from './push.js';
import { createHandler as createPullHandler } from './pull.js';

const ORIGIN = 'https://modus.test';

function postReq(path: string, body: unknown, cookie: string): Request {
  return new Request(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN, cookie },
    body: JSON.stringify(body),
  });
}

function pullReq(cursor: unknown, cookie: string | null): Request {
  const url = new URL(`${ORIGIN}/api/sync/pull`);
  if (cursor !== undefined) url.searchParams.set('cursor', JSON.stringify(cursor));
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;
  return new Request(url.toString(), { method: 'GET', headers });
}

let testDb: TestDb;

beforeEach(async () => {
  testDb = await freshTestDb();
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await testDb.close();
});

async function signUpAndGetCookie(email: string): Promise<{ cookie: string; userId: string }> {
  const handler = createSignupHandler({ db: testDb.db, pepper: TEST_PEPPER });
  const response = await handler(
    new Request(`${ORIGIN}/api/auth/signup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN },
      body: JSON.stringify({ email, password: 'correct-password-123' }),
    }),
  );
  expect(response.status).toBe(201);
  const setCookie = response.headers.get('Set-Cookie');
  if (!setCookie) throw new Error('signup did not set a cookie');
  const cookie = setCookie.split(';')[0]!;
  const body = (await response.json()) as { user: { id: string } };
  return { cookie, userId: body.user.id };
}

const entryOp = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: '018f1234-5678-7abc-8def-0123456789ab',
  deleted: false,
  day: '2026-03-12',
  name: 'Chicken breast',
  grams: 150,
  kcal: 248,
  protein: 46,
  carbs: 0,
  fat: 5,
  meal: 'lunch',
  source: 'manual',
  loggedAt: Date.parse('2026-03-12T12:00:00.000Z'),
  ...overrides,
});

describe('the 503 contract', () => {
  it('returns 503 when DATABASE_URL is unset', async () => {
    vi.stubEnv('DATABASE_URL', '');
    vi.stubEnv('SESSION_PEPPER', TEST_PEPPER);
    const response = await createPullHandler()(pullReq(undefined, null));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: 'sync_unconfigured' });
  });
});

describe('request handling', () => {
  it('rejects non-GET with 405', async () => {
    const handler = createPullHandler({ db: testDb.db, pepper: TEST_PEPPER });
    const response = await handler(new Request(`${ORIGIN}/api/sync/pull`, { method: 'POST' }));
    expect(response.status).toBe(405);
  });

  it('rejects a request with no session', async () => {
    const handler = createPullHandler({ db: testDb.db, pepper: TEST_PEPPER });
    const response = await handler(pullReq(undefined, null));
    expect(response.status).toBe(401);
  });

  it('rejects a malformed cursor as invalid_input', async () => {
    const { cookie } = await signUpAndGetCookie('badcursor@example.com');
    const handler = createPullHandler({ db: testDb.db, pepper: TEST_PEPPER });
    const url = new URL(`${ORIGIN}/api/sync/pull`);
    url.searchParams.set('cursor', '{not json');
    const response = await handler(new Request(url.toString(), { method: 'GET', headers: { cookie } }));
    expect(response.status).toBe(400);
  });

  it('rejects an oversized cursor query param with 413', async () => {
    const { cookie } = await signUpAndGetCookie('hugecursor@example.com');
    const handler = createPullHandler({ db: testDb.db, pepper: TEST_PEPPER });
    const url = new URL(`${ORIGIN}/api/sync/pull`);
    url.searchParams.set('cursor', 'x'.repeat(5000));
    const response = await handler(new Request(url.toString(), { method: 'GET', headers: { cookie } }));
    expect(response.status).toBe(413);
  });

  it('an absent cursor means a full pull, not an error', async () => {
    const { cookie } = await signUpAndGetCookie('nocursor@example.com');
    const handler = createPullHandler({ db: testDb.db, pepper: TEST_PEPPER });
    const response = await handler(pullReq(undefined, cookie));
    expect(response.status).toBe(200);
  });
});

describe('IDOR — one account never sees another account\'s data', () => {
  it('pull returns nothing for an account with no data of its own, even when another account has plenty', async () => {
    const owner = await signUpAndGetCookie('owner@example.com');
    const bystander = await signUpAndGetCookie('bystander@example.com');
    const pushHandler = createPushHandler({ db: testDb.db, pepper: TEST_PEPPER });
    const pullHandler = createPullHandler({ db: testDb.db, pepper: TEST_PEPPER });

    await pushHandler(postReq('/api/sync/push', { entries: [entryOp()] }, owner.cookie));

    const response = await pullHandler(pullReq(undefined, bystander.cookie));
    const body = (await response.json()) as any;
    expect(body.entries).toEqual([]);
    expect(body.counts.entries.total).toBe(0);
    expect(body.counts.lastChangeAt).toBeNull();
  });
});

describe('full pull — real counts for the merge screen (docs/DESIGN.md §7.11)', () => {
  it('reports exact live counts, day range and last-change time computed from the database', async () => {
    const { cookie } = await signUpAndGetCookie('counts@example.com');
    const pushHandler = createPushHandler({ db: testDb.db, pepper: TEST_PEPPER });
    const pullHandler = createPullHandler({ db: testDb.db, pepper: TEST_PEPPER });

    await pushHandler(
      postReq(
        '/api/sync/push',
        {
          entries: [
            entryOp({ id: '018f1234-0001-7000-8000-000000000001', day: '2026-03-10' }),
            entryOp({ id: '018f1234-0002-7000-8000-000000000002', day: '2026-03-12' }),
          ],
          weights: [{ id: '018f1234-0003-7000-8000-000000000003', deleted: false, day: '2026-03-12', weightKg: 80 }],
          favourites: [{ foodId: 'chicken-breast', deleted: false }],
        },
        cookie,
      ),
    );

    const response = await pullHandler(pullReq(undefined, cookie));
    const body = (await response.json()) as any;

    expect(body.counts.entries).toEqual({ total: 2, days: 2, firstDay: '2026-03-10', lastDay: '2026-03-12' });
    expect(body.counts.weights.total).toBe(1);
    expect(body.counts.favourites.total).toBe(1);
    expect(body.counts.customFoods.total).toBe(0);
    expect(body.counts.lastChangeAt).not.toBeNull();
    expect(body.entries).toHaveLength(2);
    expect(body.hasMore).toEqual({ entries: false, weights: false, customFoods: false, favourites: false });
  });

  it('a tombstoned row is excluded from the live count but still returned in the row list', async () => {
    const { cookie } = await signUpAndGetCookie('tombcount@example.com');
    const pushHandler = createPushHandler({ db: testDb.db, pepper: TEST_PEPPER });
    const pullHandler = createPullHandler({ db: testDb.db, pepper: TEST_PEPPER });

    await pushHandler(postReq('/api/sync/push', { entries: [entryOp()] }, cookie));
    await pushHandler(postReq('/api/sync/push', { entries: [{ id: entryOp().id, deleted: true }] }, cookie));

    const response = await pullHandler(pullReq(undefined, cookie));
    const body = (await response.json()) as any;
    expect(body.counts.entries.total).toBe(0);
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].deletedAt).not.toBeNull();
  });
});

describe('cursor semantics — pull with an old cursor returns exactly what changed since', () => {
  it('a second pull with the first cursor returns only the newly-pushed row', async () => {
    const { cookie } = await signUpAndGetCookie('delta@example.com');
    const pushHandler = createPushHandler({ db: testDb.db, pepper: TEST_PEPPER });
    const pullHandler = createPullHandler({ db: testDb.db, pepper: TEST_PEPPER });

    await pushHandler(
      postReq('/api/sync/push', { entries: [entryOp({ id: '018f1234-0010-7000-8000-000000000010' })] }, cookie),
    );
    const first = await pullHandler(pullReq(undefined, cookie));
    const firstBody = (await first.json()) as any;
    expect(firstBody.entries).toHaveLength(1);

    await pushHandler(
      postReq('/api/sync/push', { entries: [entryOp({ id: '018f1234-0011-7000-8000-000000000011' })] }, cookie),
    );
    const second = await pullHandler(pullReq(firstBody.cursor, cookie));
    const secondBody = (await second.json()) as any;

    expect(secondBody.entries).toHaveLength(1);
    expect(secondBody.entries[0].id).toBe('018f1234-0011-7000-8000-000000000011');
  });

  it('pulling again with the latest cursor and nothing new returns an empty delta', async () => {
    const { cookie } = await signUpAndGetCookie('nodelta@example.com');
    const pushHandler = createPushHandler({ db: testDb.db, pepper: TEST_PEPPER });
    const pullHandler = createPullHandler({ db: testDb.db, pepper: TEST_PEPPER });

    await pushHandler(postReq('/api/sync/push', { entries: [entryOp()] }, cookie));
    const first = await pullHandler(pullReq(undefined, cookie));
    const firstBody = (await first.json()) as any;

    const second = await pullHandler(pullReq(firstBody.cursor, cookie));
    const secondBody = (await second.json()) as any;
    expect(secondBody.entries).toEqual([]);
    expect(secondBody.weights).toEqual([]);
  });

  it('a tombstone propagates to a pull made with a cursor from before the delete', async () => {
    const { cookie } = await signUpAndGetCookie('tombdelta@example.com');
    const pushHandler = createPushHandler({ db: testDb.db, pepper: TEST_PEPPER });
    const pullHandler = createPullHandler({ db: testDb.db, pepper: TEST_PEPPER });

    await pushHandler(postReq('/api/sync/push', { entries: [entryOp()] }, cookie));
    const beforeDelete = await pullHandler(pullReq(undefined, cookie));
    const beforeBody = (await beforeDelete.json()) as any;

    await pushHandler(postReq('/api/sync/push', { entries: [{ id: entryOp().id, deleted: true }] }, cookie));

    const afterDelete = await pullHandler(pullReq(beforeBody.cursor, cookie));
    const afterBody = (await afterDelete.json()) as any;
    expect(afterBody.entries).toHaveLength(1);
    expect(afterBody.entries[0].id).toBe(entryOp().id);
    expect(afterBody.entries[0].deletedAt).not.toBeNull();

    // Pulling again with the fresh cursor: the tombstone does not resurrect or repeat.
    const again = await pullHandler(pullReq(afterBody.cursor, cookie));
    const againBody = (await again.json()) as any;
    expect(againBody.entries).toEqual([]);
  });
});
