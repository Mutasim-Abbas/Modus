import { describe, expect, it } from 'vitest';
import { createStore, defaultState } from '@/lib/store';
import {
  computeLocalCounts,
  computeMergePreview,
  hasLocalData,
  hasRemoteData,
  resolveKeepAccountOnly,
  resolveKeepDeviceOnly,
  resolveMergeBoth,
} from '@/lib/sync/adoption';
import type { PullResult, RemoteEntry } from '@/lib/sync/types';

function remoteEntry(overrides: Partial<RemoteEntry>): RemoteEntry {
  return {
    id: 'r',
    day: '2026-03-12',
    name: 'Remote',
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
    ...overrides,
  };
}

function emptyPull(entries: RemoteEntry[] = []): PullResult {
  return {
    cursor: { profile: null, settings: null, entries: null, weights: null, customFoods: null, favourites: null },
    hasMore: { entries: false, weights: false, customFoods: false, favourites: false },
    profile: null,
    settings: null,
    entries,
    weights: [],
    customFoods: [],
    favourites: [],
    counts: {
      entries: { total: entries.filter((e) => e.deletedAt === null).length, days: 1, firstDay: '2026-03-12', lastDay: '2026-03-12' },
      weights: { total: 0 },
      customFoods: { total: 0 },
      favourites: { total: 0 },
      lastChangeAt: null,
    },
  };
}

/**
 * The scripted two-device offline->online scenario the acceptance criteria require:
 * "a deterministic result with no duplicates and no resurrected deletes."
 *
 * Device A (this local store, never yet synced) and device B (represented by the full
 * pull below, standing in for whatever device B already pushed) each have:
 *  - a row only they know about (an upload / a download),
 *  - one id edited on BOTH sides where A's edit is newer (A must win),
 *  - one id edited on BOTH sides where B's edit is newer (B must win),
 *  - one id A deleted (tombstoned locally, never synced) that B still has live, where
 *    A's delete is the newer action (the delete must win — and must not be silently
 *    "undone" merely because B's copy still exists).
 */
function buildTwoDeviceScenario() {
  const store = createStore(defaultState());
  const T = 1_000_000;

  store.addEntry(
    { name: 'A-only (upload)', grams: 1, kcal: 1, protein: 1, carbs: 1, fat: 1, meal: 'snack', source: 'manual' },
    '2026-03-12',
  );
  const localOnlyId = Object.values(store.getState().days)[0]?.entries[0]?.id ?? '';

  // conflict-a-wins: local edited AFTER the remote's version
  store.addEntry(
    { name: 'A version (newer)', grams: 2, kcal: 2, protein: 2, carbs: 2, fat: 2, meal: 'lunch', source: 'manual' },
    '2026-03-12',
  );
  const conflictAWinsEntries = Object.values(store.getState().days)[0]?.entries ?? [];
  const conflictAWinsId = conflictAWinsEntries[conflictAWinsEntries.length - 1]?.id ?? '';

  // conflict-b-wins: local edited BEFORE the remote's version — remote must win
  store.addEntry(
    { name: 'A version (stale)', grams: 3, kcal: 3, protein: 3, carbs: 3, fat: 3, meal: 'dinner', source: 'manual' },
    '2026-03-12',
  );
  const conflictBWinsEntries = Object.values(store.getState().days)[0]?.entries ?? [];
  const conflictBWinsId = conflictBWinsEntries[conflictBWinsEntries.length - 1]?.id ?? '';

  // A deletes something B still has live — A's delete must be the newer action.
  store.addEntry(
    { name: 'Deleted on A', grams: 4, kcal: 4, protein: 4, carbs: 4, fat: 4, meal: 'snack', source: 'manual' },
    '2026-03-12',
  );
  const deletedOnAEntries = Object.values(store.getState().days)[0]?.entries ?? [];
  const deletedOnAId = deletedOnAEntries[deletedOnAEntries.length - 1]?.id ?? '';
  store.removeEntry(deletedOnAId, '2026-03-12');

  const local = store.getState();
  const localConflictAWins = local.days['2026-03-12']?.entries.find((e) => e.id === conflictAWinsId);
  const localConflictBWins = local.days['2026-03-12']?.entries.find((e) => e.id === conflictBWinsId);
  const localDeletedOnA = local.days['2026-03-12']?.entries.find((e) => e.id === deletedOnAId);

  const remote = emptyPull([
    remoteEntry({ id: 'b-only-download', day: '2026-03-12', name: 'B-only (download)', updatedAt: T }),
    remoteEntry({
      id: conflictAWinsId,
      day: '2026-03-12',
      name: 'B version (older)',
      updatedAt: (localConflictAWins?.updatedAt ?? 0) - 5000,
    }),
    remoteEntry({
      id: conflictBWinsId,
      day: '2026-03-12',
      name: 'B version (newer)',
      updatedAt: (localConflictBWins?.updatedAt ?? 0) + 5000,
    }),
    remoteEntry({
      id: deletedOnAId,
      day: '2026-03-12',
      name: 'B still has this live',
      updatedAt: (localDeletedOnA?.updatedAt ?? 0) - 5000,
    }),
  ]);

  return { store, local, remote, localOnlyId, conflictAWinsId, conflictBWinsId, deletedOnAId };
}

