import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore } from '@/lib/store';
import { buildOutbox, applyPushResultToAcked } from '@/lib/sync/diff';
import { pull, push } from '@/lib/sync/client';
import { defaultAccountSyncState } from '@/lib/sync/persist';
import type { AccountSyncState } from '@/lib/sync/persist';

/**
 * 🚨 THE F-03 TEST — the internal security audit F-03 / the project notes Task 6's "one thing
 * that must not go wrong": a push must NEVER advance the pull cursor. Only a
 * `GET /api/sync/pull` response may.
 *
 * Scenario, taken directly from the walkthrough in docs/API.md and
 * the internal security audit §3.3:
 *   1. Devices A and B are both signed in to the same account. A's saved pull cursor
 *      for `entries` is empty (T0 — nothing pulled yet).
 *   2. Device B logs a row. The (mock) server assigns it `updated_at = T1`.
 *   3. Device A has NOT pulled yet. A pushes its own row, assigned `updated_at = T2 >
 *      T1`. The push response's `serverState.entries` is `T2` (the account's newest
 *      row across every device — including B's, which A has never received).
 *   4. A must NOT adopt `serverState` as its next pull cursor. It must pull with its
 *      ORIGINAL, unchanged cursor (still T0/empty) and receive BOTH rows — including
 *      B's, which it has never seen.
 *
 * This is pinned against `src/lib/sync/client.ts` + `src/lib/sync/diff.ts` directly (the
 * actual client code a real sync cycle uses), against a tiny mock backend that behaves
 * exactly like the real server for this one property: `push` returns a `serverState`
 * computed across ALL rows ever written (by any device), while `pull` only ever
 * returns rows after the cursor it's given.
 */

interface MockRow {
  id: string;
  updatedAt: string; // ISO, monotonically increasing per mock "server" write
}

