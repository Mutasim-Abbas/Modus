// @vitest-environment node
//
// This suite spins up a real (embedded WASM) Postgres via PGlite. jsdom's fetch/Response
// shim — the project-wide default environment in vite.config.ts — is not source-compatible
// with how PGlite loads its WASM binary (`r.arrayBuffer is not a function`); Node's own
// fetch does not have that problem. Every other test file keeps the jsdom default.
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { and, eq, isNull } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import {
  authAttempts,
  customFoods,
  entries,
  favourites,
  profiles,
  sessions,
  userSettings,
  users,
  weights,
} from './schema.js';

/**
 * Executes the committed migrations in `./drizzle` against a real (embedded WASM)
 * Postgres engine — the same SQL files `npm run db:migrate` applies to Neon. This is
 * the honest verification available without a live Neon project (P5.1): PGlite is a
 * real Postgres, not a mock or a hand-rolled SQL parser, so constraints, triggers,
 * partial/unique indexes and cascades all run for real.
 *
 * What this does NOT prove: Neon-specific behaviour (the HTTP driver, connection
 * pooling, autosuspend/resume). That gap is recorded in docs/DB.md.
 */

// vitest runs with cwd at the repo root (see package.json's "test" script), so this is
// stable regardless of which file is asking — deliberately not import.meta.url-based,
// since Vite's module graph does not always give that a real file:// URL under test.
const MIGRATIONS_FOLDER = resolve(process.cwd(), 'drizzle');

async function freshDb() {
  const client = new PGlite();
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return { client, db };
}

// A syntactically-valid 64-hex-char string, standing in for a real SHA-256/HMAC digest.
const FAKE_HASH = 'a'.repeat(64);

describe('migrations apply cleanly to an empty database', () => {
  it('runs both migration files against a fresh PGlite instance with no error', async () => {
    const { db } = await freshDb();
    const rows = await db.select().from(users);
    expect(rows).toEqual([]);
  });

  it('is idempotent: re-running migrate() on an already-migrated database is a no-op', async () => {
    const { client, db } = await freshDb();
    // Insert a row so we can prove the second migrate() didn't touch data or re-run
    // anything that would fail on already-existing objects (types, triggers, indexes).
    const [user] = await db
      .insert(users)
      .values({
        email: 'idempotent@example.com',
        passwordHash: 'hash',
        recoveryCodeHash: 'hash',
      })
      .returning();
    expect(user).toBeDefined();

    await expect(migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })).resolves.not.toThrow();

    const rows = await db.select().from(users);
    expect(rows).toHaveLength(1);
    await client.close();
  });
});

describe('deleting a user cascades to every row they own', () => {
  it('removes sessions, profile, entries, weights, custom_foods, favourites and settings', async () => {
    const { db } = await freshDb();

    const [user] = await db
      .insert(users)
      .values({
        email: 'cascade@example.com',
        passwordHash: 'hash',
        recoveryCodeHash: 'hash',
      })
      .returning();
    if (!user) throw new Error('setup: user insert failed');
    const userId = user.id;

    await db.insert(sessions).values({
      userId,
      tokenHash: FAKE_HASH,
      expiresAt: new Date(Date.now() + 1000),
      absoluteExpiresAt: new Date(Date.now() + 1000),
      ipHash: FAKE_HASH,
    });

    await db.insert(profiles).values({
      userId,
      sex: 'male',
      age: 30,
      heightCm: '180.0',
      weightKg: '80.0',
      activity: 'moderate',
      goal: 'maintain',
    });

    await db.insert(entries).values({
      id: '11111111-1111-1111-1111-111111111111',
      userId,
      day: '2026-07-31',
      name: 'Chicken breast',
      grams: '150.0',
      kcal: '247.5',
      protein: '46.5',
      carbs: '0',
      fat: '5.4',
      meal: 'lunch',
      source: 'food-db',
      loggedAt: new Date(),
    });

    await db.insert(weights).values({
      id: '22222222-2222-2222-2222-222222222222',
      userId,
      day: '2026-07-31',
      weightKg: '80.0',
    });

    await db.insert(customFoods).values({
      id: '33333333-3333-3333-3333-333333333333',
      userId,
      name: 'Homemade granola',
      category: 'snacks',
      kcal: '450.0',
      protein: '10.0',
      carbs: '55.0',
      fat: '20.0',
    });

    await db.insert(favourites).values({ userId, foodId: 'chicken-breast' });
    await db.insert(userSettings).values({ userId });

    // Also present, keyed by email, not user_id — must survive the delete (see below).
    await db.insert(authAttempts).values({
      key: 'cascade@example.com',
      scope: 'account',
      action: 'login',
      success: false,
    });

    // Every table actually has a row before we delete, or this test would pass by
    // vacuously finding nothing either way.
    expect(await db.select().from(sessions).where(eq(sessions.userId, userId))).toHaveLength(1);
    expect(await db.select().from(profiles).where(eq(profiles.userId, userId))).toHaveLength(1);
    expect(await db.select().from(entries).where(eq(entries.userId, userId))).toHaveLength(1);
    expect(await db.select().from(weights).where(eq(weights.userId, userId))).toHaveLength(1);
    expect(await db.select().from(customFoods).where(eq(customFoods.userId, userId))).toHaveLength(
      1,
    );
    expect(await db.select().from(favourites).where(eq(favourites.userId, userId))).toHaveLength(
      1,
    );
    expect(
      await db.select().from(userSettings).where(eq(userSettings.userId, userId)),
    ).toHaveLength(1);

    await db.delete(users).where(eq(users.id, userId));

    expect(await db.select().from(sessions).where(eq(sessions.userId, userId))).toHaveLength(0);
    expect(await db.select().from(profiles).where(eq(profiles.userId, userId))).toHaveLength(0);
    expect(await db.select().from(entries).where(eq(entries.userId, userId))).toHaveLength(0);
    expect(await db.select().from(weights).where(eq(weights.userId, userId))).toHaveLength(0);
    expect(await db.select().from(customFoods).where(eq(customFoods.userId, userId))).toHaveLength(
      0,
    );
    expect(await db.select().from(favourites).where(eq(favourites.userId, userId))).toHaveLength(
      0,
    );
    expect(
      await db.select().from(userSettings).where(eq(userSettings.userId, userId)),
    ).toHaveLength(0);
    expect(await db.select().from(users).where(eq(users.id, userId))).toHaveLength(0);

    // Documented, intentional exception: auth_attempts has no FK to users (see
    // docs/DB.md) — it survives account deletion because it is keyed by email/ip, not
    // user_id, and exists to stop delete-and-recreate lockout bypass.
    expect(
      await db.select().from(authAttempts).where(eq(authAttempts.key, 'cascade@example.com')),
    ).toHaveLength(1);
  });
});

