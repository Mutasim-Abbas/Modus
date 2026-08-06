// @vitest-environment node
import { and, eq } from 'drizzle-orm';
import { entries, weights } from '../_lib/db/schema.js';
import { freshTestDb, TEST_PEPPER, type TestDb } from '../_lib/db/testDb.js';
import { createHandler as createSignupHandler } from '../auth/signup.js';
import { createHandler as createPushHandler } from './push.js';

const ORIGIN = 'https://modus.test';

function req(path: string, body: unknown, cookie: string | null, headers: Record<string, string> = {}): Request {
  const h: Record<string, string> = { 'content-type': 'application/json', origin: ORIGIN, ...headers };
  if (cookie) h.cookie = cookie;
  return new Request(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: h,
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

async function signUpAndGetCookie(email: string): Promise<{ cookie: string; userId: string }> {
  const handler = createSignupHandler({ db: testDb.db, pepper: TEST_PEPPER });
  const response = await handler(
    req('/api/auth/signup', { email, password: 'correct-password-123' }, null),
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
    const response = await createPushHandler()(req('/api/sync/push', { entries: [] }, null));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: 'sync_unconfigured' });
  });
});

describe('request handling', () => {
  it('rejects non-POST with 405', async () => {
    const handler = createPushHandler({ db: testDb.db, pepper: TEST_PEPPER });
    const response = await handler(new Request(`${ORIGIN}/api/sync/push`, { method: 'GET' }));
    expect(response.status).toBe(405);
  });

  it('rejects a cross-site Origin', async () => {
    const { cookie } = await signUpAndGetCookie('origin@example.com');
    const handler = createPushHandler({ db: testDb.db, pepper: TEST_PEPPER });
    const response = await handler(req('/api/sync/push', { entries: [] }, cookie, { origin: 'https://evil.example' }));
    expect(response.status).toBe(403);
  });

  it('rejects a request with no session', async () => {
    const handler = createPushHandler({ db: testDb.db, pepper: TEST_PEPPER });
    const response = await handler(req('/api/sync/push', { entries: [] }, null));
    expect(response.status).toBe(401);
  });

  it('rejects an unrecognised extra field (mass-assignment guard)', async () => {
    const { cookie } = await signUpAndGetCookie('mass@example.com');
    const handler = createPushHandler({ db: testDb.db, pepper: TEST_PEPPER });
    const response = await handler(req('/api/sync/push', { entries: [], userId: 'forged' }, cookie));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'invalid_input' });
  });

  it('rejects a malformed entry row as invalid_input', async () => {
    const { cookie } = await signUpAndGetCookie('malformed@example.com');
    const handler = createPushHandler({ db: testDb.db, pepper: TEST_PEPPER });
    const response = await handler(
      req('/api/sync/push', { entries: [{ id: 'not-a-uuid', deleted: false }] }, cookie),
    );
    expect(response.status).toBe(400);
  });

  it('rejects an oversized body with 413, without buffering or parsing it', async () => {
    const { cookie } = await signUpAndGetCookie('oversized@example.com');
    const handler = createPushHandler({ db: testDb.db, pepper: TEST_PEPPER });
    const huge = 'x'.repeat(3 * 1024 * 1024);
    const response = await handler(req('/api/sync/push', huge, cookie));
    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({ error: 'too_large' });
  });

  it('rejects a batch over the per-table row cap as invalid_input, not an OOM', async () => {
    const { cookie } = await signUpAndGetCookie('toomany@example.com');
    const handler = createPushHandler({ db: testDb.db, pepper: TEST_PEPPER });
    const tooMany = Array.from({ length: 501 }, (_, i) =>
      entryOp({ id: `018f1234-0000-7000-8000-${String(i).padStart(12, '0')}` }),
    );
    const response = await handler(req('/api/sync/push', { entries: tooMany }, cookie));
    expect(response.status).toBe(400);
  });
});

