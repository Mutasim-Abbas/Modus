import type { Profile, Settings } from '@/types';
import type { PullCursor, RowCursor } from '@/lib/sync/types';

/**
 * Per-account sync bookkeeping: the pull cursor, which local rows have been
 * acknowledged by the server, and the adoption/merge decision state.
 *
 * Deliberately a SEPARATE localStorage key from `src/lib/store.ts` (`fitmacro.v2`):
 * this is sync metadata, not user content, and keeping it apart means a user who has
 * never signed in never has this key at all, and `store.reset()` (Profile screen's
 * "Reset all data") never has to know sync bookkeeping exists.
 *
 * Scoped per `userId` (never a single global blob) because the value of a pull cursor
 * is meaningless — worse, actively wrong — for any account other than the one it was
 * issued to: reusing account A's cursor while signed in as account B would silently
 * skip B's own earlier rows on the very first pull for that account.
 */

const STORAGE_KEY = 'fitmacro.sync.v1';
const VERSION = 1;

export interface AckedState {
  entries: Record<string, number>;
  weights: Record<string, number>;
  customFoods: Record<string, number>;
  favourites: Record<string, number>;
}

export interface AccountSyncState {
  /** Only ever assigned from a `GET /api/sync/pull` response's `cursor` — never from
   *  push's `serverState` (the internal security audit F-03). */
  pullCursor: PullCursor | null;
  /** Local `updatedAt` (ms) of the newest version of each row already confirmed
   *  synced — the acknowledgement diffing is built against, see `src/lib/sync/diff.ts`. */
  acked: AckedState;
  /** The last profile/settings content this device knows the server also has —
   *  compared by deep equality to decide whether a push is needed at all, since neither
   *  `Profile` nor `Settings` carries its own `updatedAt` locally. */
  profileSnapshot: Profile | null;
  settingsSnapshot: Settings | null;
  /** Wall-clock ms of the last successful pull or push, for "Synced · 2 min ago". */
  lastSyncedAt: number | null;
  /** The adoption/merge screen (docs/DESIGN.md §7.11) has been resolved at least once
   *  for this account on this device — background sync may run freely. */
  resolved: boolean;
  /** The user picked "Decide later — keep working offline" on the merge screen.
   *  Background sync stays paused (no push, no pull) until the merge is actually
   *  resolved, so an un-reconciled local outbox can never be dumped into the account
   *  behind the user's back. */
  postponed: boolean;
}

export function defaultAccountSyncState(): AccountSyncState {
  return {
    pullCursor: null,
    acked: { entries: {}, weights: {}, customFoods: {}, favourites: {} },
    profileSnapshot: null,
    settingsSnapshot: null,
    lastSyncedAt: null,
    resolved: false,
    postponed: false,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function nullableNum(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringRecord(value: unknown): Record<string, number> {
  if (!isRecord(value)) return {};
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === 'number' && Number.isFinite(raw)) out[key] = raw;
  }
  return out;
}

function parseRowCursor(value: unknown): RowCursor | null {
  if (!isRecord(value)) return null;
  const updatedAt = typeof value.updatedAt === 'string' ? value.updatedAt : '';
  const id = typeof value.id === 'string' ? value.id : '';
  if (!updatedAt || !id) return null;
  return { updatedAt, id };
}

function parsePullCursor(value: unknown): PullCursor | null {
  if (!isRecord(value)) return null;
  return {
    profile: typeof value.profile === 'string' ? value.profile : null,
    settings: typeof value.settings === 'string' ? value.settings : null,
    entries: parseRowCursor(value.entries),
    weights: parseRowCursor(value.weights),
    customFoods: parseRowCursor(value.customFoods),
    favourites: parseRowCursor(value.favourites),
  };
}

function parseProfile(value: unknown): Profile | null {
  if (!isRecord(value)) return null;
  const age = num(value.age);
  const heightCm = num(value.heightCm);
  const weightKg = num(value.weightKg);
  if (age <= 0 || heightCm <= 0 || weightKg <= 0) return null;
  const sex = value.sex === 'female' ? 'female' : 'male';
  const activity =
    typeof value.activity === 'string' &&
    (['sedentary', 'light', 'moderate', 'very', 'extra'] as const).includes(
      value.activity as 'sedentary' | 'light' | 'moderate' | 'very' | 'extra',
    )
      ? (value.activity as Profile['activity'])
      : 'sedentary';
  const goal =
    typeof value.goal === 'string' && (['cut', 'maintain', 'bulk'] as const).includes(value.goal as 'cut' | 'maintain' | 'bulk')
      ? (value.goal as Profile['goal'])
      : 'maintain';
  return { sex, age, heightCm, weightKg, activity, goal };
}

function parseSettings(value: unknown): Settings | null {
  if (!isRecord(value)) return null;
  return { units: 'metric', reducedMotion: value.reducedMotion === true };
}

function parseAccountSyncState(value: unknown): AccountSyncState {
  const fallback = defaultAccountSyncState();
  if (!isRecord(value)) return fallback;
  const acked = isRecord(value.acked) ? value.acked : {};

  return {
    pullCursor: parsePullCursor(value.pullCursor),
    acked: {
      entries: stringRecord(acked.entries),
      weights: stringRecord(acked.weights),
      customFoods: stringRecord(acked.customFoods),
      favourites: stringRecord(acked.favourites),
    },
    profileSnapshot: parseProfile(value.profileSnapshot),
    settingsSnapshot: parseSettings(value.settingsSnapshot),
    lastSyncedAt: nullableNum(value.lastSyncedAt),
    resolved: value.resolved === true,
    postponed: value.postponed === true,
  };
}

function safeStorage(): Storage | null {
  try {
    const probe = '__fitmacro_sync_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return null;
  }
}

interface PersistedBlob {
  version: number;
  accounts: Record<string, unknown>;
}

function loadBlob(): PersistedBlob {
  const storage = safeStorage();
  if (!storage) return { version: VERSION, accounts: {} };
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return { version: VERSION, accounts: {} };
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || !isRecord(parsed.accounts)) return { version: VERSION, accounts: {} };
    return { version: VERSION, accounts: parsed.accounts };
  } catch {
    return { version: VERSION, accounts: {} };
  }
}

function saveBlob(blob: PersistedBlob): void {
  const storage = safeStorage();
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(blob));
  } catch {
    // Quota/private-mode failure: sync bookkeeping degrades to in-memory-only for this
    // load, exactly like `src/lib/store.ts`'s own `isPersisted()` gap — never throws.
  }
}

export function loadAccountSyncState(userId: string): AccountSyncState {
  const blob = loadBlob();
  return parseAccountSyncState(blob.accounts[userId]);
}

export function saveAccountSyncState(userId: string, state: AccountSyncState): void {
  const blob = loadBlob();
  blob.accounts[userId] = state;
  saveBlob(blob);
}

/** Read-modify-write convenience — every call site reads the latest persisted value
 *  first, so two updates in the same tick (e.g. a push ack immediately followed by a
 *  cursor update) never clobber each other. */
export function updateAccountSyncState(
  userId: string,
  updater: (prev: AccountSyncState) => AccountSyncState,
): AccountSyncState {
  const next = updater(loadAccountSyncState(userId));
  saveAccountSyncState(userId, next);
  return next;
}

/** Test-only: wipe every account's sync bookkeeping. */
export function resetAllSyncState(): void {
  const storage = safeStorage();
  try {
    storage?.removeItem(STORAGE_KEY);
  } catch {
    /* nothing more to do */
  }
}
