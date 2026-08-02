import { describe, expect, it } from 'vitest';
import { createStore, defaultState } from '@/lib/store';
import { mergeEntries, mergeFavourites, mergeWeights } from '@/lib/sync/applyRemote';
import type { RemoteEntry, RemoteFavourite, RemoteWeight } from '@/lib/sync/types';

function remoteEntry(overrides: Partial<RemoteEntry>): RemoteEntry {
  return {
    id: 'e1',
    day: '2026-03-12',
    name: 'Remote food',
    grams: 100,
    kcal: 100,
    protein: 10,
    carbs: 10,
    fat: 1,
    meal: 'lunch',
    source: 'manual',
    foodId: null,
    loggedAt: 1,
    updatedAt: 1000,
    deletedAt: null,
    ...overrides,
  };
}

describe('mergeEntries — last-write-wins by id', () => {
  it('a local-only entry (never seen by the remote) is left untouched, and is NOT reported as applied', () => {
    const store = createStore(defaultState());
    const local = store.addEntry(
      { name: 'Local only', grams: 1, kcal: 1, protein: 1, carbs: 1, fat: 1, meal: 'snack', source: 'manual' },
      '2026-03-12',
    );
    const { days, applied } = mergeEntries(store.getState(), []);
    expect(days['2026-03-12']?.entries).toHaveLength(1);
    expect(days['2026-03-12']?.entries[0]?.id).toBe(local.id);
    expect(applied).toHaveLength(0);
  });

  it('a remote row newer than the local copy overwrites it, and IS reported as applied (F-16)', () => {
    const store = createStore(defaultState());
    const local = store.addEntry(
      { name: 'Old name', grams: 1, kcal: 1, protein: 1, carbs: 1, fat: 1, meal: 'snack', source: 'manual' },
      '2026-03-12',
    );
    const remoteUpdatedAt = local.updatedAt + 1000;
    const { days, applied } = mergeEntries(
      store.getState(),
      [remoteEntry({ id: local.id, day: '2026-03-12', name: 'New name from server', updatedAt: remoteUpdatedAt })],
    );
    expect(days['2026-03-12']?.entries[0]?.name).toBe('New name from server');
    // The guard against over-acking (the internal security audit F-16): the applied row's
    // updatedAt is the REMOTE value now sitting in the local row, not the old local one.
    expect(applied).toEqual([{ key: local.id, updatedAt: remoteUpdatedAt }]);
  });

  it('a local edit newer than the remote row is kept, not overwritten, and is NOT reported as applied (the over-ack guard)', () => {
    const store = createStore(defaultState());
    const local = store.addEntry(
      { name: 'Freshly edited locally', grams: 1, kcal: 1, protein: 1, carbs: 1, fat: 1, meal: 'snack', source: 'manual' },
      '2026-03-12',
    );
    const { days, applied } = mergeEntries(
      store.getState(),
      [remoteEntry({ id: local.id, day: '2026-03-12', name: 'Stale server copy', updatedAt: local.updatedAt - 1000 })],
    );
    expect(days['2026-03-12']?.entries[0]?.name).toBe('Freshly edited locally');
    // If this were marked applied/acked, the genuinely-newer local edit would look
    // "already synced" and would never be pushed — a data-loss bug, not a fix.
    expect(applied).toHaveLength(0);
  });

  it('does not resurrect a delete: an OLDER remote tombstone never revives a newer local live row is the mirror image — the direct case is a newer remote tombstone winning over a stale local live copy', () => {
    const store = createStore(defaultState());
    const local = store.addEntry(
      { name: 'Will be deleted elsewhere', grams: 1, kcal: 1, protein: 1, carbs: 1, fat: 1, meal: 'snack', source: 'manual' },
      '2026-03-12',
    );
    const { days } = mergeEntries(
      store.getState(),
      [remoteEntry({ id: local.id, day: '2026-03-12', updatedAt: local.updatedAt + 1000, deletedAt: local.updatedAt + 1000 })],
    );
    expect(days['2026-03-12']?.entries[0]?.deletedAt).not.toBeNull();
  });

  it('an OLDER remote tombstone does not resurrect-delete a NEWER local live edit (legitimate restore)', () => {
    const store = createStore(defaultState());
    const local = store.addEntry(
      { name: 'Restored locally after being deleted elsewhere', grams: 1, kcal: 1, protein: 1, carbs: 1, fat: 1, meal: 'snack', source: 'manual' },
      '2026-03-12',
    );
    const { days } = mergeEntries(
      store.getState(),
      [remoteEntry({ id: local.id, day: '2026-03-12', updatedAt: local.updatedAt - 1000, deletedAt: local.updatedAt - 1000 })],
    );
    expect(days['2026-03-12']?.entries[0]?.deletedAt).toBeNull();
  });

  it('a genuinely newer remote tombstone deletes a row this device never even had a live copy of, without error', () => {
    const store = createStore(defaultState());
    const { days } = mergeEntries(store.getState(), [remoteEntry({ id: 'never-seen', updatedAt: 500, deletedAt: 500 })]);
    expect(days['2026-03-12']?.entries[0]?.deletedAt).not.toBeNull();
  });

  it('two independent offline edits to the SAME id converge deterministically to the newer one, no duplicates', () => {
    // Simulates the two-device scenario at the merge/apply layer: both "devices"
    // (local store + a remote row standing in for the other device's push) address
    // the exact same id, with different content and different `updatedAt`.
    const store = createStore(defaultState());
    const local = store.addEntry(
      { name: 'Device A version', grams: 100, kcal: 100, protein: 1, carbs: 1, fat: 1, meal: 'lunch', source: 'manual' },
      '2026-03-12',
    );
    const remote = remoteEntry({ id: local.id, day: '2026-03-12', name: 'Device B version', updatedAt: local.updatedAt + 5000 });
    const { days } = mergeEntries(store.getState(), [remote]);
    expect(days['2026-03-12']?.entries).toHaveLength(1); // no duplicate row
    expect(days['2026-03-12']?.entries[0]?.name).toBe('Device B version');
  });
});

describe('mergeWeights / mergeFavourites — the same LWW rule for flat arrays', () => {
  it('mergeWeights keeps a local-only weigh-in (not applied) and downloads a remote-only one (applied)', () => {
    const store = createStore(defaultState());
    const localWeight = store.logWeight(80, '2026-03-10');
    const remote: RemoteWeight = { id: 'w-remote', day: '2026-03-11', weightKg: 79.5, updatedAt: 500, deletedAt: null };
    const { rows, applied } = mergeWeights(store.getState().weights, [remote]);
    expect(rows).toHaveLength(2);
    expect(rows.some((w) => w.day === '2026-03-10')).toBe(true);
    expect(rows.some((w) => w.day === '2026-03-11' && w.weightKg === 79.5)).toBe(true);
    expect(applied).toEqual([{ key: 'w-remote', updatedAt: 500 }]);
    expect(applied.some((a) => a.key === localWeight.id)).toBe(false);
  });

  it('mergeFavourites resolves a toggle race by updatedAt, no duplicate rows, and reports the winning key as applied', () => {
    const local = [{ foodId: 'chicken-breast', updatedAt: 1000, deletedAt: null }];
    const remote: RemoteFavourite[] = [{ foodId: 'chicken-breast', updatedAt: 2000, deletedAt: 2000 }];
    const { rows, applied } = mergeFavourites(local, remote);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.deletedAt).toBe(2000);
    expect(applied).toEqual([{ key: 'chicken-breast', updatedAt: 2000 }]);
  });
});
