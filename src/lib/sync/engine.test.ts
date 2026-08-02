import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { store, loadState } from '@/lib/store';
import * as client from '@/lib/sync/client';
import { syncEngine } from '@/lib/sync/engine';
import { loadAccountSyncState, saveAccountSyncState, defaultAccountSyncState } from '@/lib/sync/persist';
import { buildOutbox, isOutboxEmpty } from '@/lib/sync/diff';
import type { PullResult, PushResult } from '@/lib/sync/types';

const USER_ID = 'user-1';

function emptyPull(): PullResult {
  return {
    cursor: { profile: null, settings: null, entries: null, weights: null, customFoods: null, favourites: null },
    hasMore: { entries: false, weights: false, customFoods: false, favourites: false },
    profile: null,
    settings: null,
    entries: [],
    weights: [],
    customFoods: [],
    favourites: [],
    counts: { entries: { total: 0, days: 0, firstDay: null, lastDay: null }, weights: { total: 0 }, customFoods: { total: 0 }, favourites: { total: 0 }, lastChangeAt: null },
  };
}

function emptyPush(): PushResult {
  return {
    serverState: { profile: null, settings: null, entries: null, weights: null, customFoods: null, favourites: null },
    applied: { profile: null, settings: null, entries: [], weights: [], customFoods: [], favourites: [] },
    rejected: { entries: [], weights: [], customFoods: [], favourites: [] },
  };
}

function markResolved(): void {
  saveAccountSyncState(USER_ID, { ...defaultAccountSyncState(), resolved: true, settingsSnapshot: store.getState().settings });
}

beforeEach(() => {
  localStorage.clear();
  store.reset();
});

afterEach(() => {
  syncEngine.stop();
  vi.restoreAllMocks();
});

