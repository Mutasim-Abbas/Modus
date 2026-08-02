import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { store } from '@/lib/store';
import * as client from '@/lib/sync/client';
import { syncEngine } from '@/lib/sync/engine';
import { buildOutbox } from '@/lib/sync/diff';
import { defaultAccountSyncState, loadAccountSyncState, saveAccountSyncState } from '@/lib/sync/persist';
import { deriveSyncChipView } from '@/features/sync/syncChipView';
import type { PullResult, PushResult } from '@/lib/sync/types';

/**
 * Permanent regression coverage for the internal security audit's third pass, F-16 and
 * F-17 — promoted from the throwaway `__audit_probe.test.ts` used to find them (now
 * deleted). Each `it()` below states, in its title, the exact defect it pins.
 *
 * F-16's root cause: the existing suite only ever drove ONE sync cycle, so
 * `applyIncrementalPull` never acking a pulled row was invisible — the very next
 * `buildOutbox` call was never made inside a test. Every convergence test here runs
 * `syncNow()` at least twice for exactly that reason.
 */

const USER_ID = 'convergence-user';

/** A mock server reproducing the one property of `api/sync/push.ts` + `pull.ts` that
 *  F-16 depends on: the DB trigger re-stamps `updated_at` on every write, and a pull
 *  returns every row after the given cursor — including rows this very device just
 *  pushed, if the device doesn't advance its cursor past them itself. */
function mockServer() {
  const rows = new Map<string, { id: string; updatedAt: string; name: string }>();
  let clock = 0;
  const stamp = (): string => {
    clock += 1;
    return new Date(Date.UTC(2030, 0, 1, 0, 0, clock)).toISOString();
  };
  const newest = (): { id: string; updatedAt: string } | null =>
    Array.from(rows.values()).reduce<{ id: string; updatedAt: string } | null>(
      (m, r) => (!m || r.updatedAt > m.updatedAt ? r : m),
      null,
    );

  return {
    rows,
    push: (body: Parameters<typeof client.push>[0]): Promise<PushResult> => {
      const applied: { id: string; updatedAt: string; deletedAt: string | null }[] = [];
      for (const op of body.entries ?? []) {
        const updatedAt = stamp();
        rows.set(op.id, {
          id: op.id,
          updatedAt,
          name: 'deleted' in op && op.deleted ? 'x' : (op as { name: string }).name,
        });
        applied.push({ id: op.id, updatedAt, deletedAt: null });
      }
      const n = newest();
      return Promise.resolve({
        serverState: {
          profile: null,
          settings: null,
          entries: n ? { updatedAt: n.updatedAt, id: n.id } : null,
          weights: null,
          customFoods: null,
          favourites: null,
        },
        applied: { profile: null, settings: null, entries: applied, weights: [], customFoods: [], favourites: [] },
        rejected: { entries: [], weights: [], customFoods: [], favourites: [] },
      });
    },
    pull: (cursor: Parameters<typeof client.pull>[0]): Promise<PullResult> => {
      const c = cursor?.entries ?? null;
      const delivered = Array.from(rows.values()).filter(
        (r) => !c || r.updatedAt > c.updatedAt || (r.updatedAt === c.updatedAt && r.id > c.id),
      );
      const n = newest();
      return Promise.resolve({
        cursor: {
          profile: null,
          settings: null,
          entries: n ? { updatedAt: n.updatedAt, id: n.id } : null,
          weights: null,
          customFoods: null,
          favourites: null,
        },
        hasMore: { entries: false, weights: false, customFoods: false, favourites: false },
        profile: null,
        settings: null,
        entries: delivered.map((r) => ({
          id: r.id,
          day: '2030-01-01',
          name: r.name,
          grams: 100,
          kcal: 100,
          protein: 1,
          carbs: 1,
          fat: 1,
          meal: 'snack',
          source: 'manual',
          foodId: null,
          loggedAt: 1,
          updatedAt: Date.parse(r.updatedAt),
          deletedAt: null,
        })),
        weights: [],
        customFoods: [],
        favourites: [],
        counts: {
          entries: { total: delivered.length, days: 1, firstDay: null, lastDay: null },
          weights: { total: 0 },
          customFoods: { total: 0 },
          favourites: { total: 0 },
          lastChangeAt: null,
        },
      });
    },
  };
}

beforeEach(() => {
  localStorage.clear();
  store.reset();
});

afterEach(() => {
  syncEngine.stop();
  vi.restoreAllMocks();
});

