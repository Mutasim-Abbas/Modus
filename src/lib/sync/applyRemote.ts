import type {
  AppState,
  CustomFood,
  DayKey,
  DayLog,
  EntrySource,
  Favourite,
  FoodCategory,
  LogEntry,
  MealSlot,
  WeightEntry,
} from '@/types';
import type { RemoteCustomFood, RemoteEntry, RemoteFavourite, RemoteWeight } from '@/lib/sync/types';

/**
 * Pure last-write-wins merge of a remote row set into a local row set, by id.
 *
 * Used identically by two different callers (docs/API.md's per-row LWW rule doesn't
 * change shape depending on who's asking):
 *  - `src/lib/sync/engine.ts`'s steady-state incremental pull (`remote` is a delta —
 *    only rows changed since the saved cursor).
 *  - `src/lib/sync/adoption.ts`'s "Merge both" resolution (`remote` is the account's
 *    complete row set from a full pull).
 *
 * The rule, stated once: a row present only locally is left untouched (it hasn't been
 * pushed yet, or the server hasn't reported it back — either way, nothing to overwrite
 * it with). A row present in both is resolved by comparing `updatedAt`: the newer side
 * wins, INCLUDING a tombstone — "no resurrected deletes" is simply this rule applied to
 * the case where the winning side happens to be deleted. A live local edit that is
 * genuinely newer than a remote tombstone legitimately un-deletes it (docs/API.md,
 * "What 'does not resurrect' does *not* mean") — that is this same rule, not an
 * exception to it.
 *
 * Every merge below also reports `applied` — the keys where the REMOTE row won (new to
 * this device, or newer than the local copy). This is what lets a caller fold a pull's
 * result into `AccountSyncState.acked` (the internal security audit F-16): a row the remote
 * side won for is now provably in sync and must be acked using ITS OWN `updatedAt`, or
 * the next `buildOutbox` call classifies it dirty and pushes it straight back — forever.
 * A row where the LOCAL copy won is deliberately NOT reported as applied: it still needs
 * to be pushed, and acking it here would be a data-loss bug (a locally-newer edit would
 * look "already synced" and never leave the device).
 */
export interface MergeResult<T> {
  rows: T[];
  applied: { key: string; updatedAt: number }[];
}

function mergeById<T extends { updatedAt: number }>(
  local: readonly T[],
  remote: readonly T[],
  key: (row: T) => string,
): MergeResult<T> {
  const byKey = new Map<string, T>();
  for (const row of local) byKey.set(key(row), row);

  const applied: { key: string; updatedAt: number }[] = [];
  for (const row of remote) {
    const existing = byKey.get(key(row));
    if (!existing || row.updatedAt >= existing.updatedAt) {
      byKey.set(key(row), row);
      applied.push({ key: key(row), updatedAt: row.updatedAt });
    }
  }

  return { rows: Array.from(byKey.values()), applied };
}

const MEALS: readonly MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack'];
const SOURCES: readonly EntrySource[] = ['food-db', 'scan', 'manual'];
const CATEGORIES: readonly FoodCategory[] = [
  'protein',
  'grains',
  'dairy',
  'fruit',
  'vegetables',
  'fats & nuts',
  'snacks',
  'drinks',
  'turkish & middle eastern',
];

function oneOf<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function remoteEntryToLocal(remote: RemoteEntry): LogEntry {
  const entry: LogEntry = {
    id: remote.id,
    name: remote.name,
    grams: Math.max(0, remote.grams),
    kcal: Math.max(0, remote.kcal),
    protein: Math.max(0, remote.protein),
    carbs: Math.max(0, remote.carbs),
    fat: Math.max(0, remote.fat),
    meal: oneOf(remote.meal, MEALS, 'snack'),
    source: oneOf(remote.source, SOURCES, 'manual'),
    loggedAt: remote.loggedAt,
    updatedAt: remote.updatedAt,
    deletedAt: remote.deletedAt,
  };
  return remote.foodId ? { ...entry, foodId: remote.foodId } : entry;
}

