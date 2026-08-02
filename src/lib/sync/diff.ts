import type { AppState, CustomFood, Favourite, LogEntry, Profile, Settings, WeightEntry } from '@/types';
import type { AccountSyncState, AckedState } from '@/lib/sync/persist';
import type {
  PushCustomFoodOp,
  PushEntryOp,
  PushFavouriteOp,
  PushRequestBody,
  PushResult,
  PushWeightOp,
} from '@/lib/sync/types';

/**
 * Builds the next push batch (the "outbox") by diffing local store content against
 * `AccountSyncState.acked` — there is no separate append-only queue to keep in sync
 * with the store, which is what makes the outbox survive a refresh for free: as long
 * as both `src/lib/store.ts` (`fitmacro.v2`) and `src/lib/sync/persist.ts`
 * (`fitmacro.sync.v1`) are on disk, re-running `buildOutbox` after a reload reproduces
 * the identical pending set, byte for byte (the project notes's "outbox survives a
 * refresh" acceptance criterion).
 *
 * The corollary is the `500` requirement: on a failed push, this module is never told
 * to "clear" anything — the caller simply does not call `applyPushResult`, so the next
 * `buildOutbox` call reproduces the exact same batch (nothing in local state or
 * `acked` changed in between).
 */

// docs/API.md: "Each table's array is additionally capped at 500 rows."
const MAX_ROWS_PER_TABLE = 500;

export interface OutboxManifest {
  entries: { id: string; localUpdatedAt: number }[];
  weights: { id: string; localUpdatedAt: number }[];
  customFoods: { id: string; localUpdatedAt: number }[];
  favourites: { foodId: string; localUpdatedAt: number }[];
  profile: Profile | null;
  settings: Settings | null;
}

export interface Outbox {
  body: PushRequestBody;
  manifest: OutboxManifest;
  /** Total pending ops across every table (SyncChip's "N changes queued"). Independent
   *  of the 500-per-table cap on `body` — this counts everything still un-acked, even
   *  rows that will only go out on a later push cycle. */
  pendingCount: number;
}

function profilesEqual(a: Profile | null, b: Profile | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.sex === b.sex &&
    a.age === b.age &&
    a.heightCm === b.heightCm &&
    a.weightKg === b.weightKg &&
    a.activity === b.activity &&
    a.goal === b.goal
  );
}

function settingsEqual(a: Settings | null, b: Settings | null): boolean {
  if (a === null || b === null) return a === b;
  return a.units === b.units && a.reducedMotion === b.reducedMotion;
}

interface DatedEntry {
  day: string;
  entry: LogEntry;
}

function pendingLive<T>(
  rows: readonly T[],
  acked: Record<string, number>,
  key: (row: T) => string,
  updatedAtOf: (row: T) => number,
): T[] {
  return rows.filter((row) => {
    const ackedAt = acked[key(row)];
    return ackedAt === undefined || updatedAtOf(row) > ackedAt;
  });
}

function flattenEntries(state: AppState): DatedEntry[] {
  const out: DatedEntry[] = [];
  for (const day of Object.values(state.days)) {
    for (const entry of day.entries) out.push({ day: day.date, entry });
  }
  return out;
}

function entryOp(entry: LogEntry, day: string): PushEntryOp {
  if (entry.deletedAt !== null) return { id: entry.id, deleted: true };
  return {
    id: entry.id,
    deleted: false,
    day,
    name: entry.name,
    grams: entry.grams,
    kcal: entry.kcal,
    protein: entry.protein,
    carbs: entry.carbs,
    fat: entry.fat,
    meal: entry.meal,
    source: entry.source,
    foodId: entry.foodId ?? null,
    loggedAt: entry.loggedAt,
  };
}

function weightOp(weight: WeightEntry): PushWeightOp {
  if (weight.deletedAt !== null) return { id: weight.id, deleted: true };
  return { id: weight.id, deleted: false, day: weight.day, weightKg: weight.weightKg };
}