describe('F-16 — sync converges across multiple cycles (engine.ts applyIncrementalPull)', () => {
  it('a local row is pushed once, then never again across five consecutive cycles', async () => {
    saveAccountSyncState(USER_ID, {
      ...defaultAccountSyncState(),
      resolved: true,
      settingsSnapshot: store.getState().settings,
      profileSnapshot: null,
    });
    const server = mockServer();
    const pushSpy = vi.spyOn(client, 'push').mockImplementation(server.push);
    vi.spyOn(client, 'pull').mockImplementation(server.pull);

    store.addEntry({ name: 'Banana', grams: 100, kcal: 89, protein: 1, carbs: 23, fat: 0, meal: 'snack', source: 'manual' });

    syncEngine.start(USER_ID);
    for (let i = 0; i < 5; i += 1) await syncEngine.syncNow();

    const pushedEntryCounts = pushSpy.mock.calls.map((c) => c[0].entries?.length ?? 0);
    // Before the fix this was [1, 1, 1, 1, 1] — pushed on every single cycle, forever.
    expect(pushedEntryCounts).toEqual([1]);
    expect(syncEngine.getState().pendingCount).toBe(0);

    // The local row's `updatedAt` and its `acked` watermark must agree — that equality
    // is exactly what F-16 broke (the pull handed back a newer server re-stamp than the
    // acked map recorded, so the row looked permanently dirty).
    const sync = loadAccountSyncState(USER_ID);
    const localEntry = Object.values(store.getState().days)[0]?.entries[0];
    expect(localEntry).toBeDefined();
    expect(sync.acked.entries[localEntry?.id ?? '']).toBe(localEntry?.updatedAt);
    expect(buildOutbox(store.getState(), sync).pendingCount).toBe(0);
  });

  it('a row that arrives ONLY via a pull is never echoed back to the server (no cross-device ping-pong)', async () => {
    saveAccountSyncState(USER_ID, { ...defaultAccountSyncState(), resolved: true, settingsSnapshot: store.getState().settings });
    const server = mockServer();
    server.rows.set('row-from-device-B', { id: 'row-from-device-B', updatedAt: '2030-01-01T00:00:05.000Z', name: 'Oats' });
    const pushSpy = vi.spyOn(client, 'push').mockImplementation(server.push);
    vi.spyOn(client, 'pull').mockImplementation(server.pull);

    syncEngine.start(USER_ID);
    await syncEngine.syncNow(); // downloads device B's row

    const afterDownload = buildOutbox(store.getState(), loadAccountSyncState(USER_ID));
    expect(afterDownload.pendingCount).toBe(0); // a downloaded row is already known-synced

    await syncEngine.syncNow(); // a second cycle — the row must not go back out

    expect(pushSpy).not.toHaveBeenCalled();
  });

  it('a locally-won merge still pushes — the guard against over-acking (a row must not be marked acked when the LOCAL copy won)', async () => {
    saveAccountSyncState(USER_ID, { ...defaultAccountSyncState(), resolved: true, settingsSnapshot: store.getState().settings });
    const local = store.addEntry(
      { name: 'Freshly edited on this device', grams: 100, kcal: 100, protein: 1, carbs: 1, fat: 1, meal: 'lunch', source: 'manual' },
      '2030-01-01',
    );

    // The pull returns a STALE version of the same row — older than the local edit.
    vi.spyOn(client, 'push').mockResolvedValue({
      serverState: { profile: null, settings: null, entries: null, weights: null, customFoods: null, favourites: null },
      applied: { profile: null, settings: null, entries: [], weights: [], customFoods: [], favourites: [] },
      rejected: { entries: [], weights: [], customFoods: [], favourites: [] },
    });
    const pullSpy = vi.spyOn(client, 'pull').mockResolvedValue({
      cursor: {
        profile: null,
        settings: null,
        entries: { updatedAt: (local.updatedAt - 1000).toString(), id: local.id },
        weights: null,
        customFoods: null,
        favourites: null,
      },
      hasMore: { entries: false, weights: false, customFoods: false, favourites: false },
      profile: null,
      settings: null,
      entries: [
        {
          id: local.id,
          day: '2030-01-01',
          name: 'Stale server copy',
          grams: 1,
          kcal: 1,
          protein: 1,
          carbs: 1,
          fat: 1,
          meal: 'lunch',
          source: 'manual',
          foodId: null,
          loggedAt: 1,
          updatedAt: local.updatedAt - 1000,
          deletedAt: null,
        },
      ],
      weights: [],
      customFoods: [],
      favourites: [],
      counts: { entries: { total: 1, days: 1, firstDay: null, lastDay: null }, weights: { total: 0 }, customFoods: { total: 0 }, favourites: { total: 0 }, lastChangeAt: null },
    });

    syncEngine.start(USER_ID);
    await syncEngine.syncNow();

    // The local (newer) name must survive — the stale pull did not win the merge.
    const stored = Object.values(store.getState().days)[0]?.entries[0];
    expect(stored?.name).toBe('Freshly edited on this device');

    // Critically: the row must NOT be acked, because the version the server has is
    // stale — it still needs to be pushed on a later cycle.
    const sync = loadAccountSyncState(USER_ID);
    expect(sync.acked.entries[local.id]).toBeUndefined();
    expect(buildOutbox(store.getState(), sync).pendingCount).toBeGreaterThan(0);
    expect(pullSpy).toHaveBeenCalled();
  });
});

