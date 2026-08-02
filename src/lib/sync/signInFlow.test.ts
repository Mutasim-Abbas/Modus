import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { store } from '@/lib/store';
import * as client from '@/lib/sync/client';
import { runPostSignInAdoption } from '@/lib/sync/signInFlow';
import { loadAccountSyncState } from '@/lib/sync/persist';
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

beforeEach(() => {
  localStorage.clear();
  store.reset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('runPostSignInAdoption', () => {
  it('neither side has data: resolves quietly, no push, nothing changes locally', async () => {
    vi.spyOn(client, 'pull').mockResolvedValue(emptyPull());
    const pushSpy = vi.spyOn(client, 'push');

    const outcome = await runPostSignInAdoption(USER_ID);

    expect(outcome).toEqual({ kind: 'none' });
    expect(pushSpy).not.toHaveBeenCalled();
    expect(loadAccountSyncState(USER_ID).resolved).toBe(true);
  });

  it('local-only: silently uploads everything, marks resolved, never shows the merge screen', async () => {
    store.addEntry({ name: 'Local food', grams: 1, kcal: 1, protein: 1, carbs: 1, fat: 1, meal: 'snack', source: 'manual' });
    vi.spyOn(client, 'pull').mockResolvedValue(emptyPull());
    const pushSpy = vi.spyOn(client, 'push').mockResolvedValue(emptyPush());

    const outcome = await runPostSignInAdoption(USER_ID);

    expect(outcome.kind).toBe('silent-upload');
    expect(pushSpy).toHaveBeenCalled();
    const body = pushSpy.mock.calls[0]?.[0];
    expect(body?.entries).toHaveLength(1);
    expect(loadAccountSyncState(USER_ID).resolved).toBe(true);

    // Local data is completely untouched by an upload.
    const entries = Object.values(store.getState().days).flatMap((d) => d.entries);
    expect(entries).toHaveLength(1);
  });

  it('account-only: silently downloads everything into the local store, never pushes', async () => {
    const remoteResult: PullResult = {
      ...emptyPull(),
      entries: [
        {
          id: 'remote-1',
          day: '2026-03-12',
          name: 'From the account',
          grams: 100,
          kcal: 100,
          protein: 1,
          carbs: 1,
          fat: 1,
          meal: 'lunch',
          source: 'manual',
          foodId: null,
          loggedAt: 1,
          updatedAt: 1000,
          deletedAt: null,
        },
      ],
      counts: { ...emptyPull().counts, entries: { total: 1, days: 1, firstDay: '2026-03-12', lastDay: '2026-03-12' } },
    };
    vi.spyOn(client, 'pull').mockResolvedValue(remoteResult);
    const pushSpy = vi.spyOn(client, 'push');

    const outcome = await runPostSignInAdoption(USER_ID);

    expect(outcome.kind).toBe('silent-download');
    expect(pushSpy).not.toHaveBeenCalled();
    expect(store.getState().days['2026-03-12']?.entries[0]?.name).toBe('From the account');
    expect(loadAccountSyncState(USER_ID).resolved).toBe(true);
  });

  it('both non-empty: changes NOTHING and returns needs-merge — the only path that pushes or applies anything is /sync/merge', async () => {
    store.addEntry({ name: 'Local food', grams: 1, kcal: 1, protein: 1, carbs: 1, fat: 1, meal: 'snack', source: 'manual' });
    const remoteResult: PullResult = {
      ...emptyPull(),
      entries: [
        {
          id: 'remote-1',
          day: '2026-03-12',
          name: 'Account food',
          grams: 1,
          kcal: 1,
          protein: 1,
          carbs: 1,
          fat: 1,
          meal: 'lunch',
          source: 'manual',
          foodId: null,
          loggedAt: 1,
          updatedAt: 1000,
          deletedAt: null,
        },
      ],
      counts: { ...emptyPull().counts, entries: { total: 1, days: 1, firstDay: '2026-03-12', lastDay: '2026-03-12' } },
    };
    vi.spyOn(client, 'pull').mockResolvedValue(remoteResult);
    const pushSpy = vi.spyOn(client, 'push');
    const before = store.getState();

    const outcome = await runPostSignInAdoption(USER_ID);

    expect(outcome).toEqual({ kind: 'needs-merge' });
    expect(pushSpy).not.toHaveBeenCalled();
    expect(store.getState()).toBe(before); // byte-identical — nothing was applied
    expect(loadAccountSyncState(USER_ID).resolved).toBe(false);
  });

  it('is a no-op if already resolved for this account (does not re-pull every sign-in)', async () => {
    const { saveAccountSyncState, defaultAccountSyncState } = await import('@/lib/sync/persist');
    saveAccountSyncState(USER_ID, { ...defaultAccountSyncState(), resolved: true });
    const pullSpy = vi.spyOn(client, 'pull');

    const outcome = await runPostSignInAdoption(USER_ID);

    expect(outcome).toEqual({ kind: 'none' });
    expect(pullSpy).not.toHaveBeenCalled();
  });
});