describe('syncEngine — the background loop', () => {
  it('does nothing until the account has resolved its adoption/merge (never syncs pre-merge)', async () => {
    const pushSpy = vi.spyOn(client, 'push');
    const pullSpy = vi.spyOn(client, 'pull');
    store.addEntry({ name: 'X', grams: 1, kcal: 1, protein: 1, carbs: 1, fat: 1, meal: 'snack', source: 'manual' });

    syncEngine.start(USER_ID); // resolved: false by default
    await syncEngine.syncNow();

    expect(pushSpy).not.toHaveBeenCalled();
    expect(pullSpy).not.toHaveBeenCalled();
    expect(syncEngine.getState().needsMerge).toBe(true);
  });

  it('a postponed merge keeps the engine paused — no push, no pull', async () => {
    saveAccountSyncState(USER_ID, { ...defaultAccountSyncState(), resolved: false, postponed: true });
    const pushSpy = vi.spyOn(client, 'push');
    const pullSpy = vi.spyOn(client, 'pull');

    syncEngine.start(USER_ID);
    await syncEngine.syncNow();

    expect(pushSpy).not.toHaveBeenCalled();
    expect(pullSpy).not.toHaveBeenCalled();
    expect(syncEngine.getState().postponed).toBe(true);
  });

  it('degrades to offline/queued without blocking logging when navigator.onLine is false', async () => {
    markResolved();
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    const pushSpy = vi.spyOn(client, 'push');

    syncEngine.start(USER_ID);
    // Logging still works instantly, regardless of connectivity.
    const entry = store.addEntry({ name: 'Offline entry', grams: 1, kcal: 1, protein: 1, carbs: 1, fat: 1, meal: 'snack', source: 'manual' });
    expect(store.getState().days[Object.keys(store.getState().days)[0] ?? '']?.entries.some((e) => e.id === entry.id)).toBe(true);

    await syncEngine.syncNow();

    expect(pushSpy).not.toHaveBeenCalled();
    expect(syncEngine.getState().offline).toBe(true);
    expect(syncEngine.getState().pendingCount).toBeGreaterThan(0);
  });

  it('on a 500 (or network failure), the outbox is never cleared — the identical batch is retried', async () => {
    markResolved();
    store.addEntry({ name: 'Will fail then succeed', grams: 100, kcal: 100, protein: 1, carbs: 1, fat: 1, meal: 'lunch', source: 'manual' });

    const pushSpy = vi.spyOn(client, 'push').mockRejectedValueOnce(new Error('server_error'));
    syncEngine.start(USER_ID);
    await syncEngine.syncNow();

    expect(syncEngine.getState().activity).toBe('error');
    const firstAttemptBody = pushSpy.mock.calls[0]?.[0];
    expect(firstAttemptBody?.entries).toHaveLength(1);
    // Nothing acked — the entry is still pending.
    expect(syncEngine.getState().pendingCount).toBeGreaterThan(0);

    pushSpy.mockResolvedValueOnce({
      ...emptyPush(),
      applied: { ...emptyPush().applied, entries: [{ id: firstAttemptBody?.entries?.[0]?.id ?? '', updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null }] },
    });
    vi.spyOn(client, 'pull').mockResolvedValue(emptyPull());

    await syncEngine.syncNow();

    const secondAttemptBody = pushSpy.mock.calls[1]?.[0];
    // The identical batch — same row, same content — was retried.
    expect(secondAttemptBody).toEqual(firstAttemptBody);
    expect(syncEngine.getState().activity).toBe('idle');
    expect(syncEngine.getState().pendingCount).toBe(0);
  });

  it('a successful push followed by a stale serverState still pulls with the SAVED cursor, never serverState (F-03, engine level)', async () => {
    markResolved();
    store.addEntry({ name: 'A', grams: 1, kcal: 1, protein: 1, carbs: 1, fat: 1, meal: 'snack', source: 'manual' });

    const pushSpy = vi.spyOn(client, 'push').mockResolvedValue({
      ...emptyPush(),
      serverState: { ...emptyPush().serverState, entries: { updatedAt: '2099-01-01T00:00:00.000Z', id: 'far-future-row-from-another-device' } },
      applied: { ...emptyPush().applied, entries: [{ id: 'placeholder', updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null }] },
    });
    const pullSpy = vi.spyOn(client, 'pull').mockResolvedValue(emptyPull());

    syncEngine.start(USER_ID);
    await syncEngine.syncNow();

    expect(pushSpy).toHaveBeenCalled();
    // Because serverState looked "ahead", a pull was scheduled — but it must be called
    // with this device's own saved cursor (null, first sync), never the serverState value.
    expect(pullSpy).toHaveBeenCalledWith(null);
    expect(loadAccountSyncState(USER_ID).pullCursor).not.toEqual({
      profile: null,
      settings: null,
      entries: { updatedAt: '2099-01-01T00:00:00.000Z', id: 'far-future-row-from-another-device' },
      weights: null,
      customFoods: null,
      favourites: null,
    });
  });

  it('an incremental pull downloads a tombstone without resurrecting anything, and adds a brand-new row', async () => {
    markResolved();
    vi.spyOn(client, 'push').mockResolvedValue(emptyPush());
    vi.spyOn(client, 'pull').mockResolvedValue({
      ...emptyPull(),
      cursor: { ...emptyPull().cursor, entries: { updatedAt: '2026-01-01T00:00:00.000Z', id: 'new-remote-row' } },
      entries: [
        {
          id: 'new-remote-row',
          day: '2026-01-01',
          name: 'From another device',
          grams: 50,
          kcal: 50,
          protein: 5,
          carbs: 5,
          fat: 1,
          meal: 'breakfast',
          source: 'manual',
          foodId: null,
          loggedAt: 1,
          updatedAt: 1000,
          deletedAt: null,
        },
      ],
    });

    syncEngine.start(USER_ID);
    await syncEngine.syncNow();

    const days = store.getState().days;
    expect(days['2026-01-01']?.entries.some((e) => e.id === 'new-remote-row' && e.deletedAt === null)).toBe(true);
    expect(loadAccountSyncState(USER_ID).pullCursor?.entries).toEqual({ updatedAt: '2026-01-01T00:00:00.000Z', id: 'new-remote-row' });
  });

  it('sign-in (start) and sign-out (stop) never touch local store content, in either direction', async () => {
    const entry = store.addEntry({ name: 'Pre-existing local data', grams: 1, kcal: 1, protein: 1, carbs: 1, fat: 1, meal: 'snack', source: 'manual' });
    const beforeStart = store.getState();

    markResolved();
    syncEngine.start(USER_ID);
    expect(store.getState()).toBe(beforeStart); // start() itself performs no store write

    vi.spyOn(client, 'push').mockResolvedValue(emptyPush());
    vi.spyOn(client, 'pull').mockResolvedValue(emptyPull());
    await syncEngine.syncNow();

    // The local entry survives sync activity (an empty remote does not erase local data).
    const afterSync = store.getState();
    const day = Object.values(afterSync.days).find((d) => d.entries.some((e) => e.id === entry.id));
    expect(day?.entries.some((e) => e.id === entry.id && e.deletedAt === null)).toBe(true);

    syncEngine.stop();
    // stop() never touches the store either.
    const day2 = Object.values(store.getState().days).find((d) => d.entries.some((e) => e.id === entry.id));
    expect(day2?.entries.some((e) => e.id === entry.id && e.deletedAt === null)).toBe(true);
  });

  it('the outbox survives a genuine reload — a fresh store and fresh sync state read back from disk reproduce it exactly', () => {
    // A push never happened yet — simulate a user logging something, then closing the
    // tab before any sync attempt completes.
    const entry = store.addEntry(
      { name: 'Logged just before a refresh', grams: 120, kcal: 200, protein: 20, carbs: 5, fat: 8, meal: 'dinner', source: 'manual' },
      '2026-03-12',
    );
    const outboxBefore = buildOutbox(store.getState(), loadAccountSyncState(USER_ID));
    expect(isOutboxEmpty(outboxBefore)).toBe(false);

    // "Reload": nothing in memory carries over — reconstruct both the local store and
    // the sync bookkeeping purely from what's on disk (`loadState()` /
    // `loadAccountSyncState()`, exactly what a fresh page load calls).
    const reloadedState = loadState();
    const reloadedSync = loadAccountSyncState(USER_ID);
    const outboxAfterReload = buildOutbox(reloadedState, reloadedSync);

    expect(isOutboxEmpty(outboxAfterReload)).toBe(false);
    expect(outboxAfterReload.body.entries).toEqual(outboxBefore.body.entries);
    expect(outboxAfterReload.body.entries?.[0]?.id).toBe(entry.id);
  });
});
