import type { AppState, CustomFood, DayKey, DayLog, Favourite, LogEntry, Profile, WeightEntry } from '@/types';
import type {
  PullResult,
  PushCustomFoodOp,
  PushEntryOp,
  PushFavouriteOp,
  PushRequestBody,
  PushWeightOp,
  RemoteCustomFood,
  RemoteEntry,
  RemoteFavourite,
  TableCounts,
} from '@/lib/sync/types';
import { mergeCustomFoods, mergeEntries, mergeFavourites, mergeWeights } from '@/lib/sync/applyRemote';
import type { OutboxManifest, RemoteApplied } from '@/lib/sync/diff';

/**
 * Pure logic for `/sync/merge` (docs/DESIGN.md §7.11) — the adoption/merge screen, the
 * highest-risk surface in v3. Nothing here performs I/O: every function takes the local
 * store snapshot and a completed full pull, and returns either a read-only preview (for
 * rendering real, pre-commit counts) or a resolved plan (for the caller to apply/push).
 *
 * docs/API.md explains why conflicts are computed here rather than on the server: a
 * conflict is a comparison between the server's rows and this device's un-synced local
 * rows, and the server has structurally never seen the local side.
 */

type TableName = 'entries' | 'weights' | 'customFoods' | 'favourites';

export interface TableDelta {
  /** ids live only on this device — additions under "Merge both", deletions under
   *  "Keep account only". */
  localOnlyLive: string[];
  /** ids live only in the account — deletions under "Keep this device only". */
  remoteOnlyLive: string[];
  /** ids present on both sides with a genuine difference (content or live/deleted
   *  status) — resolved by comparing `updatedAt`, newer wins. */
  conflictIds: string[];
}

export interface ConflictRow {
  table: TableName;
  id: string;
  label: string;
  local: { updatedAt: number; deletedAt: number | null; summary: string };
  remote: { updatedAt: number; deletedAt: number | null; summary: string };
  /** true when the LOCAL version is the one that will be kept under "Merge both". */
  localWins: boolean;
}

export interface MergePreview {
  local: TableCounts;
  remote: TableCounts;
  deltas: Record<TableName, TableDelta>;
  conflicts: ConflictRow[];
}

interface Row {
  updatedAt: number;
  deletedAt: number | null;
}

function classifyTable<TL extends Row, TR extends Row>(
  localAll: Map<string, TL>,
  remoteAll: Map<string, TR>,
  differs: (local: TL, remote: TR) => boolean,
): TableDelta {
  const localOnlyLive: string[] = [];
  const remoteOnlyLive: string[] = [];
  const conflictIds: string[] = [];

  for (const [id, local] of localAll) {
    const remote = remoteAll.get(id);
    if (!remote) {
      if (local.deletedAt === null) localOnlyLive.push(id);
      continue;
    }
    const bothTombstoned = local.deletedAt !== null && remote.deletedAt !== null;
    if (bothTombstoned) continue;
    const sameLiveness = (local.deletedAt === null) === (remote.deletedAt === null);
    if (sameLiveness && !differs(local, remote)) continue; // truly identical — nothing to resolve
    conflictIds.push(id);
  }

  for (const [id, remote] of remoteAll) {
    if (!localAll.has(id) && remote.deletedAt === null) remoteOnlyLive.push(id);
  }

  return { localOnlyLive, remoteOnlyLive, conflictIds };
}

function entryDiffers(local: LogEntry, remote: RemoteEntry): boolean {
  return (
    local.name !== remote.name ||
    local.grams !== remote.grams ||
    local.kcal !== remote.kcal ||
    local.protein !== remote.protein ||
    local.carbs !== remote.carbs ||
    local.fat !== remote.fat ||
    local.meal !== remote.meal ||
    (local.foodId ?? null) !== remote.foodId
  );
}

function weightDiffers(local: WeightEntry, remote: { weightKg: number; day: string }): boolean {
  return local.weightKg !== remote.weightKg || local.day !== remote.day;
}

