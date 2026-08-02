import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStore, defaultState } from '@/lib/store';
import type { AppState } from '@/types';
import { applyPushResultToAcked, buildOutbox, isOutboxEmpty } from '@/lib/sync/diff';
import { defaultAccountSyncState } from '@/lib/sync/persist';
import type { AccountSyncState } from '@/lib/sync/persist';
import type { PushResult } from '@/lib/sync/types';

function emptyPushResult(): PushResult {
  return {
    serverState: { profile: null, settings: null, entries: null, weights: null, customFoods: null, favourites: null },
    applied: { profile: null, settings: null, entries: [], weights: [], customFoods: [], favourites: [] },
    rejected: { entries: [], weights: [], customFoods: [], favourites: [] },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

/** A baseline sync state with `settings` already treated as synced, so tests that are
 *  really about entries/profile aren't tripped up by the (correct, separate) fact that
 *  a brand-new account's default settings are themselves pending upload once. */
function syncStateFor(state: AppState): AccountSyncState {
  return { ...defaultAccountSyncState(), settingsSnapshot: state.settings };
}

describe('buildOutbox', () => {
  it('is empty for a brand-new store with nothing acked and settings already synced', () => {
    const store = createStore(defaultState());
    const outbox = buildOutbox(store.getState(), syncStateFor(store.getState()));
    expect(isOutboxEmpty(outbox)).toBe(true);
    expect(outbox.pendingCount).toBe(0);
  });

  it('a brand-new account with no prior sync at all also uploads its default settings once', () => {
    const store = createStore(defaultState());
    const outbox = buildOutbox(store.getState(), defaultAccountSyncState());
    expect(outbox.body.settings).toMatchObject({ deleted: false, reducedMotion: false });
  });

  it('includes a newly logged entry, and stops including it once acked', () => {
    const store = createStore(defaultState());
    const entry = store.addEntry(
      { name: 'Chicken', grams: 150, kcal: 248, protein: 46, carbs: 0, fat: 5, meal: 'lunch', source: 'manual' },
      '2026-03-12',
    );

    const base = syncStateFor(store.getState());
    const outbox = buildOutbox(store.getState(), base);
    expect(outbox.body.entries).toHaveLength(1);
    expect(outbox.body.entries?.[0]).toMatchObject({ id: entry.id, deleted: false, day: '2026-03-12', name: 'Chicken' });

    const acked = applyPushResultToAcked(base, outbox.manifest, {
      ...emptyPushResult(),
      applied: { ...emptyPushResult().applied, entries: [{ id: entry.id, updatedAt: '2026-03-12T00:00:00.000Z', deletedAt: null }] },
    });

    const nextOutbox = buildOutbox(store.getState(), acked);
    expect(isOutboxEmpty(nextOutbox)).toBe(true);
  });

  it('re-includes a row after it is edited again post-ack', () => {
    const store = createStore(defaultState());
    const entry = store.addEntry(
      { name: 'Chicken', grams: 150, kcal: 248, protein: 46, carbs: 0, fat: 5, meal: 'lunch', source: 'manual' },
      '2026-03-12',
    );
    let sync = syncStateFor(store.getState());
    const firstOutbox = buildOutbox(store.getState(), sync);
    sync = applyPushResultToAcked(sync, firstOutbox.manifest, {
      ...emptyPushResult(),
      applied: { ...emptyPushResult().applied, entries: [{ id: entry.id, updatedAt: '2026-03-12T00:00:00.000Z', deletedAt: null }] },
    });
    expect(isOutboxEmpty(buildOutbox(store.getState(), sync))).toBe(true);

    // `updatedAt` is millisecond-resolution `Date.now()`; a real edit always has some
    // wall-clock gap after the row was acked, but this test's calls are otherwise back
    // to back — advance the clock so the edit is unambiguously "newer", not flaky on a
    // fast machine that happens to hit the exact same millisecond.
    vi.useFakeTimers();
    vi.advanceTimersByTime(5);
    store.updateEntry(entry.id, { grams: 200 }, '2026-03-12');
    vi.useRealTimers();

    const afterEdit = buildOutbox(store.getState(), sync);
    expect(isOutboxEmpty(afterEdit)).toBe(false);
    expect(afterEdit.body.entries?.[0]).toMatchObject({ grams: 200 });
  });

  it('sends a tombstone for a deleted entry, not its content', () => {
    const store = createStore(defaultState());
    const entry = store.addEntry(
      { name: 'Chicken', grams: 150, kcal: 248, protein: 46, carbs: 0, fat: 5, meal: 'lunch', source: 'manual' },
      '2026-03-12',
    );
    store.removeEntry(entry.id, '2026-03-12');

    const outbox = buildOutbox(store.getState(), syncStateFor(store.getState()));
    expect(outbox.body.entries).toEqual([{ id: entry.id, deleted: true }]);
  });

  it('caps each table at 500 rows per push, but pendingCount reports the true total', () => {
    const store = createStore(defaultState());
    for (let i = 0; i < 520; i++) {
      store.addEntry(
        { name: `Food ${i}`, grams: 100, kcal: 100, protein: 1, carbs: 1, fat: 1, meal: 'snack', source: 'manual' },
        '2026-03-12',
      );
    }
    const outbox = buildOutbox(store.getState(), syncStateFor(store.getState()));
    expect(outbox.body.entries).toHaveLength(500);
    expect(outbox.pendingCount).toBe(520);
  });

  it('only pushes the profile when it actually differs from the last-synced snapshot', () => {
    const store = createStore(defaultState());
    store.setProfile({ sex: 'male', age: 30, heightCm: 180, weightKg: 80, activity: 'moderate', goal: 'maintain' });

    const base = syncStateFor(store.getState());
    const firstOutbox = buildOutbox(store.getState(), base);
    expect(firstOutbox.body.profile).toMatchObject({ deleted: false, age: 30 });

    const syncedSync = { ...base, profileSnapshot: store.getState().profile };
    expect(isOutboxEmpty(buildOutbox(store.getState(), syncedSync))).toBe(true);
  });

  it('a rejected id is not acked and reappears in the next batch', () => {
    const store = createStore(defaultState());
    const entry = store.addEntry(
      { name: 'Chicken', grams: 150, kcal: 248, protein: 46, carbs: 0, fat: 5, meal: 'lunch', source: 'manual' },
      '2026-03-12',
    );
    const base = syncStateFor(store.getState());
    const outbox = buildOutbox(store.getState(), base);
    const acked = applyPushResultToAcked(base, outbox.manifest, {
      ...emptyPushResult(),
      rejected: { ...emptyPushResult().rejected, entries: [{ id: entry.id, reason: 'owner_conflict' }] },
    });
    expect(isOutboxEmpty(buildOutbox(store.getState(), acked))).toBe(false);
  });
});
