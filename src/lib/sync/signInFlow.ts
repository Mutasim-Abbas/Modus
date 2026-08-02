import { store } from '@/lib/store';
import * as client from '@/lib/sync/client';
import { applyPushResultToAcked } from '@/lib/sync/diff';
import { computeLocalCounts, hasLocalData, hasRemoteData, resolveKeepAccountOnly, resolveKeepDeviceOnly } from '@/lib/sync/adoption';
import { loadAccountSyncState, saveAccountSyncState } from '@/lib/sync/persist';
import type { TableCounts } from '@/lib/sync/types';

/**
 * The one-shot check that runs the instant a device finishes signing in
 * (docs/DESIGN.md §7.11, "Trigger"). Deliberately NOT tied to the background
 * `src/lib/sync/engine.ts` (which only starts once this has resolved) and deliberately
 * NOT a React context — `SignInScreen`/`RecoveryCodeScreen` render outside `<AppShell>`
 * (docs/DESIGN.md §7.9), so this has to work as a plain function callable from
 * anywhere, exactly like `src/lib/store.ts` itself.
 *
 * "Local-only -> silent upload with a toast. Account-only -> silent download with a
 * toast. Neither -> nothing." Both non-empty is the only case that needs a decision —
 * that one returns `needs-merge` and changes nothing, so `/sync/merge` (which redoes
 * its own fresh pull on mount) is the only place a destructive or merging write happens.
 */
export type AdoptionOutcome =
  | { kind: 'none' }
  | { kind: 'silent-upload'; counts: TableCounts }
  | { kind: 'silent-download'; counts: TableCounts }
  | { kind: 'needs-merge' };

export async function runPostSignInAdoption(userId: string): Promise<AdoptionOutcome> {
  const existing = loadAccountSyncState(userId);
  if (existing.resolved) return { kind: 'none' };

  // A full pull (cursor omitted) — the only way to see everything the account has, and
  // the only way to build an accurate local-vs-remote comparison.
  const result = await client.pull(null);
  const localCounts = computeLocalCounts(store.getState());
  const localHasData = hasLocalData(localCounts);
  const remoteHasData = hasRemoteData(result.counts);

  if (!localHasData && !remoteHasData) {
    saveAccountSyncState(userId, { ...existing, pullCursor: result.cursor, resolved: true, lastSyncedAt: Date.now() });
    return { kind: 'none' };
  }

  if (localHasData && !remoteHasData) {
    const plan = resolveKeepDeviceOnly(store.getState(), result);
    const pushResult = await client.push(plan.pushBody);
    let next = applyPushResultToAcked(existing, plan.manifest, pushResult);
    // Confirming pull to obtain the authoritative post-write cursor — never adopt
    // `pushResult.serverState` for this (the internal security audit F-03).
    const confirm = await client.pull(null);
    next = { ...next, pullCursor: confirm.cursor, resolved: true, lastSyncedAt: Date.now() };
    saveAccountSyncState(userId, next);
    return { kind: 'silent-upload', counts: localCounts };
  }

  if (!localHasData && remoteHasData) {
    const plan = resolveKeepAccountOnly(store.getState(), result);
    store.replaceSyncedState(plan.localPatch);
    saveAccountSyncState(userId, {
      ...existing,
      pullCursor: result.cursor,
      resolved: true,
      lastSyncedAt: Date.now(),
      profileSnapshot: plan.localPatch.profile ?? existing.profileSnapshot,
      settingsSnapshot: plan.localPatch.settings ?? existing.settingsSnapshot,
    });
    return { kind: 'silent-download', counts: result.counts };
  }

  return { kind: 'needs-merge' };
}
