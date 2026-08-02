import { AuthError } from '@/lib/authApi';
import * as client from '@/lib/sync/client';
import { applyPushResultToAcked, buildOutbox, foldRemoteAppliedIntoAcked, isOutboxEmpty } from '@/lib/sync/diff';
import type { RemoteApplied } from '@/lib/sync/diff';
import { mergeCustomFoods, mergeEntries, mergeFavourites, mergeWeights } from '@/lib/sync/applyRemote';
import { loadAccountSyncState, saveAccountSyncState, updateAccountSyncState } from '@/lib/sync/persist';
import type { AccountSyncState } from '@/lib/sync/persist';
import type { PullCursor, PullResult, PushResult, RemoteProfile, RemoteSettings, ServerStateWatermark } from '@/lib/sync/types';
import type { Profile, Settings } from '@/types';
import { store } from '@/lib/store';

/**
 * The background delta-sync engine: an offline-tolerant push/pull loop that runs while
 * an account is signed in and its adoption/merge has already been resolved
 * (`docs/DESIGN.md` §7.11 must run first — see `src/lib/sync/adoption.ts`).
 *
 * A module-level singleton with `subscribe`/`getState`, deliberately mirroring
 * `src/lib/store.ts`'s own shape — so `useSyncEngineState` (below) works from ANY
 * component with `useSyncExternalStore` and needs no React context/provider. This
 * matters for testing as much as for architecture: dozens of existing tests render
 * isolated screens wrapped only in `<AuthProvider>` (no `<AppShell>`), and a context
 * provider would either have to be threaded into all of them or silently do nothing —
 * a plain singleton sidesteps the question entirely, the same way `useAppState()`
 * already does for local data.
 *
 * 🚨 The one rule this file exists to enforce in code, not just in a comment: a saved
 * `pullCursor` is assigned ONLY from a `GET /api/sync/pull` response's `cursor` field —
 * see every `saveCursorFrom*` call below. `push()`'s `serverState` is read only to
 * decide "should I schedule a pull soon", never stored as a cursor.
 */

export type SyncActivity = 'idle' | 'syncing' | 'error';

export interface EngineState {
  userId: string | null;
  activity: SyncActivity;
  pendingCount: number;
  lastSyncedAt: number | null;
  lastErrorMessage: string | null;
  offline: boolean;
  /** The account's adoption/merge has not been resolved yet — the engine deliberately
   *  performs no network activity at all until it is (`docs/DESIGN.md` §7.11). */
  needsMerge: boolean;
  /** The user chose "Decide later" on the merge screen — sync stays paused. */
  postponed: boolean;
}

function idleState(): EngineState {
  return {
    userId: null,
    activity: 'idle',
    pendingCount: 0,
    lastSyncedAt: null,
    lastErrorMessage: null,
    offline: typeof navigator !== 'undefined' ? !navigator.onLine : false,
    needsMerge: false,
    postponed: false,
  };
}

type Listener = () => void;

class SyncEngine {
  private state: EngineState = idleState();
  private readonly listeners = new Set<Listener>();
  private unsubscribeStore: (() => void) | null = null;
  private onlineHandler: (() => void) | null = null;
  private offlineHandler: (() => void) | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private debounce: ReturnType<typeof setTimeout> | null = null;
  private syncing = false;
  private runId = 0;