describe('happy path', () => {
  it('applies profile, settings, an entry, a weight, a custom food and a favourite in one push', async () => {
    const { cookie, userId } = await signUpAndGetCookie('happy@example.com');
    const handler = createPushHandler({ db: testDb.db, pepper: TEST_PEPPER });

    const response = await handler(
      req(
        '/api/sync/push',
        {
          profile: { deleted: false, sex: 'male', age: 30, heightCm: 180, weightKg: 82, activity: 'moderate', goal: 'cut' },
          settings: { deleted: false, locale: 'en', reducedMotion: false },
          entries: [entryOp()],
          weights: [{ id: '018f1234-1111-7000-8000-000000000001', deleted: false, day: '2026-03-12', weightKg: 81.5 }],
          customFoods: [
            {
              id: '018f1234-2222-7000-8000-000000000002',
              deleted: false,
              name: 'Homemade granola',
              category: 'grains',
              kcal: 450,
              protein: 10,
              carbs: 60,
              fat: 15,
              commonPortions: [{ label: 'cup', grams: 40 }],
            },
          ],
          favourites: [{ foodId: 'chicken-breast', deleted: false }],
        },
        cookie,
      ),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect(body.applied.profile).toBeTruthy();
    expect(body.applied.settings).toBeTruthy();
    expect(body.applied.entries).toHaveLength(1);
    expect(body.applied.weights).toHaveLength(1);
    expect(body.applied.customFoods).toHaveLength(1);
    expect(body.applied.favourites).toHaveLength(1);
    expect(body.rejected.entries).toHaveLength(0);
    // Renamed from `cursor` by the P2.4 security audit (the internal security audit F-03): this
    // watermark must never be adopted as a pull cursor, and the old name invited exactly
    // that. Same assertion, corrected field name.
    expect(body.serverState.entries).toBeTruthy();

    const rows = await testDb.db.select().from(entries).where(eq(entries.userId, userId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe('Chicken breast');
    expect(rows[0]?.deletedAt).toBeNull();
  });

  it('never trusts a client-supplied updatedAt/deletedAt timestamp — the server assigns its own', async () => {
    const { cookie, userId } = await signUpAndGetCookie('serverclock@example.com');
    const handler = createPushHandler({ db: testDb.db, pepper: TEST_PEPPER });
    const before = Date.now();

    await handler(req('/api/sync/push', { entries: [entryOp()] }, cookie));

    const [row] = await testDb.db.select().from(entries).where(eq(entries.userId, userId));
    expect(row).toBeTruthy();
    // The push schema has no updatedAt/deletedAt input field at all for a live op (only
    // `deleted: boolean`) — this asserts the row's real updated_at is a server timestamp
    // taken during this request, not something that could have been forged.
    expect(row!.updatedAt.getTime()).toBeGreaterThanOrEqual(before);
  });
});

describe('idempotency — re-pushing an identical batch is a no-op, not a duplicate', () => {
  it('pushing the same entry id twice leaves exactly one row', async () => {
    const { cookie, userId } = await signUpAndGetCookie('idempotent@example.com');
    const handler = createPushHandler({ db: testDb.db, pepper: TEST_PEPPER });

    await handler(req('/api/sync/push', { entries: [entryOp()] }, cookie));
    const second = await handler(req('/api/sync/push', { entries: [entryOp()] }, cookie));

    expect(second.status).toBe(200);
    const body = (await second.json()) as any;
    expect(body.applied.entries).toHaveLength(1);
    expect(body.rejected.entries).toHaveLength(0);

    const rows = await testDb.db.select().from(entries).where(eq(entries.userId, userId));
    expect(rows).toHaveLength(1);
  });

  it('pushing an identical favourite twice upserts on the natural key, not a duplicate', async () => {
    const { cookie } = await signUpAndGetCookie('favidempotent@example.com');
    const handler = createPushHandler({ db: testDb.db, pepper: TEST_PEPPER });

    await handler(req('/api/sync/push', { favourites: [{ foodId: 'chicken-breast', deleted: false }] }, cookie));
    const second = await handler(
      req('/api/sync/push', { favourites: [{ foodId: 'chicken-breast', deleted: false }] }, cookie),
    );
    const body = (await second.json()) as any;
    expect(body.applied.favourites).toHaveLength(1);
  });
});

describe('tombstones — delete propagates and does not resurrect', () => {
  it('a tombstone push marks the row deleted', async () => {
    const { cookie, userId } = await signUpAndGetCookie('tombstone@example.com');
    const handler = createPushHandler({ db: testDb.db, pepper: TEST_PEPPER });

    await handler(req('/api/sync/push', { entries: [entryOp()] }, cookie));
    const del = await handler(
      req('/api/sync/push', { entries: [{ id: entryOp().id, deleted: true }] }, cookie),
    );
    expect(del.status).toBe(200);
    const body = (await del.json()) as any;
    expect(body.applied.entries).toHaveLength(1);
    expect(body.applied.entries[0].deletedAt).not.toBeNull();

    const [row] = await testDb.db.select().from(entries).where(eq(entries.userId, userId));
    expect(row?.deletedAt).not.toBeNull();
  });

  it('re-pushing the same tombstone is idempotent — it stays deleted, does not resurrect', async () => {
    const { cookie, userId } = await signUpAndGetCookie('retombstone@example.com');
    const handler = createPushHandler({ db: testDb.db, pepper: TEST_PEPPER });

    await handler(req('/api/sync/push', { entries: [entryOp()] }, cookie));
    await handler(req('/api/sync/push', { entries: [{ id: entryOp().id, deleted: true }] }, cookie));
    const secondDelete = await handler(
      req('/api/sync/push', { entries: [{ id: entryOp().id, deleted: true }] }, cookie),
    );
    expect(secondDelete.status).toBe(200);

    const [row] = await testDb.db.select().from(entries).where(eq(entries.userId, userId));
    expect(row?.deletedAt).not.toBeNull();
  });

  it('a tombstone for an id the server has never seen is a harmless no-op, not an error', async () => {
    const { cookie } = await signUpAndGetCookie('nevercreated@example.com');
    const handler = createPushHandler({ db: testDb.db, pepper: TEST_PEPPER });

    const response = await handler(
      req('/api/sync/push', { entries: [{ id: '018f1234-9999-7000-8000-000000000009', deleted: true }] }, cookie),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect(body.applied.entries).toHaveLength(0);
    expect(body.rejected.entries).toHaveLength(0);
  });

  it('pushing a fresh live row for a previously-tombstoned id un-deletes it (a later real write legitimately wins)', async () => {
    const { cookie, userId } = await signUpAndGetCookie('undelete@example.com');
    const handler = createPushHandler({ db: testDb.db, pepper: TEST_PEPPER });

    await handler(req('/api/sync/push', { entries: [entryOp()] }, cookie));
    await handler(req('/api/sync/push', { entries: [{ id: entryOp().id, deleted: true }] }, cookie));
    await handler(req('/api/sync/push', { entries: [entryOp({ name: 'Chicken breast (again)' })] }, cookie));

    const [row] = await testDb.db.select().from(entries).where(eq(entries.userId, userId));
    expect(row?.deletedAt).toBeNull();
    expect(row?.name).toBe('Chicken breast (again)');
  });
});

describe('IDOR — a forged/foreign id in the body changes nothing', () => {
  it('another account cannot overwrite an entry it does not own by reusing its id', async () => {
    const victim = await signUpAndGetCookie('victim@example.com');
    const attacker = await signUpAndGetCookie('attacker@example.com');
    const handler = createPushHandler({ db: testDb.db, pepper: TEST_PEPPER });

    await handler(req('/api/sync/push', { entries: [entryOp({ name: 'Victim original' })] }, victim.cookie));

    const attack = await handler(
      req('/api/sync/push', { entries: [entryOp({ name: 'Overwritten by attacker' })] }, attacker.cookie),
    );
    expect(attack.status).toBe(200);
    const attackBody = (await attack.json()) as any;
    expect(attackBody.applied.entries).toHaveLength(0);
    expect(attackBody.rejected.entries).toEqual([{ id: entryOp().id, reason: 'owner_conflict' }]);

    // The victim's row is byte-for-byte untouched.
    const victimRows = await testDb.db.select().from(entries).where(eq(entries.userId, victim.userId));
    expect(victimRows).toHaveLength(1);
    expect(victimRows[0]?.name).toBe('Victim original');

    // The attacker does not own it either — nothing was created under their account.
    const attackerRows = await testDb.db.select().from(entries).where(eq(entries.userId, attacker.userId));
    expect(attackerRows).toHaveLength(0);
  });

  it('another account cannot tombstone an entry it does not own', async () => {
    const victim = await signUpAndGetCookie('victim2@example.com');
    const attacker = await signUpAndGetCookie('attacker2@example.com');
    const handler = createPushHandler({ db: testDb.db, pepper: TEST_PEPPER });

    await handler(req('/api/sync/push', { entries: [entryOp()] }, victim.cookie));
    await handler(req('/api/sync/push', { entries: [{ id: entryOp().id, deleted: true }] }, attacker.cookie));

    const [row] = await testDb.db.select().from(entries).where(eq(entries.userId, victim.userId));
    expect(row?.deletedAt).toBeNull();
  });

  it('a client cannot smuggle a userId field into any op — it is rejected as invalid_input', async () => {
    const { cookie } = await signUpAndGetCookie('smuggle@example.com');
    const handler = createPushHandler({ db: testDb.db, pepper: TEST_PEPPER });
    const response = await handler(
      req('/api/sync/push', { entries: [{ ...entryOp(), userId: 'forged-user-id' }] }, cookie),
    );
    expect(response.status).toBe(400);
  });
});

describe('weights — the (user_id, day) live-uniqueness conflict', () => {
  it('two different ids for the same live day in one batch: the first applies, the second is rejected as duplicate_day', async () => {
    const { cookie, userId } = await signUpAndGetCookie('dupday@example.com');
    const handler = createPushHandler({ db: testDb.db, pepper: TEST_PEPPER });

    const response = await handler(
      req(
        '/api/sync/push',
        {
          weights: [
            { id: '018f1234-3333-7000-8000-000000000003', deleted: false, day: '2026-03-12', weightKg: 80 },
            { id: '018f1234-4444-7000-8000-000000000004', deleted: false, day: '2026-03-12', weightKg: 81 },
          ],
        },
        cookie,
      ),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect(body.applied.weights).toHaveLength(1);
    expect(body.rejected.weights).toHaveLength(1);
    expect(body.rejected.weights[0].reason).toBe('duplicate_day');

    const rows = await testDb.db.select().from(weights).where(and(eq(weights.userId, userId), eq(weights.day, '2026-03-12')));
    // Only the one that "won" is live; nothing is left in a half-applied state.
    expect(rows.filter((r) => r.deletedAt === null)).toHaveLength(1);
  });

  it('a same-day conflict on a legitimate re-push does not reject the row that already won', async () => {
    const { cookie } = await signUpAndGetCookie('dupday2@example.com');
    const handler = createPushHandler({ db: testDb.db, pepper: TEST_PEPPER });
    const id = '018f1234-5555-7000-8000-000000000005';

    await handler(req('/api/sync/push', { weights: [{ id, deleted: false, day: '2026-03-12', weightKg: 80 }] }, cookie));
    const again = await handler(
      req('/api/sync/push', { weights: [{ id, deleted: false, day: '2026-03-12', weightKg: 80.5 }] }, cookie),
    );
    const body = (await again.json()) as any;
    expect(body.applied.weights).toHaveLength(1);
    expect(body.rejected.weights).toHaveLength(0);
  });
});