function customFoodDiffers(local: CustomFood, remote: RemoteCustomFood): boolean {
  return (
    local.name !== remote.name ||
    local.category !== remote.category ||
    local.kcal !== remote.kcal ||
    local.protein !== remote.protein ||
    local.carbs !== remote.carbs ||
    local.fat !== remote.fat
  );
}

function favouriteDiffers(): boolean {
  return false; // a favourite carries no content beyond liveness — already checked
}

function localEntriesMap(state: AppState): Map<string, LogEntry & { day: DayKey }> {
  const map = new Map<string, LogEntry & { day: DayKey }>();
  for (const day of Object.values(state.days)) {
    for (const entry of day.entries) map.set(entry.id, { ...entry, day: day.date });
  }
  return map;
}

function byId<T extends { id: string }>(rows: readonly T[]): Map<string, T> {
  return new Map(rows.map((row) => [row.id, row]));
}

function byFoodId<T extends { foodId: string }>(rows: readonly T[]): Map<string, T> {
  return new Map(rows.map((row) => [row.foodId, row]));
}

function entrySummary(row: { name: string; grams: number; kcal: number }): string {
  return `${row.name} · ${Math.round(row.grams)} g · ${Math.round(row.kcal)} kcal`;
}

/** Computes the read-only preview §7.11 renders: real counts plus every conflicting row. */
export function computeMergePreview(local: AppState, remote: PullResult): MergePreview {
  const localEntries = localEntriesMap(local);
  const remoteEntries = byId(remote.entries);
  const localWeights = byId(local.weights);
  const remoteWeights = byId(remote.weights);
  const localCustomFoods = byId(local.customFoods);
  const remoteCustomFoods = byId(remote.customFoods);
  const localFavourites = byFoodId(local.favourites);
  const remoteFavourites = byFoodId(remote.favourites);

  const deltas: Record<TableName, TableDelta> = {
    entries: classifyTable(localEntries, remoteEntries, entryDiffers),
    weights: classifyTable(localWeights, remoteWeights, weightDiffers),
    customFoods: classifyTable(localCustomFoods, remoteCustomFoods, customFoodDiffers),
    favourites: classifyTable(localFavourites, remoteFavourites, favouriteDiffers),
  };

  const conflicts: ConflictRow[] = [];
  for (const id of deltas.entries.conflictIds) {
    const l = localEntries.get(id);
    const r = remoteEntries.get(id);
    if (!l || !r) continue;
    conflicts.push({
      table: 'entries',
      id,
      label: `${l.name || r.name} · ${l.day || r.day}`,
      local: { updatedAt: l.updatedAt, deletedAt: l.deletedAt, summary: l.deletedAt === null ? entrySummary(l) : 'Deleted' },
      remote: { updatedAt: r.updatedAt, deletedAt: r.deletedAt, summary: r.deletedAt === null ? entrySummary(r) : 'Deleted' },
      localWins: l.updatedAt >= r.updatedAt,
    });
  }
  for (const id of deltas.weights.conflictIds) {
    const l = localWeights.get(id);
    const r = remoteWeights.get(id);
    if (!l || !r) continue;
    conflicts.push({
      table: 'weights',
      id,
      label: `Weight · ${l.day || r.day}`,
      local: { updatedAt: l.updatedAt, deletedAt: l.deletedAt, summary: l.deletedAt === null ? `${l.weightKg} kg` : 'Deleted' },
      remote: { updatedAt: r.updatedAt, deletedAt: r.deletedAt, summary: r.deletedAt === null ? `${r.weightKg} kg` : 'Deleted' },
      localWins: l.updatedAt >= r.updatedAt,
    });
  }
  for (const id of deltas.customFoods.conflictIds) {
    const l = localCustomFoods.get(id);
    const r = remoteCustomFoods.get(id);
    if (!l || !r) continue;
    conflicts.push({
      table: 'customFoods',
      id,
      label: l.name || r.name,
      local: { updatedAt: l.updatedAt, deletedAt: l.deletedAt, summary: l.deletedAt === null ? `${l.kcal} kcal/100g` : 'Deleted' },
      remote: { updatedAt: r.updatedAt, deletedAt: r.deletedAt, summary: r.deletedAt === null ? `${r.kcal} kcal/100g` : 'Deleted' },
      localWins: l.updatedAt >= r.updatedAt,
    });
  }
  for (const id of deltas.favourites.conflictIds) {
    const l = localFavourites.get(id);
    const r = remoteFavourites.get(id);
    if (!l || !r) continue;
    conflicts.push({
      table: 'favourites',
      id,
      label: id,
      local: { updatedAt: l.updatedAt, deletedAt: l.deletedAt, summary: l.deletedAt === null ? 'Favourited' : 'Removed' },
      remote: { updatedAt: r.updatedAt, deletedAt: r.deletedAt, summary: r.deletedAt === null ? 'Favourited' : 'Removed' },
      localWins: l.updatedAt >= r.updatedAt,
    });
  }

  return { local: computeLocalCounts(local), remote: remote.counts, deltas, conflicts };
}