describe('server-assigned updated_at trigger', () => {
  it('overwrites a client-supplied updated_at on insert', async () => {
    const { db } = await freshDb();
    const [user] = await db
      .insert(users)
      .values({ email: 'clock@example.com', passwordHash: 'h', recoveryCodeHash: 'h' })
      .returning();
    if (!user) throw new Error('setup failed');

    const suspiciousClientClock = new Date('2000-01-01T00:00:00Z');
    const [row] = await db
      .insert(userSettings)
      .values({ userId: user.id, updatedAt: suspiciousClientClock })
      .returning();

    expect(row?.updatedAt.getFullYear()).toBeGreaterThan(2000);
    expect(row?.updatedAt.getTime()).not.toBe(suspiciousClientClock.getTime());
  });

  it('overwrites a client-supplied updated_at on update, every time', async () => {
    const { db } = await freshDb();
    const [user] = await db
      .insert(users)
      .values({ email: 'clock2@example.com', passwordHash: 'h', recoveryCodeHash: 'h' })
      .returning();
    if (!user) throw new Error('setup failed');
    await db.insert(userSettings).values({ userId: user.id });

    const before = (
      await db.select().from(userSettings).where(eq(userSettings.userId, user.id))
    )[0]?.updatedAt;

    const suspiciousClientClock = new Date('1999-01-01T00:00:00Z');
    await db
      .update(userSettings)
      .set({ reducedMotion: true, updatedAt: suspiciousClientClock })
      .where(eq(userSettings.userId, user.id));

    const after = (
      await db.select().from(userSettings).where(eq(userSettings.userId, user.id))
    )[0];

    expect(after?.reducedMotion).toBe(true);
    expect(after?.updatedAt.getTime()).not.toBe(suspiciousClientClock.getTime());
    expect(before).toBeDefined();
    expect(after?.updatedAt.getTime()).toBeGreaterThanOrEqual(before?.getTime() ?? 0);
  });
});

describe('numeric macro columns do not drift like float would', () => {
  it('round-trips fractional grams/kcal exactly, as strings', async () => {
    const { db } = await freshDb();
    const [user] = await db
      .insert(users)
      .values({ email: 'numeric@example.com', passwordHash: 'h', recoveryCodeHash: 'h' })
      .returning();
    if (!user) throw new Error('setup failed');

    const [row] = await db
      .insert(entries)
      .values({
        id: '44444444-4444-4444-4444-444444444444',
        userId: user.id,
        day: '2026-07-31',
        name: 'Oats',
        // A value that is a classic IEEE-754 float trap (0.1 + 0.2 !== 0.3 in JS).
        grams: '0.1',
        kcal: '0.30',
        protein: '10.10',
        carbs: '20.20',
        fat: '5.05',
        meal: 'breakfast',
        source: 'manual',
        loggedAt: new Date(),
      })
      .returning();

    // Drizzle's numeric mode defaults to 'string' precisely so JS never touches these
    // as floating-point doubles.
    expect(typeof row?.grams).toBe('string');
    // grams is numeric(8,2), so the stored value is exactly '0.10' — deterministic
    // decimal padding, not float error. Compare against the exact expected string,
    // not a parsed number, which is the entire point of numeric mode: 'string'.
    expect(row?.grams).toBe('0.10');
    expect(row?.kcal).toBe('0.30');
  });
});

