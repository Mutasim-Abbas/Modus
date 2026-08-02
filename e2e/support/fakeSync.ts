import type { Page } from '@playwright/test';

/**
 * A MOCK backend for `api/auth/*` and `api/sync/*`.
 *
 * ## Read this before trusting anything it proves
 *
 * There is no `DATABASE_URL`, no `SESSION_PEPPER` and no Neon project on this machine,
 * and the publish hold forbids creating one (the project notes ground rule 1). So the
 * sign-up / sign-in / two-device / offline-sync journeys **cannot** be driven against a
 * real backend, and every spec that uses this file is titled `MOCK-BACKED`.
 *
 * What that does and does not buy:
 *
 * - **Genuinely exercised:** the whole client — `src/lib/authApi.ts`, `src/lib/sync/*`
 *   (diff/outbox, LWW merge, adoption, the background engine), the auth screens, the
 *   sync chip, and the store — running in a real browser, over two real browser
 *   contexts that share one server-side dataset.
 * - **NOT exercised:** `api/` itself, Postgres, argon2, the session cookie, the
 *   `updated_at` DB trigger, rate limiting, or anything else the server does. A green
 *   run here says nothing whatsoever about the deployed backend.
 *
 * To stay honest, the serializers below mirror `api/_lib/sync/rows.ts` **exactly**:
 * numeric columns go out as decimal strings and every timestamp as an ISO string —
 * including `loggedAt`, which the real `serializeEntry` writes with `toIso(...)`. That
 * fidelity is not cosmetic; it is what surfaced the `loggedAt` finding recorded in
 * `e2e/auth-sync-mocked.spec.ts`.
 */

export interface PushEntryOpLike {
  id: string;
  deleted?: boolean;
  day?: string;
  name?: string;
  grams?: number;
  kcal?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  meal?: string;
  source?: string;
  foodId?: string | null;
  loggedAt?: number;
}

interface StoredEntry {
  id: string;
  day: string;
  name: string;
  grams: number;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  meal: string;
  source: string;
  foodId: string | null;
  loggedAt: number;
  updatedAt: string;
  deletedAt: string | null;
}

interface StoredProfile {
  sex: string;
  age: number;
  heightCm: number;
  weightKg: number;
  activity: string;
  goal: string;
  updatedAt: string;
  deletedAt: string | null;
}

interface StoredSettings {
  locale: string;
  reducedMotion: boolean;
  updatedAt: string;
  deletedAt: string | null;
}

export interface FakeBackend {
  /** Every push body the server received, newest last. */
  readonly pushes: unknown[];
  readonly entries: Map<string, StoredEntry>;
  profile: StoredProfile | null;
  settings: StoredSettings | null;
  /** Wires this backend into one browser context. Each page gets its own session. */
  install(page: Page): Promise<void>;
  /** Makes every `/api/sync/*` call fail as if the network were down. */
  setOffline(offline: boolean): void;
  seedEntry(entry: Partial<StoredEntry> & { id: string; name: string; day: string }): void;
  seedProfile(profile: Partial<StoredProfile>): void;
}

const USER = {
  id: '11111111-2222-3333-4444-555555555555',
  email: 'test@example.com',
  emailVerified: false,
  createdAt: '2026-08-01T10:00:00.000Z',
};

export const FAKE_USER = USER;
export const FAKE_PASSWORD = 'correct horse battery staple';
export const FAKE_RECOVERY_CODE = 'FM-7Q4K-2XPD-9RTM';

/** Mirrors `api/_lib/sync/rows.ts`: `numeric` columns leave Postgres as strings. */
function dec(value: number): string {
  return value.toFixed(2);
}