  getState(): EngineState {
    return this.state;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private setState(patch: Partial<EngineState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }

  private recomputePendingCount(): void {
    if (!this.state.userId) return;
    const sync = loadAccountSyncState(this.state.userId);
    const outbox = buildOutbox(store.getState(), sync);
    this.setState({ pendingCount: outbox.pendingCount, needsMerge: !sync.resolved, postponed: sync.postponed });
  }

  /** Called once the adoption/merge screen has resolved for this account (or found
   *  nothing to merge) — enables the background loop for the given account. */
  start(userId: string): void {
    if (this.state.userId === userId) return;
    this.stop();

    const myRunId = ++this.runId;
    const sync = loadAccountSyncState(userId);
    this.setState({
      userId,
      activity: 'idle',
      pendingCount: 0,
      lastSyncedAt: sync.lastSyncedAt,
      lastErrorMessage: null,
      needsMerge: !sync.resolved,
      postponed: sync.postponed,
    });
    this.recomputePendingCount();

    this.unsubscribeStore = store.subscribe(() => {
      if (this.runId !== myRunId) return;
      this.recomputePendingCount();
      if (this.debounce) clearTimeout(this.debounce);
      this.debounce = setTimeout(() => void this.syncNow(), 1500);
    });

    if (typeof window !== 'undefined') {
      this.onlineHandler = () => {
        this.setState({ offline: false });
        void this.syncNow();
      };
      this.offlineHandler = () => this.setState({ offline: true });
      window.addEventListener('online', this.onlineHandler);
      window.addEventListener('offline', this.offlineHandler);
    }

    // A steady heartbeat pull so this device learns about other devices' changes even
    // when it isn't the one making local edits.
    this.heartbeat = setInterval(() => void this.syncNow(), 45_000);

    // Deliberately does NOT fire an initial `syncNow()` itself — the caller (normally
    // `AppShell`'s mount effect) triggers that explicitly, one line after `start()`.
    // Keeping the two separate makes `start()` a pure, synchronous state/listener setup
    // with no async side effect of its own, which is what lets a test call `start()`
    // then `await syncEngine.syncNow()` deterministically, with no risk of the two
    // colliding on the `syncing` mutex (both would otherwise race to be "the" initial
    // call, since JS only yields at the first `await` inside `syncNow()`).
  }

  /** Called on sign-out. Never touches `src/lib/store.ts` — only stops this engine's
   *  own timers/listeners. Sync bookkeeping (`fitmacro.sync.v1`) is left on disk so a
   *  later sign-in to the SAME account resumes without a redundant full pull. */
  stop(): void {
    this.runId++;
    if (this.unsubscribeStore) this.unsubscribeStore();
    this.unsubscribeStore = null;
    if (typeof window !== 'undefined') {
      if (this.onlineHandler) window.removeEventListener('online', this.onlineHandler);
      if (this.offlineHandler) window.removeEventListener('offline', this.offlineHandler);
    }
    this.onlineHandler = null;
    this.offlineHandler = null;
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = null;
    this.syncing = false;
    this.state = idleState();
    this.listeners.forEach((listener) => listener());
  }

  /** The core sync cycle. Exposed directly so tests can drive it without real timers. */
  async syncNow(): Promise<void> {
    const userId = this.state.userId;
    if (!userId || this.syncing) return;

    const online = typeof navigator === 'undefined' || navigator.onLine;
    if (!online) {
      this.recomputePendingCount();
      this.setState({ offline: true });
      return;
    }

    let sync = loadAccountSyncState(userId);
    if (!sync.resolved || sync.postponed) {
      this.setState({ needsMerge: !sync.resolved, postponed: sync.postponed, offline: false });
      this.recomputePendingCount();
      return;
    }

    this.syncing = true;
    this.setState({ activity: 'syncing', offline: false });

    // Set by a push whose response contains `rejected` rows (F-17): the cycle otherwise
    // completed, so it is not a network/auth `error` in the existing sense, but it is
    // NOT a clean success either — a rejected row is un-acked (by `applyPushResultToAcked`,
    // deliberately) and will be retried, and re-rejected, on every future cycle until
    // something changes. Reported truthfully rather than folded into "idle".
    let rejectionMessage: string | null = null;

    try {
      const outbox = buildOutbox(store.getState(), sync);

      if (!isOutboxEmpty(outbox)) {
        let pushResult: PushResult;
        try {
          pushResult = await client.push(outbox.body);
        } catch (cause) {
          // docs/API.md, "Atomicity": on a 500 (or a network failure) the outbox is
          // NEVER cleared — nothing here mutates `acked`/`pullCursor`, so the very next
          // call to `buildOutbox` reproduces this exact same batch.
          const message = cause instanceof AuthError ? cause.message : 'Network request failed.';
          this.setState({ activity: 'error', lastErrorMessage: message, pendingCount: outbox.pendingCount });
          return;
        }

        sync = applyPushResultToAcked(sync, outbox.manifest, pushResult);
        saveAccountSyncState(userId, sync);
        rejectionMessage = describeRejections(pushResult.rejected);

        // `serverState` is read ONLY to decide whether a pull is worth scheduling — it
        // is never assigned to `pullCursor` (the internal security audit F-03).
        if (isServerAheadOfCursor(pushResult.serverState, sync.pullCursor)) {
          const pulled = await this.pullAndMerge(userId, sync);
          // pullAndMerge already reported its own failure state — don't clobber it below.
          if (!pulled) return;
        } else {
          sync = updateAccountSyncState(userId, (prev) => ({ ...prev, lastSyncedAt: Date.now() }));
        }
      } else {
        const pulled = await this.pullAndMerge(userId, sync);
        if (!pulled) return;
      }

      const finalSync = loadAccountSyncState(userId);
      this.setState({
        activity: rejectionMessage ? 'error' : 'idle',
        lastErrorMessage: rejectionMessage,
        lastSyncedAt: finalSync.lastSyncedAt,
        pendingCount: buildOutbox(store.getState(), finalSync).pendingCount,
      });
    } finally {
      this.syncing = false;
    }
  }

  /** Returns `false` (having already reported an `error` state itself) on a network/auth
   *  failure, so `syncNow` knows not to overwrite that with a success state afterward. */
  private async pullAndMerge(userId: string, sync: AccountSyncState): Promise<boolean> {
    let result: PullResult;
    try {
      // Always the SAVED pull cursor — never `serverState` (F-03).
      result = await client.pull(sync.pullCursor);
    } catch (cause) {
      const message = cause instanceof AuthError ? cause.message : 'Network request failed.';
      this.setState({ activity: 'error', lastErrorMessage: message });
      return false;
    }

    const applied = applyIncrementalPull(sync, result);

    updateAccountSyncState(userId, (prev) => ({
      ...prev,
      // Only a pull response may advance the cursor.
      pullCursor: result.cursor,
      lastSyncedAt: Date.now(),
      profileSnapshot: result.profile ? toLocalProfile(result.profile) : prev.profileSnapshot,
      settingsSnapshot: result.settings ? toLocalSettings(result.settings) : prev.settingsSnapshot,
      // F-16: every row this pull just wrote into the local store because the REMOTE
      // side won must be acked using ITS OWN `updatedAt` — in this SAME transaction that
      // advances `pullCursor`, so the two can never observably drift apart. A row where
      // the LOCAL copy won is absent from `applied` by construction (see
      // `src/lib/sync/applyRemote.ts`), so it is never acked here and still gets pushed.
      acked: foldRemoteAppliedIntoAcked(prev.acked, applied),
    }));
    return true;
  }
}

/** F-17: a human-readable, honest description of a push's `rejected` rows — never
 *  silently dropped into "idle". `duplicate_day` only ever appears on `weights`
 *  (docs/API.md); `owner_conflict` is deliberately vague everywhere it appears, so this
 *  stays vague too rather than inventing detail the server never gave it. */
function describeRejections(rejected: PushResult['rejected']): string | null {
  const total = rejected.entries.length + rejected.weights.length + rejected.customFoods.length;
  if (total === 0) return null;

  const onlyDuplicateDay =
    rejected.entries.length === 0 &&
    rejected.customFoods.length === 0 &&
    rejected.weights.length > 0 &&
    rejected.weights.every((row) => row.reason === 'duplicate_day');

  if (onlyDuplicateDay) {
    return rejected.weights.length === 1
      ? "A weight entry couldn't be saved — another device already logged a weight for that day."
      : `${rejected.weights.length} weight entries couldn't be saved — another device already logged a weight for those days.`;
  }

  const noun = total === 1 ? 'change' : 'changes';
  return `${total} ${noun} couldn't be saved to your account. They stay on this device and will keep retrying.`;
}

function isServerAheadOfCursor(serverState: ServerStateWatermark, cursor: PullCursor | null): boolean {
  if (!cursor) return true;
  const aheadSingleton = (a: string | null, b: string | null): boolean => (a ?? '') > (b ?? '');
  const aheadRow = (
    a: { updatedAt: string; id: string } | null,
    b: { updatedAt: string; id: string } | null,
  ): boolean => {
    if (!a) return false;
    if (!b) return true;
    return a.updatedAt > b.updatedAt || (a.updatedAt === b.updatedAt && a.id > b.id);
  };
  return (
    aheadSingleton(serverState.profile, cursor.profile) ||
    aheadSingleton(serverState.settings, cursor.settings) ||
    aheadRow(serverState.entries, cursor.entries) ||
    aheadRow(serverState.weights, cursor.weights) ||
    aheadRow(serverState.customFoods, cursor.customFoods) ||
    aheadRow(serverState.favourites, cursor.favourites)
  );
}

function toLocalProfile(remote: RemoteProfile): Profile {
  const activities = ['sedentary', 'light', 'moderate', 'very', 'extra'] as const;
  const goals = ['cut', 'maintain', 'bulk'] as const;
  return {
    sex: remote.sex === 'female' ? 'female' : 'male',
    age: remote.age,
    heightCm: remote.heightCm,
    weightKg: remote.weightKg,
    activity: (activities as readonly string[]).includes(remote.activity) ? (remote.activity as Profile['activity']) : 'sedentary',
    goal: (goals as readonly string[]).includes(remote.goal) ? (remote.goal as Profile['goal']) : 'maintain',
  };
}

function toLocalSettings(remote: RemoteSettings): Settings {
  return { units: 'metric', reducedMotion: remote.reducedMotion };
}

/**
 * Applies one incremental (delta or full) pull to the local store during steady-state
 * background sync. Profile/settings are only overwritten when local hasn't diverged
 * from the last-known-synced snapshot — an un-pushed local edit is never silently
 * clobbered by a newer server value; it is left to go out on the next push instead.
 *
 * Returns which rows the REMOTE side won for (the internal security audit F-16) — the
 * caller is responsible for folding this into `AccountSyncState.acked` in the same
 * transaction that advances `pullCursor`, via `foldRemoteAppliedIntoAcked`. This
 * function only ever WRITES the store; it never touches sync bookkeeping itself, so it
 * stays the same "pure-ish, one job" shape it had before this fix.
 */
function applyIncrementalPull(sync: AccountSyncState, result: PullResult): RemoteApplied {
  const state = store.getState();
  const entriesResult = mergeEntries(state, result.entries);
  const weightsResult = mergeWeights(state.weights, result.weights);
  const customFoodsResult = mergeCustomFoods(state.customFoods, result.customFoods);
  const favouritesResult = mergeFavourites(state.favourites, result.favourites);

  let profile = state.profile;
  if (result.profile && profilesEqual(state.profile, sync.profileSnapshot)) {
    profile = toLocalProfile(result.profile);
  }

  let settings = state.settings;
  if (result.settings && settingsEqual(state.settings, sync.settingsSnapshot)) {
    settings = toLocalSettings(result.settings);
  }

  store.replaceSyncedState({
    days: entriesResult.days,
    weights: weightsResult.rows,
    customFoods: customFoodsResult.rows,
    favourites: favouritesResult.rows,
    profile,
    settings,
  });

  return {
    entries: entriesResult.applied,
    weights: weightsResult.applied,
    customFoods: customFoodsResult.applied,
    favourites: favouritesResult.applied,
  };
}

function profilesEqual(a: Profile | null, b: Profile | null): boolean {
  if (a === null || b === null) return a === b;
  return a.sex === b.sex && a.age === b.age && a.heightCm === b.heightCm && a.weightKg === b.weightKg && a.activity === b.activity && a.goal === b.goal;
}

function settingsEqual(a: Settings | null, b: Settings | null): boolean {
  if (a === null || b === null) return a === b;
  return a.units === b.units && a.reducedMotion === b.reducedMotion;
}

/** The one shared engine instance. Tests construct their own isolated behaviour by
 *  resetting `src/lib/sync/persist.ts`'s storage and calling `syncEngine.start`/`stop`
 *  directly rather than needing a second engine class. */
export const syncEngine = new SyncEngine();
