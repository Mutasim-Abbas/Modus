import type { AuthStatus } from '@/features/auth/AuthContext';
import type { EngineState } from '@/lib/sync/engine';
import { formatRelativeTime } from '@/lib/sync/relativeTime';

/** The six states docs/DESIGN.md §7.10 specifies for `SyncChip`, plus `null` meaning
 *  "render nothing at all" (the `unconfigured` row's own instruction). */
export type SyncChipView =
  | { state: 'guest'; text: string }
  | { state: 'synced'; text: string }
  | { state: 'syncing'; text: string }
  | { state: 'queued'; text: string; resumeHref?: string }
  | { state: 'error'; text: string }
  | null;

/**
 * Pure derivation so the six states (and the "chip not rendered at all" unconfigured
 * row) can be unit-tested without mounting anything. `docs/DESIGN.md` §7.10 doesn't
 * spell out copy for "adoption not yet resolved / postponed" specifically — the merge
 * screen is the only place that state is drawn in full — so this treats it as a
 * `queued`-shaped state with a link back to `/sync/merge`, which is the honest, closest
 * fit rather than inventing a seventh chip state. Noted as a judgment call in the Task 6
 * report.
 */
export function deriveSyncChipView(authStatus: AuthStatus, engine: EngineState, now: number = Date.now()): SyncChipView {
  if (authStatus === 'unconfigured') return null;
  if (authStatus !== 'signed-in') return { state: 'guest', text: 'On this device only' };

  if (engine.postponed || engine.needsMerge) {
    return { state: 'queued', text: "Sync paused — finish combining your data", resumeHref: '/sync/merge' };
  }
  if (engine.activity === 'syncing') return { state: 'syncing', text: 'Syncing…' };
  if (engine.offline) {
    return {
      state: 'queued',
      text: engine.pendingCount > 0 ? `Offline · ${engine.pendingCount} change${engine.pendingCount === 1 ? '' : 's'} queued` : 'Offline',
    };
  }
  if (engine.activity === 'error') return { state: 'error', text: 'Sync failed' };

  // F-17: never claim "Synced" while a row genuinely still needs to go out — most
  // concretely, a rejected row (which `syncNow` deliberately leaves un-acked and does
  // NOT report through `activity: 'error'` alone in every code path) but this guard is
  // general on purpose: whatever the reason `pendingCount` is nonzero, the chip must not
  // say the opposite of what's true. Reuses the existing `queued` state/copy shape
  // (`docs/DESIGN.md` §7.10) rather than inventing a seventh chip state.
  if (engine.pendingCount > 0) {
    return {
      state: 'queued',
      text: `${engine.pendingCount} change${engine.pendingCount === 1 ? '' : 's'} pending`,
    };
  }

  return {
    state: 'synced',
    text: engine.lastSyncedAt !== null ? `Synced · ${formatRelativeTime(engine.lastSyncedAt, now)}` : 'Synced',
  };
}