function customFoodOp(food: CustomFood): PushCustomFoodOp {
  if (food.deletedAt !== null) return { id: food.id, deleted: true };
  return {
    id: food.id,
    deleted: false,
    name: food.name,
    category: food.category,
    kcal: food.kcal,
    protein: food.protein,
    carbs: food.carbs,
    fat: food.fat,
    commonPortions: food.commonPortions,
  };
}

function favouriteOp(fav: Favourite): PushFavouriteOp {
  return { foodId: fav.foodId, deleted: fav.deletedAt !== null };
}

export function buildOutbox(state: AppState, sync: AccountSyncState): Outbox {
  const pendingEntries = pendingLive(
    flattenEntries(state),
    sync.acked.entries,
    (row) => row.entry.id,
    (row) => row.entry.updatedAt,
  ).sort((a, b) => a.entry.updatedAt - b.entry.updatedAt);
  const pendingWeights = pendingLive(state.weights, sync.acked.weights, (w) => w.id, (w) => w.updatedAt).sort(
    (a, b) => a.updatedAt - b.updatedAt,
  );
  const pendingCustomFoods = pendingLive(
    state.customFoods,
    sync.acked.customFoods,
    (f) => f.id,
    (f) => f.updatedAt,
  ).sort((a, b) => a.updatedAt - b.updatedAt);
  const pendingFavourites = pendingLive(
    state.favourites,
    sync.acked.favourites,
    (f) => f.foodId,
    (f) => f.updatedAt,
  ).sort((a, b) => a.updatedAt - b.updatedAt);

  const profileDiffers = !profilesEqual(state.profile, sync.profileSnapshot);
  const settingsDiffers = !settingsEqual(state.settings, sync.settingsSnapshot);

  const entriesBatch = pendingEntries.slice(0, MAX_ROWS_PER_TABLE);
  const weightsBatch = pendingWeights.slice(0, MAX_ROWS_PER_TABLE);
  const customFoodsBatch = pendingCustomFoods.slice(0, MAX_ROWS_PER_TABLE);
  const favouritesBatch = pendingFavourites.slice(0, MAX_ROWS_PER_TABLE);

  const body: PushRequestBody = {};
  if (profileDiffers) {
    body.profile = state.profile
      ? {
          deleted: false,
          sex: state.profile.sex,
          age: state.profile.age,
          heightCm: state.profile.heightCm,
          weightKg: state.profile.weightKg,
          activity: state.profile.activity,
          goal: state.profile.goal,
        }
      : null;
  }
  if (settingsDiffers) {
    body.settings = { deleted: false, locale: 'en', reducedMotion: state.settings.reducedMotion };
  }
  if (entriesBatch.length > 0) body.entries = entriesBatch.map(({ day, entry }) => entryOp(entry, day));
  if (weightsBatch.length > 0) body.weights = weightsBatch.map(weightOp);
  if (customFoodsBatch.length > 0) body.customFoods = customFoodsBatch.map(customFoodOp);
  if (favouritesBatch.length > 0) body.favourites = favouritesBatch.map(favouriteOp);

  const manifest: OutboxManifest = {
    entries: entriesBatch.map(({ entry }) => ({ id: entry.id, localUpdatedAt: entry.updatedAt })),
    weights: weightsBatch.map((w) => ({ id: w.id, localUpdatedAt: w.updatedAt })),
    customFoods: customFoodsBatch.map((f) => ({ id: f.id, localUpdatedAt: f.updatedAt })),
    favourites: favouritesBatch.map((f) => ({ foodId: f.foodId, localUpdatedAt: f.updatedAt })),
    profile: profileDiffers ? state.profile : null,
    settings: settingsDiffers ? state.settings : null,
  };

  const pendingCount =
    pendingEntries.length +
    pendingWeights.length +
    pendingCustomFoods.length +
    pendingFavourites.length +
    (profileDiffers ? 1 : 0) +
    (settingsDiffers ? 1 : 0);

  return { body, manifest, pendingCount };
}