/** Same shape as the server's `counts` (docs/API.md), computed from the live local
 *  store — so the "On this device" card is built from the identical formula as the
 *  "In your account" card, never a different, ad hoc calculation. */
export function computeLocalCounts(state: AppState): TableCounts {
  const liveEntries: { day: DayKey; updatedAt: number }[] = [];
  for (const day of Object.values(state.days)) {
    for (const entry of day.entries) if (entry.deletedAt === null) liveEntries.push({ day: day.date, updatedAt: entry.updatedAt });
  }
  const days = new Set(liveEntries.map((e) => e.day));
  const sortedDays = Array.from(days).sort();

  const liveWeights = state.weights.filter((w) => w.deletedAt === null);
  const liveCustomFoods = state.customFoods.filter((f) => f.deletedAt === null);
  const liveFavourites = state.favourites.filter((f) => f.deletedAt === null);

  const allUpdatedAt = [
    ...liveEntries.map((e) => e.updatedAt),
    ...state.weights.map((w) => w.updatedAt),
    ...state.customFoods.map((f) => f.updatedAt),
    ...state.favourites.map((f) => f.updatedAt),
  ];
  const lastChangeAt = allUpdatedAt.length > 0 ? new Date(Math.max(...allUpdatedAt)).toISOString() : null;

  return {
    entries: {
      total: liveEntries.length,
      days: sortedDays.length,
      firstDay: sortedDays[0] ?? null,
      lastDay: sortedDays[sortedDays.length - 1] ?? null,
    },
    weights: { total: liveWeights.length },
    customFoods: { total: liveCustomFoods.length },
    favourites: { total: liveFavourites.length },
    lastChangeAt,
  };
}

export interface ResolvedMerge {
  pushBody: PushRequestBody;
  manifest: OutboxManifest;
  localPatch: Partial<Pick<AppState, 'profile' | 'days' | 'weights' | 'customFoods' | 'favourites' | 'settings'>>;
  /** Rows written into `localPatch` because the REMOTE side won the comparison — only
   *  `resolveMergeBoth` produces these (the other two resolutions either upload local
   *  verbatim or replace local wholesale; see the note on `resolveKeepAccountOnly` for
   *  the known gap that leaves open). The caller folds this into `acked` via
   *  `foldRemoteAppliedIntoAcked` (the internal security audit F-16). */
  remoteApplied?: RemoteApplied;
}

function emptyManifest(): OutboxManifest {
  return { entries: [], weights: [], customFoods: [], favourites: [], profile: null, settings: null };
}