function remoteWeightToLocal(remote: RemoteWeight): WeightEntry {
  return {
    id: remote.id,
    day: remote.day,
    weightKg: Math.max(0, remote.weightKg),
    updatedAt: remote.updatedAt,
    deletedAt: remote.deletedAt,
  };
}

function remoteCustomFoodToLocal(remote: RemoteCustomFood): CustomFood {
  return {
    id: remote.id,
    name: remote.name,
    category: oneOf(remote.category, CATEGORIES, 'snacks'),
    kcal: Math.max(0, remote.kcal),
    protein: Math.max(0, remote.protein),
    carbs: Math.max(0, remote.carbs),
    fat: Math.max(0, remote.fat),
    per: 100,
    commonPortions: remote.commonPortions,
    updatedAt: remote.updatedAt,
    deletedAt: remote.deletedAt,
  };
}

function remoteFavouriteToLocal(remote: RemoteFavourite): Favourite {
  return { foodId: remote.foodId, updatedAt: remote.updatedAt, deletedAt: remote.deletedAt };
}

/** Rebuilds `state.days` from a flat, id-merged entry list, grouped by each entry's
 *  own `day` — an entry's day never changes locally (there is no "move to another day"
 *  feature), so this only ever matters for a row this device is receiving for the
 *  first time, or one whose local copy loses the LWW comparison. */
function groupEntriesByDay(entries: readonly { day: DayKey; entry: LogEntry }[]): Record<DayKey, DayLog> {
  const days: Record<DayKey, DayLog> = {};
  for (const { day, entry } of entries) {
    const existing = days[day];
    days[day] = { date: day, entries: existing ? [...existing.entries, entry] : [entry] };
  }
  return days;
}

export interface MergeEntriesResult {
  days: Record<DayKey, DayLog>;
  applied: { key: string; updatedAt: number }[];
}

/** Merges a remote entry set into local `days`, by id, LWW. Entries get their own
 *  function (rather than reusing `mergeById`) because the result has to be regrouped by
 *  day, but the applied/not-applied rule is identical — see the module comment above. */
export function mergeEntries(state: AppState, remote: readonly RemoteEntry[]): MergeEntriesResult {
  const local: { day: DayKey; entry: LogEntry }[] = [];
  for (const day of Object.values(state.days)) {
    for (const entry of day.entries) local.push({ day: day.date, entry });
  }
  const remoteWithDay = remote.map((r) => ({ day: r.day, entry: remoteEntryToLocal(r) }));

  const byId = new Map<string, { day: DayKey; entry: LogEntry }>();
  for (const row of local) byId.set(row.entry.id, row);
  const applied: { key: string; updatedAt: number }[] = [];
  for (const row of remoteWithDay) {
    const existing = byId.get(row.entry.id);
    if (!existing || row.entry.updatedAt >= existing.entry.updatedAt) {
      byId.set(row.entry.id, row);
      applied.push({ key: row.entry.id, updatedAt: row.entry.updatedAt });
    }
  }

  return { days: groupEntriesByDay(Array.from(byId.values())), applied };
}

export function mergeWeights(local: readonly WeightEntry[], remote: readonly RemoteWeight[]): MergeResult<WeightEntry> {
  return mergeById(local, remote.map(remoteWeightToLocal), (w) => w.id);
}

export function mergeCustomFoods(local: readonly CustomFood[], remote: readonly RemoteCustomFood[]): MergeResult<CustomFood> {
  return mergeById(local, remote.map(remoteCustomFoodToLocal), (f) => f.id);
}

export function mergeFavourites(local: readonly Favourite[], remote: readonly RemoteFavourite[]): MergeResult<Favourite> {
  return mergeById(local, remote.map(remoteFavouriteToLocal), (f) => f.foodId);
}