describe('computeMergePreview', () => {
  it('classifies additions, conflicts and remote-only rows correctly, with real counts', () => {
    const { local, remote, localOnlyId, conflictAWinsId, conflictBWinsId, deletedOnAId } = buildTwoDeviceScenario();
    const preview = computeMergePreview(local, remote);

    expect(preview.deltas.entries.localOnlyLive).toContain(localOnlyId);
    expect(preview.deltas.entries.remoteOnlyLive).toContain('b-only-download');
    expect(preview.deltas.entries.conflictIds.sort()).toEqual([conflictAWinsId, conflictBWinsId, deletedOnAId].sort());

    const conflictAWins = preview.conflicts.find((c) => c.id === conflictAWinsId);
    const conflictBWins = preview.conflicts.find((c) => c.id === conflictBWinsId);
    expect(conflictAWins?.localWins).toBe(true);
    expect(conflictBWins?.localWins).toBe(false);

    expect(preview.local.entries.total).toBe(3); // localOnly + conflictAWins + conflictBWins (deletedOnA is a local tombstone, not live)
    expect(preview.remote.entries.total).toBe(4); // remote's own live count from `counts`
  });

  it('hasLocalData / hasRemoteData read the four-table `counts` shape (never profile/settings)', () => {
    expect(hasLocalData(computeLocalCounts(defaultState()))).toBe(false);
    const store = createStore(defaultState());
    store.addEntry({ name: 'X', grams: 1, kcal: 1, protein: 1, carbs: 1, fat: 1, meal: 'snack', source: 'manual' });
    expect(hasLocalData(computeLocalCounts(store.getState()))).toBe(true);
    expect(hasRemoteData(emptyPull().counts)).toBe(false);
  });
});

describe('resolveMergeBoth — the two-device offline->online determinism scenario', () => {
  it('produces exactly one row per id, no duplicates, and no resurrected deletes', () => {
    const { local, remote, localOnlyId, conflictAWinsId, conflictBWinsId, deletedOnAId } = buildTwoDeviceScenario();
    const preview = computeMergePreview(local, remote);
    const resolved = resolveMergeBoth(local, remote, preview);

    const finalEntries = Object.values(resolved.localPatch.days ?? {}).flatMap((d) => d.entries);
    const ids = finalEntries.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length); // no duplicates

    const byId = new Map(finalEntries.map((e) => [e.id, e]));
    expect(byId.get(localOnlyId)?.deletedAt).toBeNull();
    expect(byId.get('b-only-download')?.name).toBe('B-only (download)');
    expect(byId.get(conflictAWinsId)?.name).toBe('A version (newer)'); // A's newer edit kept
    expect(byId.get(conflictBWinsId)?.name).toBe('B version (newer)'); // B's newer edit adopted
    expect(byId.get(deletedOnAId)?.deletedAt).not.toBeNull(); // the newer delete wins — not resurrected

    // Only the LOCAL-winning rows go out to the server — B's row is never re-uploaded,
    // and the row A lost on is never pushed either.
    const pushedIds = (resolved.pushBody.entries ?? []).map((op) => op.id);
    expect(pushedIds).toContain(localOnlyId);
    expect(pushedIds).toContain(conflictAWinsId);
    expect(pushedIds).toContain(deletedOnAId);
    expect(pushedIds).not.toContain(conflictBWinsId);
    expect(pushedIds).not.toContain('b-only-download');
  });

  it('is deterministic — running it twice on the same inputs yields the identical result', () => {
    const { local, remote } = buildTwoDeviceScenario();
    const preview = computeMergePreview(local, remote);
    const first = resolveMergeBoth(local, remote, preview);
    const second = resolveMergeBoth(local, remote, preview);
    expect(first.localPatch).toEqual(second.localPatch);
    expect(first.pushBody).toEqual(second.pushBody);
  });
});

describe('resolveKeepDeviceOnly / resolveKeepAccountOnly — the exact deletion counts §7.11 requires', () => {
  it('keep-device-only tombstones every remote-only row and upserts every local live row; nothing is applied locally', () => {
    const { local, remote } = buildTwoDeviceScenario();
    const resolved = resolveKeepDeviceOnly(local, remote);
    expect(resolved.localPatch).toEqual({});

    const tombstoneOps = (resolved.pushBody.entries ?? []).filter((op) => op.deleted);
    expect(tombstoneOps.map((op) => op.id)).toContain('b-only-download');

    const liveOps = (resolved.pushBody.entries ?? []).filter((op) => !op.deleted);
    const localLiveCount = Object.values(local.days).flatMap((d) => d.entries).filter((e) => e.deletedAt === null).length;
    expect(liveOps).toHaveLength(localLiveCount);
  });

  it('keep-account-only adopts every remote row and drops every local-only row; nothing is pushed', () => {
    const { local, remote } = buildTwoDeviceScenario();
    const resolved = resolveKeepAccountOnly(local, remote);
    expect(resolved.pushBody).toEqual({});

    const finalEntries = Object.values(resolved.localPatch.days ?? {}).flatMap((d) => d.entries);
    const ids = finalEntries.map((e) => e.id);
    expect(ids).toContain('b-only-download');
    // A local-only row the account never saw is gone entirely after adopting the account.
    const preview = computeMergePreview(local, remote);
    for (const localOnlyId of preview.deltas.entries.localOnlyLive) {
      expect(ids).not.toContain(localOnlyId);
    }
  });
});