describe('constraints reject bad data instead of silently accepting it', () => {
  it('rejects a duplicate email (case-insensitive uniqueness is enforced via lowercasing)', async () => {
    const { db } = await freshDb();
    await db
      .insert(users)
      .values({ email: 'dup@example.com', passwordHash: 'h', recoveryCodeHash: 'h' });
    await expect(
      db.insert(users).values({ email: 'dup@example.com', passwordHash: 'h', recoveryCodeHash: 'h' }),
    ).rejects.toThrow();
  });

  it('rejects a non-lowercase email at the database layer', async () => {
    const { db } = await freshDb();
    await expect(
      db
        .insert(users)
        .values({ email: 'Mixed@Example.com', passwordHash: 'h', recoveryCodeHash: 'h' }),
    ).rejects.toThrow();
  });

  it('rejects a negative weight', async () => {
    const { db } = await freshDb();
    const [user] = await db
      .insert(users)
      .values({ email: 'neg@example.com', passwordHash: 'h', recoveryCodeHash: 'h' })
      .returning();
    if (!user) throw new Error('setup failed');
    await expect(
      db.insert(weights).values({
        id: '55555555-5555-5555-5555-555555555555',
        userId: user.id,
        day: '2026-07-31',
        weightKg: '-1',
      }),
    ).rejects.toThrow();
  });

  it('rejects a second live weight entry for the same user and day', async () => {
    const { db } = await freshDb();
    const [user] = await db
      .insert(users)
      .values({ email: 'oneweight@example.com', passwordHash: 'h', recoveryCodeHash: 'h' })
      .returning();
    if (!user) throw new Error('setup failed');
    await db.insert(weights).values({
      id: '66666666-6666-6666-6666-666666666666',
      userId: user.id,
      day: '2026-07-31',
      weightKg: '80.0',
    });
    await expect(
      db.insert(weights).values({
        id: '77777777-7777-7777-7777-777777777777',
        userId: user.id,
        day: '2026-07-31',
        weightKg: '81.0',
      }),
    ).rejects.toThrow();
  });

  it('allows a new live weight for the same day once the first is tombstoned', async () => {
    const { db } = await freshDb();
    const [user] = await db
      .insert(users)
      .values({ email: 'retomb@example.com', passwordHash: 'h', recoveryCodeHash: 'h' })
      .returning();
    if (!user) throw new Error('setup failed');
    const id1 = '88888888-8888-8888-8888-888888888888';
    const id2 = '99999999-9999-9999-9999-999999999999';
    await db.insert(weights).values({ id: id1, userId: user.id, day: '2026-07-31', weightKg: '80.0' });
    await db.update(weights).set({ deletedAt: new Date() }).where(eq(weights.id, id1));
    await expect(
      db.insert(weights).values({ id: id2, userId: user.id, day: '2026-07-31', weightKg: '81.0' }),
    ).resolves.not.toThrow();
  });

  it('rejects an IP-scoped auth_attempts key that is not a 64-hex-char hash', async () => {
    const { db } = await freshDb();
    await expect(
      db.insert(authAttempts).values({
        key: '203.0.113.5', // a raw IP — exactly what must never land here
        scope: 'ip',
        action: 'login',
      }),
    ).rejects.toThrow();
  });

  it('accepts a properly hashed IP-scoped auth_attempts key', async () => {
    const { db } = await freshDb();
    await expect(
      db.insert(authAttempts).values({ key: FAKE_HASH, scope: 'ip', action: 'login' }),
    ).resolves.not.toThrow();
  });

  it('rejects an out-of-range age', async () => {
    const { db } = await freshDb();
    const [user] = await db
      .insert(users)
      .values({ email: 'age@example.com', passwordHash: 'h', recoveryCodeHash: 'h' })
      .returning();
    if (!user) throw new Error('setup failed');
    await expect(
      db.insert(profiles).values({
        userId: user.id,
        sex: 'female',
        age: 0,
        heightCm: '170.0',
        weightKg: '60.0',
        activity: 'light',
        goal: 'cut',
      }),
    ).rejects.toThrow();
  });
});

describe('favourites is idempotent by natural key', () => {
  it('re-favouriting the same food upserts on (user_id, food_id) instead of duplicating', async () => {
    const { db } = await freshDb();
    const [user] = await db
      .insert(users)
      .values({ email: 'fav@example.com', passwordHash: 'h', recoveryCodeHash: 'h' })
      .returning();
    if (!user) throw new Error('setup failed');

    await db.insert(favourites).values({ userId: user.id, foodId: 'chicken-breast' });
    await db
      .insert(favourites)
      .values({ userId: user.id, foodId: 'chicken-breast' })
      .onConflictDoUpdate({
        target: [favourites.userId, favourites.foodId],
        set: { deletedAt: null },
      });

    const rows = await db
      .select()
      .from(favourites)
      .where(and(eq(favourites.userId, user.id), isNull(favourites.deletedAt)));
    expect(rows).toHaveLength(1);
  });
});