export function createFakeBackend(): FakeBackend {
  const entries = new Map<string, StoredEntry>();
  const pushes: unknown[] = [];
  let clock = 0;
  let offline = false;

  const backend: FakeBackend = {
    pushes,
    entries,
    profile: null,
    settings: null,
    setOffline(next) {
      offline = next;
    },
    seedEntry(entry) {
      entries.set(entry.id, {
        grams: 100,
        kcal: 100,
        protein: 1,
        carbs: 1,
        fat: 1,
        meal: 'lunch',
        source: 'manual',
        foodId: null,
        loggedAt: Date.parse('2026-08-01T12:00:00.000Z'),
        updatedAt: stamp(),
        deletedAt: null,
        ...entry,
      });
    },
    seedProfile(profile) {
      backend.profile = {
        sex: 'male',
        age: 30,
        heightCm: 180,
        weightKg: 80,
        activity: 'moderate',
        goal: 'maintain',
        updatedAt: stamp(),
        deletedAt: null,
        ...profile,
      };
    },
    async install(page) {
      let signedIn = false;

      await page.route('**/api/auth/me', (route) =>
        signedIn
          ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: USER }) })
          : route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'unauthorized' }) }),
      );

      await page.route('**/api/auth/signup', (route) => {
        signedIn = true;
        return route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({ user: USER, recoveryCode: FAKE_RECOVERY_CODE }),
        });
      });

      await page.route('**/api/auth/login', (route) => {
        const body = route.request().postDataJSON() as { email?: string; password?: string };
        if (body.password !== FAKE_PASSWORD) {
          return route.fulfill({
            status: 401,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'invalid_credentials' }),
          });
        }
        signedIn = true;
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: USER }) });
      });

      await page.route('**/api/auth/logout', (route) => {
        signedIn = false;
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
      });

      await page.route('**/api/sync/pull*', (route) => {
        if (offline) return route.abort('internetdisconnected');
        if (!signedIn) {
          return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'unauthorized' }) });
        }
        const url = new URL(route.request().url());
        const raw = url.searchParams.get('cursor');
        const cursor = raw ? (JSON.parse(raw) as { entries?: { updatedAt: string; id: string } | null }) : null;
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(pullBody(cursor?.entries ?? null)),
        });
      });

      await page.route('**/api/sync/push', (route) => {
        if (offline) return route.abort('internetdisconnected');
        if (!signedIn) {
          return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'unauthorized' }) });
        }
        const body = route.request().postDataJSON() as {
          entries?: PushEntryOpLike[];
          profile?: Record<string, unknown> | null;
          settings?: Record<string, unknown> | null;
        };
        pushes.push(body);
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(applyPush(body)),
        });
      });
    },
  };

  function stamp(): string {
    clock += 1;
    return new Date(Date.UTC(2026, 7, 2, 0, 0, clock)).toISOString();
  }

  function applyPush(body: {
    entries?: PushEntryOpLike[];
    profile?: Record<string, unknown> | null;
    settings?: Record<string, unknown> | null;
  }): unknown {
    const applied: { id: string; updatedAt: string; deletedAt: string | null }[] = [];

    for (const op of body.entries ?? []) {
      const updatedAt = stamp();
      const existing = entries.get(op.id);
      if (op.deleted) {
        if (existing) entries.set(op.id, { ...existing, updatedAt, deletedAt: updatedAt });
        applied.push({ id: op.id, updatedAt, deletedAt: updatedAt });
        continue;
      }
      entries.set(op.id, {
        id: op.id,
        day: op.day ?? '',
        name: op.name ?? '',
        grams: op.grams ?? 0,
        kcal: op.kcal ?? 0,
        protein: op.protein ?? 0,
        carbs: op.carbs ?? 0,
        fat: op.fat ?? 0,
        meal: op.meal ?? 'snack',
        source: op.source ?? 'manual',
        foodId: op.foodId ?? null,
        loggedAt: op.loggedAt ?? 0,
        updatedAt,
        deletedAt: null,
      });
      applied.push({ id: op.id, updatedAt, deletedAt: null });
    }

    let appliedProfile: { updatedAt: string; deletedAt: string | null } | null = null;
    if (body.profile) {
      const updatedAt = stamp();
      backend.profile = {
        sex: String(body.profile.sex ?? 'male'),
        age: Number(body.profile.age ?? 0),
        heightCm: Number(body.profile.heightCm ?? 0),
        weightKg: Number(body.profile.weightKg ?? 0),
        activity: String(body.profile.activity ?? 'moderate'),
        goal: String(body.profile.goal ?? 'maintain'),
        updatedAt,
        deletedAt: null,
      };
      appliedProfile = { updatedAt, deletedAt: null };
    }

    let appliedSettings: { updatedAt: string; deletedAt: string | null } | null = null;
    if (body.settings) {
      const updatedAt = stamp();
      backend.settings = {
        locale: String(body.settings.locale ?? 'en'),
        reducedMotion: body.settings.reducedMotion === true,
        updatedAt,
        deletedAt: null,
      };
      appliedSettings = { updatedAt, deletedAt: null };
    }

    return {
      serverState: watermark(),
      applied: {
        profile: appliedProfile,
        settings: appliedSettings,
        entries: applied,
        weights: [],
        customFoods: [],
        favourites: [],
      },
      rejected: { entries: [], weights: [], customFoods: [], favourites: [] },
    };
  }

  function newestEntry(): StoredEntry | null {
    return Array.from(entries.values()).reduce<StoredEntry | null>(
      (best, row) => (!best || row.updatedAt > best.updatedAt ? row : best),
      null,
    );
  }

  function watermark(): Record<string, unknown> {
    const newest = newestEntry();
    return {
      profile: backend.profile?.updatedAt ?? null,
      settings: backend.settings?.updatedAt ?? null,
      entries: newest ? { updatedAt: newest.updatedAt, id: newest.id } : null,
      weights: null,
      customFoods: null,
      favourites: null,
    };
  }

  function pullBody(cursor: { updatedAt: string; id: string } | null): Record<string, unknown> {
    const delivered = Array.from(entries.values())
      .filter(
        (row) =>
          !cursor ||
          row.updatedAt > cursor.updatedAt ||
          (row.updatedAt === cursor.updatedAt && row.id > cursor.id),
      )
      .sort((a, b) => (a.updatedAt === b.updatedAt ? a.id.localeCompare(b.id) : a.updatedAt.localeCompare(b.updatedAt)));

    const last = delivered[delivered.length - 1];
    const live = Array.from(entries.values()).filter((row) => row.deletedAt === null);
    const days = Array.from(new Set(live.map((row) => row.day))).sort();

    return {
      cursor: {
        profile: backend.profile?.updatedAt ?? null,
        settings: backend.settings?.updatedAt ?? null,
        entries: last ? { updatedAt: last.updatedAt, id: last.id } : (cursor ?? null),
        weights: null,
        customFoods: null,
        favourites: null,
      },
      hasMore: { entries: false, weights: false, customFoods: false, favourites: false },
      profile: backend.profile
        ? {
            sex: backend.profile.sex,
            age: backend.profile.age,
            heightCm: dec(backend.profile.heightCm),
            weightKg: dec(backend.profile.weightKg),
            activity: backend.profile.activity,
            goal: backend.profile.goal,
            updatedAt: backend.profile.updatedAt,
            deletedAt: backend.profile.deletedAt,
          }
        : null,
      settings: backend.settings,
      // Serialized exactly like `api/_lib/sync/rows.ts` — decimal strings, ISO timestamps.
      entries: delivered.map((row) => ({
        id: row.id,
        day: row.day,
        name: row.name,
        grams: dec(row.grams),
        kcal: dec(row.kcal),
        protein: dec(row.protein),
        carbs: dec(row.carbs),
        fat: dec(row.fat),
        meal: row.meal,
        source: row.source,
        foodId: row.foodId,
        loggedAt: new Date(row.loggedAt).toISOString(),
        updatedAt: row.updatedAt,
        deletedAt: row.deletedAt,
      })),
      weights: [],
      customFoods: [],
      favourites: [],
      counts: {
        entries: {
          total: live.length,
          days: days.length,
          firstDay: days[0] ?? null,
          lastDay: days[days.length - 1] ?? null,
        },
        weights: { total: 0 },
        customFoods: { total: 0 },
        favourites: { total: 0 },
        lastChangeAt: newestEntry()?.updatedAt ?? null,
      },
    };
  }

  return backend;
}