/**
 * "Merge both" — keep everything from both sides. Per conflicting id, the newer
 * `updatedAt` wins (docs/DESIGN.md §7.11 rule 6: "FitMacro keeps the newer change").
 * The loser is never queryable again once the winner lands — the same honest
 * last-write-wins trade-off `docs/API.md`'s "Known limitations" already documents for
 * ordinary steady-state sync, not a new rule invented for this screen.
 */
export function resolveMergeBoth(local: AppState, remote: PullResult, preview: MergePreview): ResolvedMerge {
  const entryOps: PushEntryOp[] = [];
  const entryManifest: OutboxManifest['entries'] = [];
  const localEntries = localEntriesMap(local);

  for (const id of preview.deltas.entries.localOnlyLive) {
    const row = localEntries.get(id);
    if (!row) continue;
    entryOps.push(toEntryOp(row));
    entryManifest.push({ id, localUpdatedAt: row.updatedAt });
  }
  for (const conflict of preview.conflicts.filter((c) => c.table === 'entries' && c.localWins)) {
    const row = localEntries.get(conflict.id);
    if (!row) continue;
    entryOps.push(toEntryOp(row));
    entryManifest.push({ id: conflict.id, localUpdatedAt: row.updatedAt });
  }

  const weightOps: PushWeightOp[] = [];
  const weightManifest: OutboxManifest['weights'] = [];
  const localWeights = byId(local.weights);
  for (const id of preview.deltas.weights.localOnlyLive) {
    const row = localWeights.get(id);
    if (!row) continue;
    weightOps.push(toWeightOp(row));
    weightManifest.push({ id, localUpdatedAt: row.updatedAt });
  }
  for (const conflict of preview.conflicts.filter((c) => c.table === 'weights' && c.localWins)) {
    const row = localWeights.get(conflict.id);
    if (!row) continue;
    weightOps.push(toWeightOp(row));
    weightManifest.push({ id: conflict.id, localUpdatedAt: row.updatedAt });
  }

  const customFoodOps: PushCustomFoodOp[] = [];
  const customFoodManifest: OutboxManifest['customFoods'] = [];
  const localCustomFoods = byId(local.customFoods);
  for (const id of preview.deltas.customFoods.localOnlyLive) {
    const row = localCustomFoods.get(id);
    if (!row) continue;
    customFoodOps.push(toCustomFoodOp(row));
    customFoodManifest.push({ id, localUpdatedAt: row.updatedAt });
  }
  for (const conflict of preview.conflicts.filter((c) => c.table === 'customFoods' && c.localWins)) {
    const row = localCustomFoods.get(conflict.id);
    if (!row) continue;
    customFoodOps.push(toCustomFoodOp(row));
    customFoodManifest.push({ id: conflict.id, localUpdatedAt: row.updatedAt });
  }

  const favouriteOps: PushFavouriteOp[] = [];
  const favouriteManifest: OutboxManifest['favourites'] = [];
  const localFavourites = byFoodId(local.favourites);
  for (const id of preview.deltas.favourites.localOnlyLive) {
    const row = localFavourites.get(id);
    if (!row) continue;
    favouriteOps.push({ foodId: row.foodId, deleted: row.deletedAt !== null });
    favouriteManifest.push({ foodId: row.foodId, localUpdatedAt: row.updatedAt });
  }
  for (const conflict of preview.conflicts.filter((c) => c.table === 'favourites' && c.localWins)) {
    const row = localFavourites.get(conflict.id);
    if (!row) continue;
    favouriteOps.push({ foodId: row.foodId, deleted: row.deletedAt !== null });
    favouriteManifest.push({ foodId: row.foodId, localUpdatedAt: row.updatedAt });
  }

  // Profile/settings carry no local `updatedAt` at all (`src/types.ts`), so there is no
  // per-row LWW timestamp to compare for them the way every other table has one. This
  // screen's headline counts (docs/API.md's `counts`) never mention profile/settings
  // either — a deliberate scope limit this file follows: prefer the account's existing
  // profile/settings if it has one (the cross-device canonical copy), otherwise upload
  // this device's. Documented as a judgment call in the Task 6 report.
  const profilePatch = remote.profile === null && local.profile !== null ? local.profile : undefined;
  const settingsPatch = remote.settings === null ? local.settings : undefined;

  const pushBody: PushRequestBody = {};
  if (profilePatch) {
    pushBody.profile = {
      deleted: false,
      sex: profilePatch.sex,
      age: profilePatch.age,
      heightCm: profilePatch.heightCm,
      weightKg: profilePatch.weightKg,
      activity: profilePatch.activity,
      goal: profilePatch.goal,
    };
  }
  if (settingsPatch) pushBody.settings = { deleted: false, locale: 'en', reducedMotion: settingsPatch.reducedMotion };
  if (entryOps.length > 0) pushBody.entries = entryOps;
  if (weightOps.length > 0) pushBody.weights = weightOps;
  if (customFoodOps.length > 0) pushBody.customFoods = customFoodOps;
  if (favouriteOps.length > 0) pushBody.favourites = favouriteOps;

  const entriesResult = mergeEntries(local, remote.entries);
  const weightsResult = mergeWeights(local.weights, remote.weights);
  const customFoodsResult = mergeCustomFoods(local.customFoods, remote.customFoods);
  const favouritesResult = mergeFavourites(local.favourites, remote.favourites);
  const profile = remote.profile !== null ? toLocalProfile(remote.profile) : local.profile;
  const settings = local.settings;

  return {
    pushBody,
    manifest: { ...emptyManifest(), entries: entryManifest, weights: weightManifest, customFoods: customFoodManifest, favourites: favouriteManifest, profile: profilePatch ?? null, settings: settingsPatch ?? null },
    localPatch: { profile, days: entriesResult.days, weights: weightsResult.rows, customFoods: customFoodsResult.rows, favourites: favouritesResult.rows, settings },
    // Rows the REMOTE side won for during this merge (new to this device, or newer than
    // the local copy) — the caller must fold these into `AccountSyncState.acked` using
    // their own `updatedAt`, the exact same rule the internal security audit F-16 requires
    // of the background engine's incremental pull. Skipping this here would reproduce
    // the identical bug on the very next sync cycle after every "Merge both".
    remoteApplied: {
      entries: entriesResult.applied,
      weights: weightsResult.applied,
      customFoods: customFoodsResult.applied,
      favourites: favouritesResult.applied,
    },
  };
}