describe('F-17 — a rejected row is never reported as synced', () => {
  function markResolved(): void {
    saveAccountSyncState(USER_ID, { ...defaultAccountSyncState(), resolved: true, settingsSnapshot: store.getState().settings });
  }

  it("syncNow surfaces a truthful error state when the push response contains a rejection, not 'idle'", async () => {
    markResolved();
    store.addEntry({ name: 'Will be rejected', grams: 1, kcal: 1, protein: 1, carbs: 1, fat: 1, meal: 'snack', source: 'manual' }, '2030-01-01');
    const rejectedId = Object.values(store.getState().days)[0]?.entries[0]?.id ?? '';

    vi.spyOn(client, 'push').mockResolvedValue({
      serverState: { profile: null, settings: null, entries: null, weights: null, customFoods: null, favourites: null },
      applied: { profile: null, settings: null, entries: [], weights: [], customFoods: [], favourites: [] },
      rejected: { entries: [{ id: rejectedId, reason: 'owner_conflict' }], weights: [], customFoods: [], favourites: [] },
    });
    vi.spyOn(client, 'pull').mockResolvedValue({
      cursor: { profile: null, settings: null, entries: null, weights: null, customFoods: null, favourites: null },
      hasMore: { entries: false, weights: false, customFoods: false, favourites: false },
      profile: null,
      settings: null,
      entries: [],
      weights: [],
      customFoods: [],
      favourites: [],
      counts: { entries: { total: 0, days: 0, firstDay: null, lastDay: null }, weights: { total: 0 }, customFoods: { total: 0 }, favourites: { total: 0 }, lastChangeAt: null },
    });

    syncEngine.start(USER_ID);
    await syncEngine.syncNow();

    // Before the fix: activity was unconditionally reset to 'idle' with a null error,
    // regardless of `rejected`.
    expect(syncEngine.getState().activity).toBe('error');
    expect(syncEngine.getState().lastErrorMessage).toBeTruthy();
    expect(syncEngine.getState().pendingCount).toBeGreaterThan(0);

    // The rejected row stays pending (un-acked) — it will be retried, not silently dropped.
    const sync = loadAccountSyncState(USER_ID);
    expect(sync.acked.entries[rejectedId]).toBeUndefined();
  });

  it("deriveSyncChipView never returns 'synced' while pendingCount > 0, even if activity looks idle", () => {
    const view = deriveSyncChipView(
      'signed-in',
      {
        userId: USER_ID,
        activity: 'idle',
        pendingCount: 1,
        lastSyncedAt: Date.now(),
        lastErrorMessage: null,
        offline: false,
        needsMerge: false,
        postponed: false,
      },
    );
    // Before the fix this fell through every branch to `{ state: 'synced' }`.
    expect(view?.state).not.toBe('synced');
    expect(view?.state).toBe('queued');
  });

  it('end-to-end: after a cycle with a rejection, the chip reflects the rejection truthfully, not "Synced"', async () => {
    markResolved();
    store.addEntry({ name: 'Will be rejected', grams: 1, kcal: 1, protein: 1, carbs: 1, fat: 1, meal: 'snack', source: 'manual' }, '2030-01-01');
    const rejectedId = Object.values(store.getState().days)[0]?.entries[0]?.id ?? '';

    vi.spyOn(client, 'push').mockResolvedValue({
      serverState: { profile: null, settings: null, entries: null, weights: null, customFoods: null, favourites: null },
      applied: { profile: null, settings: null, entries: [], weights: [], customFoods: [], favourites: [] },
      rejected: { entries: [], weights: [{ id: rejectedId, reason: 'duplicate_day' }], customFoods: [], favourites: [] },
    });
    vi.spyOn(client, 'pull').mockResolvedValue({
      cursor: { profile: null, settings: null, entries: null, weights: null, customFoods: null, favourites: null },
      hasMore: { entries: false, weights: false, customFoods: false, favourites: false },
      profile: null,
      settings: null,
      entries: [],
      weights: [],
      customFoods: [],
      favourites: [],
      counts: { entries: { total: 0, days: 0, firstDay: null, lastDay: null }, weights: { total: 0 }, customFoods: { total: 0 }, favourites: { total: 0 }, lastChangeAt: null },
    });

    syncEngine.start(USER_ID);
    await syncEngine.syncNow();

    const view = deriveSyncChipView('signed-in', syncEngine.getState());
    expect(view?.state).not.toBe('synced');
    expect(view?.text.toLowerCase()).not.toContain('synced');
  });
});