/** True when there is nothing to send — `syncNow()` can skip the push round trip. */
export function isOutboxEmpty(outbox: Outbox): boolean {
  const { body } = outbox;
  return (
    body.profile === undefined &&
    body.settings === undefined &&
    !body.entries?.length &&
    !body.weights?.length &&
    !body.customFoods?.length &&
    !body.favourites?.length
  );
}

/**
 * Folds a successful push response back into the persisted sync state: every id the
 * server actually confirmed in `applied` is marked acked using the LOCAL `updatedAt`
 * that was included in the outbox (not the server's re-stamped one) — that is what
 * makes the next `buildOutbox` call correctly see the row as "already synced" as long
 * as it isn't edited again. A rejected id (`owner_conflict` / `duplicate_day`) is
 * deliberately left un-acked, so it naturally reappears in the next push's batch
 * instead of being silently dropped.
 */
export function applyPushResultToAcked(
  prev: AccountSyncState,
  manifest: OutboxManifest,
  result: PushResult,
): AccountSyncState {
  const appliedEntryIds = new Set(result.applied.entries.map((r) => r.id));
  const appliedWeightIds = new Set(result.applied.weights.map((r) => r.id));
  const appliedCustomFoodIds = new Set(result.applied.customFoods.map((r) => r.id));
  const appliedFavouriteIds = new Set(result.applied.favourites.map((r) => r.foodId));

  const entries = { ...prev.acked.entries };
  for (const row of manifest.entries) if (appliedEntryIds.has(row.id)) entries[row.id] = row.localUpdatedAt;

  const weights = { ...prev.acked.weights };
  for (const row of manifest.weights) if (appliedWeightIds.has(row.id)) weights[row.id] = row.localUpdatedAt;

  const customFoods = { ...prev.acked.customFoods };
  for (const row of manifest.customFoods) if (appliedCustomFoodIds.has(row.id)) customFoods[row.id] = row.localUpdatedAt;

  const favourites = { ...prev.acked.favourites };
  for (const row of manifest.favourites) if (appliedFavouriteIds.has(row.foodId)) favourites[row.foodId] = row.localUpdatedAt;

  return {
    ...prev,
    acked: { entries, weights, customFoods, favourites },
    profileSnapshot: result.applied.profile ? manifest.profile : prev.profileSnapshot,
    settingsSnapshot: result.applied.settings ? manifest.settings : prev.settingsSnapshot,
    lastSyncedAt: Date.now(),
  };
}

/**
 * The pull-side counterpart to `applyPushResultToAcked`: folds the rows a pull (or a
 * merge-screen resolution built from a full pull, `src/lib/sync/adoption.ts`
 * `resolveMergeBoth`) actually wrote into the local store — because the REMOTE side won
 * the comparison — into `acked`, using each row's OWN `updatedAt` (the value that is now
 * sitting in the local row, not the acked map's previous value).
 *
 * the internal security audit F-16: without this, a row that only ever arrives via a pull
 * is permanently newer than its (missing) `acked` entry, so `buildOutbox` classifies it
 * dirty forever and echoes it straight back to the server on every cycle. Rows where the
 * LOCAL copy won are never in `applied` in the first place (see
 * `src/lib/sync/applyRemote.ts`'s module comment) — this function has no way to
 * over-ack them, by construction, not just by convention.
 */
export interface RemoteApplied {
  entries: { key: string; updatedAt: number }[];
  weights: { key: string; updatedAt: number }[];
  customFoods: { key: string; updatedAt: number }[];
  favourites: { key: string; updatedAt: number }[];
}

export function foldRemoteAppliedIntoAcked(acked: AckedState, applied: RemoteApplied): AckedState {
  const entries = { ...acked.entries };
  for (const row of applied.entries) entries[row.key] = row.updatedAt;

  const weights = { ...acked.weights };
  for (const row of applied.weights) weights[row.key] = row.updatedAt;

  const customFoods = { ...acked.customFoods };
  for (const row of applied.customFoods) customFoods[row.key] = row.updatedAt;

  const favourites = { ...acked.favourites };
  for (const row of applied.favourites) favourites[row.key] = row.updatedAt;

  return { entries, weights, customFoods, favourites };
}