/** "Keep this device only" — the account is made to match local exactly: every local
 *  live row is upserted, and every id the account has that local doesn't know about at
 *  all is tombstoned. Nothing is applied back to the local store — local already IS the
 *  result. */
export function resolveKeepDeviceOnly(local: AppState, remote: PullResult): ResolvedMerge {
  const localEntries = localEntriesMap(local);
  const entryOps: PushEntryOp[] = [];
  const entryManifest: OutboxManifest['entries'] = [];
  for (const [id, row] of localEntries) {
    entryOps.push(toEntryOp(row));
    entryManifest.push({ id, localUpdatedAt: row.updatedAt });
  }
  for (const remoteEntry of remote.entries) {
    if (remoteEntry.deletedAt === null && !localEntries.has(remoteEntry.id)) {
      entryOps.push({ id: remoteEntry.id, deleted: true });
    }
  }

  const localWeights = byId(local.weights);
  const weightOps: PushWeightOp[] = [];
  const weightManifest: OutboxManifest['weights'] = [];
  for (const [id, row] of localWeights) {
    weightOps.push(toWeightOp(row));
    weightManifest.push({ id, localUpdatedAt: row.updatedAt });
  }
  for (const remoteWeight of remote.weights) {
    if (remoteWeight.deletedAt === null && !localWeights.has(remoteWeight.id)) {
      weightOps.push({ id: remoteWeight.id, deleted: true });
    }
  }

  const localCustomFoods = byId(local.customFoods);
  const customFoodOps: PushCustomFoodOp[] = [];
  const customFoodManifest: OutboxManifest['customFoods'] = [];
  for (const [id, row] of localCustomFoods) {
    customFoodOps.push(toCustomFoodOp(row));
    customFoodManifest.push({ id, localUpdatedAt: row.updatedAt });
  }
  for (const remoteFood of remote.customFoods) {
    if (remoteFood.deletedAt === null && !localCustomFoods.has(remoteFood.id)) {
      customFoodOps.push({ id: remoteFood.id, deleted: true });
    }
  }

  const localFavourites = byFoodId(local.favourites);
  const favouriteOps: PushFavouriteOp[] = [];
  const favouriteManifest: OutboxManifest['favourites'] = [];
  for (const [foodId, row] of localFavourites) {
    favouriteOps.push({ foodId, deleted: row.deletedAt !== null });
    favouriteManifest.push({ foodId, localUpdatedAt: row.updatedAt });
  }
  for (const remoteFav of remote.favourites) {
    if (remoteFav.deletedAt === null && !localFavourites.has(remoteFav.foodId)) {
      favouriteOps.push({ foodId: remoteFav.foodId, deleted: true });
    }
  }

  const pushBody: PushRequestBody = {
    settings: { deleted: false, locale: 'en', reducedMotion: local.settings.reducedMotion },
  };
  if (local.profile) {
    pushBody.profile = {
      deleted: false,
      sex: local.profile.sex,
      age: local.profile.age,
      heightCm: local.profile.heightCm,
      weightKg: local.profile.weightKg,
      activity: local.profile.activity,
      goal: local.profile.goal,
    };
  } else if (remote.profile !== null) {
    pushBody.profile = { deleted: true };
  }
  if (entryOps.length > 0) pushBody.entries = entryOps;
  if (weightOps.length > 0) pushBody.weights = weightOps;
  if (customFoodOps.length > 0) pushBody.customFoods = customFoodOps;
  if (favouriteOps.length > 0) pushBody.favourites = favouriteOps;

  return {
    pushBody,
    manifest: {
      ...emptyManifest(),
      entries: entryManifest,
      weights: weightManifest,
      customFoods: customFoodManifest,
      favourites: favouriteManifest,
      profile: local.profile,
      settings: local.settings,
    },
    localPatch: {},
  };
}