function buildMockServer() {
  const rows: MockRow[] = [];
  let clock = 0;
  const nextTimestamp = (): string => {
    clock += 1;
    return new Date(2026, 0, 1, 0, 0, clock).toISOString();
  };

  return {
    rows,
    fetchImpl: (url: string, init?: RequestInit): Promise<Response> => {
      if (url.startsWith('/api/sync/push')) {
        const rawBody = typeof init?.body === 'string' ? init.body : '{}';
        const body = JSON.parse(rawBody) as { entries?: { id: string; deleted: boolean }[] };
        const applied: { id: string; updatedAt: string; deletedAt: string | null }[] = [];
        for (const op of body.entries ?? []) {
          const updatedAt = nextTimestamp();
          const existing = rows.findIndex((r) => r.id === op.id);
          const row = { id: op.id, updatedAt };
          if (existing >= 0) rows[existing] = row;
          else rows.push(row);
          applied.push({ id: op.id, updatedAt, deletedAt: null });
        }
        // serverState: the account's newest row updated_at ACROSS EVERY DEVICE — the
        // exact "unsafe if adopted as a cursor" shape docs/API.md describes.
        const newest = rows.reduce<MockRow | null>((max, r) => (!max || r.updatedAt > max.updatedAt ? r : max), null);
        return Promise.resolve(
          jsonResponse(200, {
            serverState: { entries: newest ? { updatedAt: newest.updatedAt, id: newest.id } : null },
            applied: { entries: applied, weights: [], customFoods: [], favourites: [] },
            rejected: { entries: [], weights: [], customFoods: [], favourites: [] },
          }),
        );
      }

      if (url.startsWith('/api/sync/pull')) {
        const cursorParam = new URL(url, 'http://localhost').searchParams.get('cursor');
        const cursor = cursorParam ? (JSON.parse(cursorParam) as { entries?: { updatedAt: string; id: string } | null }) : {};
        const cursorEntry = cursor.entries ?? null;
        const delivered = rows.filter((r) => !cursorEntry || r.updatedAt > cursorEntry.updatedAt || (r.updatedAt === cursorEntry.updatedAt && r.id > cursorEntry.id));
        const newest = rows.reduce<MockRow | null>((max, r) => (!max || r.updatedAt > max.updatedAt ? r : max), null);
        return Promise.resolve(
          jsonResponse(200, {
            cursor: { entries: newest ? { updatedAt: newest.updatedAt, id: newest.id } : null },
            hasMore: { entries: false, weights: false, customFoods: false, favourites: false },
            profile: null,
            settings: null,
            entries: delivered.map((r) => ({
              id: r.id,
              day: '2026-01-01',
              name: r.id,
              grams: '1.00',
              kcal: '1.00',
              protein: '0.00',
              carbs: '0.00',
              fat: '0.00',
              meal: 'snack',
              source: 'manual',
              foodId: null,
              loggedAt: 1,
              updatedAt: r.updatedAt,
              deletedAt: null,
            })),
            weights: [],
            customFoods: [],
            favourites: [],
            counts: {},
          }),
        );
      }

      return Promise.resolve(jsonResponse(404, {}));
    },
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, headers: new Headers(), json: () => Promise.resolve(body) } as Response;
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('F-03 — a push must never advance the pull cursor', () => {
  it('device A pushing without pulling first still receives device B\'s row on its next pull with its ORIGINAL cursor', async () => {
    const server = buildMockServer();
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => server.fetchImpl(url, init)));

    // --- Device B: logs a row directly against the mock server (simulating another
    // device that has already synced it). ---
    await push({ entries: [{ id: 'b-breakfast', deleted: false, day: '2026-01-01', name: 'Oatmeal', grams: 200, kcal: 150, protein: 5, carbs: 27, fat: 3, meal: 'breakfast', source: 'manual', foodId: null, loggedAt: 1 }] });

    // --- Device A: has never pulled. Its saved cursor is empty (T0). ---
    const deviceA = createStore();
    deviceA.addEntry(
      { name: 'Lunch salad', grams: 300, kcal: 400, protein: 20, carbs: 30, fat: 15, meal: 'lunch', source: 'manual' },
      '2026-01-01',
    );
    const originalCursor = null; // device A has never pulled — this IS its "original" state

    const syncStateBefore: AccountSyncState = defaultAccountSyncState();
    const outbox = buildOutbox(deviceA.getState(), syncStateBefore);
    const pushResult = await push(outbox.body);

    // The push response's `serverState` reflects BOTH devices' rows (it's an
    // account-wide watermark) — which is exactly why it must never become a cursor.
    expect(pushResult.serverState.entries?.id).not.toBeNull();

    // The client folds the push result into its acked map — this must NEVER touch
    // `pullCursor`. `applyPushResultToAcked` doesn't even accept a cursor argument,
    // but the assertion below is the behavioural proof, not just a type-level one.
    const syncStateAfterPush = applyPushResultToAcked(syncStateBefore, outbox.manifest, pushResult);
    expect(syncStateAfterPush.pullCursor).toBe(originalCursor); // unchanged: still null

    // Device A now pulls — using its ORIGINAL (unchanged, still-null) cursor, not
    // anything derived from `serverState`.
    const pullResult = await pull(syncStateAfterPush.pullCursor);

    const ids = pullResult.entries.map((e) => e.id);
    expect(ids).toContain('b-breakfast'); // <-- the row this device never saw before
    expect(ids).toContain(deviceA.getState().days['2026-01-01']?.entries[0]?.id);
  });

  it('adopting serverState AS a cursor would have silently lost the other device\'s row — proving the bug the fix prevents', async () => {
    const server = buildMockServer();
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => server.fetchImpl(url, init)));

    await push({ entries: [{ id: 'b-breakfast', deleted: false, day: '2026-01-01', name: 'Oatmeal', grams: 200, kcal: 150, protein: 5, carbs: 27, fat: 3, meal: 'breakfast', source: 'manual', foodId: null, loggedAt: 1 }] });

    const pushResult = await push({ entries: [{ id: 'a-lunch', deleted: false, day: '2026-01-01', name: 'Salad', grams: 300, kcal: 400, protein: 20, carbs: 30, fat: 15, meal: 'lunch', source: 'manual', foodId: null, loggedAt: 2 }] });

    // This is the INCORRECT thing docs/API.md used to instruct (F-03) — demonstrated
    // here only to prove the failure mode the real client code must never reproduce.
    const wronglyAdoptedCursor = pushResult.serverState;
    const pullWithWrongCursor = await pull(wronglyAdoptedCursor);
    expect(pullWithWrongCursor.entries.map((e) => e.id)).not.toContain('b-breakfast'); // <-- lost, permanently

    // The correct behaviour: pull with the ORIGINAL cursor (null, since this account
    // was never pulled before either push) recovers everything.
    const pullWithCorrectCursor = await pull(null);
    expect(pullWithCorrectCursor.entries.map((e) => e.id)).toEqual(
      expect.arrayContaining(['b-breakfast', 'a-lunch']),
    );
  });
});
