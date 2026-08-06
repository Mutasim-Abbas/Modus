// @vitest-environment node
//
// REGRESSION TEST for the internal security audit F-02 (HIGH).
//
// Every apply* in api/sync/push.ts builds ONE multi-row
// `INSERT ... VALUES (a),(b) ON CONFLICT (id) DO UPDATE`. Postgres refuses a statement
// whose VALUES list carries the same conflict key twice — "ON CONFLICT DO UPDATE command
// cannot affect row a second time", SQLSTATE 21000. That is NOT 23505, so the weights
// unique-violation fallback rethrew it, and the handler's catch-all answered 500.
//
// Measured before the fix, on all four id-addressable tables:
//   PROBE1 entries     status 500 {"error":"server_error"}
//   PROBE1 favourites  status 500 {"error":"server_error"}
//   PROBE1 weights     status 500 {"error":"server_error"}
//   PROBE1 customFoods status 500 {"error":"server_error"}
//
// The failure was DETERMINISTIC, so retrying the identical batch failed identically: the
// client's offline queue could never drain and that account's data never reached the
// server again. A duplicate id is the ordinary output of an offline queue that recorded a
// create and then an edit of the same row before the first push went out.
import { eq } from 'drizzle-orm';
import { customFoods, entries, favourites, weights } from '../_lib/db/schema.js';
import { freshTestDb, TEST_PEPPER, type TestDb } from '../_lib/db/testDb.js';
import { createHandler as createSignupHandler } from '../auth/signup.js';
import { createHandler as createPushHandler } from './push.js';

const ORIGIN = 'https://modus.test';

function post(path: string, body: unknown, cookie: string | null): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json', origin: ORIGIN };
  if (cookie) headers.cookie = cookie;
  return new Request(ORIGIN + path, { method: 'POST', headers, body: JSON.stringify(body) });
}

let testDb: TestDb;
beforeEach(async () => { testDb = await freshTestDb(); });
afterEach(async () => { await testDb.close(); });

async function signUp(email: string): Promise<string> {
  const response = await createSignupHandler({ db: testDb.db, pepper: TEST_PEPPER })(
    post('/api/auth/signup', { email, password: 'correct-password-123' }, null),
  );
  expect(response.status).toBe(201);
  return response.headers.get('Set-Cookie')!.split(';')[0]!;
}

const ENTRY_ID = '018f1234-5678-7abc-8def-0123456789ab';
const entryOp = (o: Record<string, unknown> = {}) => ({
  id: ENTRY_ID, deleted: false, day: '2026-03-12', name: 'Chicken', grams: 150,
  kcal: 248, protein: 46, carbs: 0, fat: 5, meal: 'lunch', source: 'manual',
  loggedAt: Date.parse('2026-03-12T12:00:00.000Z'), ...o,
});

describe('a duplicate row id inside one batch — F-02', () => {
  it('entries: the batch applies, the later op wins, and exactly one row exists', async () => {
    const cookie = await signUp('dup-entries@example.com');
    const push = createPushHandler({ db: testDb.db, pepper: TEST_PEPPER });

    const response = await push(
      post('/api/sync/push', { entries: [entryOp({ name: 'Chicken' }), entryOp({ name: 'Rice' })] }, cookie),
    );
    expect(response.status).toBe(200);

    const rows = await testDb.db.select().from(entries).where(eq(entries.id, ENTRY_ID));
    expect(rows).toHaveLength(1);
    // Last op wins — the client's later intent, the same rule LWW already applies across
    // pushes.
    expect(rows[0]?.name).toBe('Rice');
  }, 300_000);

  it('weights: a duplicate id does not trip the (user_id, day) fallback into a 500', async () => {
    const cookie = await signUp('dup-weights@example.com');
    const push = createPushHandler({ db: testDb.db, pepper: TEST_PEPPER });
    const id = '018f1234-5678-7abc-8def-0123456789ac';

    const response = await push(
      post('/api/sync/push', {
        weights: [
          { id, deleted: false, day: '2026-03-12', weightKg: 80 },
          { id, deleted: false, day: '2026-03-12', weightKg: 81 },
        ],
      }, cookie),
    );
    expect(response.status).toBe(200);

    const rows = await testDb.db.select().from(weights).where(eq(weights.id, id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.weightKg).toBe('81.0');
  }, 300_000);

  it('customFoods: a duplicate id applies once', async () => {
    const cookie = await signUp('dup-cf@example.com');
    const push = createPushHandler({ db: testDb.db, pepper: TEST_PEPPER });
    const id = '018f1234-5678-7abc-8def-0123456789ad';
    const food = {
      id, deleted: false, category: 'protein', kcal: 100, protein: 1, carbs: 2, fat: 3,
      commonPortions: [],
    };

    const response = await push(
      post('/api/sync/push', { customFoods: [{ ...food, name: 'First' }, { ...food, name: 'Second' }] }, cookie),
    );
    expect(response.status).toBe(200);

    const rows = await testDb.db.select().from(customFoods).where(eq(customFoods.id, id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe('Second');
  }, 300_000);

  it('favourites: a duplicate (user, food) pair applies once', async () => {
    const cookie = await signUp('dup-fav@example.com');
    const push = createPushHandler({ db: testDb.db, pepper: TEST_PEPPER });

    const response = await push(
      post('/api/sync/push', {
        favourites: [{ foodId: 'f1', deleted: false }, { foodId: 'f1', deleted: false }],
      }, cookie),
    );
    expect(response.status).toBe(200);

    const rows = await testDb.db.select().from(favourites).where(eq(favourites.foodId, 'f1'));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.deletedAt).toBeNull();
  }, 300_000);

  it('a live op and a tombstone for one id in one batch resolve to the LAST op, deterministically', async () => {
    const cookie = await signUp('dup-mixed@example.com');
    const push = createPushHandler({ db: testDb.db, pepper: TEST_PEPPER });

    // Delete first, then re-create: the row must end up LIVE.
    const response = await push(
      post('/api/sync/push', { entries: [{ id: ENTRY_ID, deleted: true }, entryOp()] }, cookie),
    );
    expect(response.status).toBe(200);

    const rows = await testDb.db.select().from(entries).where(eq(entries.id, ENTRY_ID));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.deletedAt).toBeNull();
  }, 300_000);

  it('the whole batch still succeeds when a duplicate sits alongside other tables', async () => {
    const cookie = await signUp('dup-mixedtables@example.com');
    const push = createPushHandler({ db: testDb.db, pepper: TEST_PEPPER });

    const response = await push(
      post('/api/sync/push', {
        entries: [entryOp(), entryOp({ name: 'Rice' })],
        favourites: [{ foodId: 'f9', deleted: false }],
        profile: { deleted: false, sex: 'male', age: 30, heightCm: 180, weightKg: 82, activity: 'moderate', goal: 'cut' },
      }, cookie),
    );
    expect(response.status).toBe(200);
    const favRows = await testDb.db.select().from(favourites).where(eq(favourites.foodId, 'f9'));
    expect(favRows).toHaveLength(1);
  }, 300_000);
});