/** "Keep account only" — the device is made to match the account exactly. Nothing is
 *  pushed; the account already has the target state. Every id local knows about that
 *  the account doesn't is discarded outright (there is nothing to tombstone toward —
 *  it was never synced, so the server never needs to hear about it).
 *
 *  KNOWN GAP, not fixed by the F-16 pass (the internal security audit): this resolution
 *  does not return `remoteApplied`, and `MergeScreen.tsx`'s "keep-account" branch does
 *  not touch `acked` at all after committing it. Every row just written into
 *  `localPatch` therefore has no `acked` entry, so it reads as dirty on the very next
 *  `buildOutbox` call and gets pushed straight back — the same shape of bug F-16 fixes
 *  for the background engine's incremental pull, reachable here through a different
 *  door. `runPostSignInAdoption`'s "silent-download" branch (`src/lib/sync/signInFlow.ts`)
 *  has the identical gap. Left unfixed here deliberately: closing it needs its own
 *  "ack everything just downloaded" helper plus tests, and bolting it on inside this
 *  security fix risked doing it hastily. Flagged for a follow-up task rather than
 *  patched silently. */
export function resolveKeepAccountOnly(local: AppState, remote: PullResult): ResolvedMerge {
  const days = groupRemoteEntriesByDay(remote.entries);
  const weights = remote.weights.map(toLocalWeight);
  const customFoods = remote.customFoods.map(toLocalCustomFood);
  const favourites = remote.favourites.map(toLocalFavourite);
  const profile = remote.profile !== null ? toLocalProfile(remote.profile) : local.profile;
  const settings = remote.settings !== null ? { units: 'metric' as const, reducedMotion: remote.settings.reducedMotion } : local.settings;

  return {
    pushBody: {},
    manifest: emptyManifest(),
    localPatch: { profile, days, weights, customFoods, favourites, settings },
  };
}

function groupRemoteEntriesByDay(remote: readonly RemoteEntry[]): Record<DayKey, DayLog> {
  const days: Record<DayKey, DayLog> = {};
  for (const entry of remote) {
    const local = toLocalEntry(entry);
    const existing = days[entry.day];
    days[entry.day] = { date: entry.day, entries: existing ? [...existing.entries, local] : [local] };
  }
  return days;
}

const MEALS = ['breakfast', 'lunch', 'dinner', 'snack'] as const;
const SOURCES = ['food-db', 'scan', 'manual'] as const;
const CATEGORIES = [
  'protein',
  'grains',
  'dairy',
  'fruit',
  'vegetables',
  'fats & nuts',
  'snacks',
  'drinks',
  'turkish & middle eastern',
] as const;

function oneOf<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function toLocalEntry(remote: RemoteEntry): LogEntry {
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

function toLocalWeight(remote: {
  id: string;
  day: string;
  weightKg: number;
  updatedAt: number;
  deletedAt: number | null;
}): WeightEntry {
  return { id: remote.id, day: remote.day, weightKg: Math.max(0, remote.weightKg), updatedAt: remote.updatedAt, deletedAt: remote.deletedAt };
}

function toLocalCustomFood(remote: RemoteCustomFood): CustomFood {
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

function toLocalFavourite(remote: RemoteFavourite): Favourite {
  return { foodId: remote.foodId, updatedAt: remote.updatedAt, deletedAt: remote.deletedAt };
}

function toLocalProfile(remote: {
  sex: string;
  age: number;
  heightCm: number;
  weightKg: number;
  activity: string;
  goal: string;
}): Profile {
  return {
    sex: remote.sex === 'female' ? 'female' : 'male',
    age: remote.age,
    heightCm: remote.heightCm,
    weightKg: remote.weightKg,
    activity: oneOf(remote.activity, ['sedentary', 'light', 'moderate', 'very', 'extra'] as const, 'sedentary'),
    goal: oneOf(remote.goal, ['cut', 'maintain', 'bulk'] as const, 'maintain'),
  };
}

function toEntryOp(row: LogEntry & { day: DayKey }): PushEntryOp {
  if (row.deletedAt !== null) return { id: row.id, deleted: true };
  return {
    id: row.id,
    deleted: false,
    day: row.day,
    name: row.name,
    grams: row.grams,
    kcal: row.kcal,
    protein: row.protein,
    carbs: row.carbs,
    fat: row.fat,
    meal: row.meal,
    source: row.source,
    foodId: row.foodId ?? null,
    loggedAt: row.loggedAt,
  };
}

function toWeightOp(row: WeightEntry): PushWeightOp {
  if (row.deletedAt !== null) return { id: row.id, deleted: true };
  return { id: row.id, deleted: false, day: row.day, weightKg: row.weightKg };
}

function toCustomFoodOp(row: CustomFood): PushCustomFoodOp {
  if (row.deletedAt !== null) return { id: row.id, deleted: true };
  return {
    id: row.id,
    deleted: false,
    name: row.name,
    category: row.category,
    kcal: row.kcal,
    protein: row.protein,
    carbs: row.carbs,
    fat: row.fat,
    commonPortions: row.commonPortions,
  };
}

/** True when the account has any of the four synced tables' live rows at all —
 *  "Account-only" / "both non-empty" in docs/DESIGN.md §7.11's trigger rule. */
export function hasRemoteData(counts: TableCounts): boolean {
  return counts.entries.total > 0 || counts.weights.total > 0 || counts.customFoods.total > 0 || counts.favourites.total > 0;
}

/** True when this device has any of the four synced tables' live rows at all. */
export function hasLocalData(counts: TableCounts): boolean {
  return hasRemoteData(counts);
}
