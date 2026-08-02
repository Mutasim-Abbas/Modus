/**
 * Row shaping for `api/sync/pull` and `api/sync/push` — the one place a synced-table row
 * is turned into (or out of) its JSON wire shape, mirroring `api/_lib/auth/users.ts`'s
 * `toPublicUser()` pattern: one function per table, so there is exactly one place that
 * knows the DB row's real column types (numeric-as-string, `Date`, `date`-as-string).
 *
 * Numeric columns (`grams`, `kcal`, `protein`, `carbs`, `fat`, `*Kg`, `*Cm`) round-trip
 * as **decimal strings**, never `number` — this is deliberate (docs/DB.md §2.2: `numeric`
 * columns are read back as exact strings so `0.1 + 0.2` never happens between the
 * database and a client). `docs/API.md` documents this for whoever builds the sync
 * engine against this contract; every wire shape below is what actually round-trips.
 */

import type { customFoods, entries, favourites, profiles, userSettings, weights } from '../db/schema.js';

type ProfileRow = typeof profiles.$inferSelect;
type SettingsRow = typeof userSettings.$inferSelect;
type EntryRow = typeof entries.$inferSelect;
type WeightRow = typeof weights.$inferSelect;
type CustomFoodRow = typeof customFoods.$inferSelect;
type FavouriteRow = typeof favourites.$inferSelect;

const toIso = (d: Date): string => d.toISOString();
const toIsoOrNull = (d: Date | null): string | null => (d ? d.toISOString() : null);

/** `number` -> a fixed-decimal string matching the target `numeric(p, scale)` column. */
export function toNumeric(value: number, scale: number): string {
  return value.toFixed(scale);
}

export interface WireProfile {
  sex: ProfileRow['sex'];
  age: number;
  heightCm: string;
  weightKg: string;
  activity: ProfileRow['activity'];
  goal: ProfileRow['goal'];
  updatedAt: string;
  deletedAt: string | null;
}

export function serializeProfile(row: ProfileRow): WireProfile {
  return {
    sex: row.sex,
    age: row.age,
    heightCm: row.heightCm,
    weightKg: row.weightKg,
    activity: row.activity,
    goal: row.goal,
    updatedAt: toIso(row.updatedAt),
    deletedAt: toIsoOrNull(row.deletedAt),
  };
}

export interface WireSettings {
  locale: SettingsRow['locale'];
  reducedMotion: boolean;
  updatedAt: string;
  deletedAt: string | null;
}

export function serializeSettings(row: SettingsRow): WireSettings {
  return {
    locale: row.locale,
    reducedMotion: row.reducedMotion,
    updatedAt: toIso(row.updatedAt),
    deletedAt: toIsoOrNull(row.deletedAt),
  };
}

export interface WireEntry {
  id: string;
  day: string;
  name: string;
  grams: string;
  kcal: string;
  protein: string;
  carbs: string;
  fat: string;
  meal: EntryRow['meal'];
  source: EntryRow['source'];
  foodId: string | null;
  loggedAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export function serializeEntry(row: EntryRow): WireEntry {
  return {
    id: row.id,
    day: row.day,
    name: row.name,
    grams: row.grams,
    kcal: row.kcal,
    protein: row.protein,
    carbs: row.carbs,
    fat: row.fat,
    meal: row.meal,
    source: row.source,
    foodId: row.foodId,
    loggedAt: toIso(row.loggedAt),
    updatedAt: toIso(row.updatedAt),
    deletedAt: toIsoOrNull(row.deletedAt),
  };
}

export interface WireWeight {
  id: string;
  day: string;
  weightKg: string;
  updatedAt: string;
  deletedAt: string | null;
}

export function serializeWeight(row: WeightRow): WireWeight {
  return {
    id: row.id,
    day: row.day,
    weightKg: row.weightKg,
    updatedAt: toIso(row.updatedAt),
    deletedAt: toIsoOrNull(row.deletedAt),
  };
}

export interface WireCustomFood {
  id: string;
  name: string;
  category: CustomFoodRow['category'];
  kcal: string;
  protein: string;
  carbs: string;
  fat: string;
  commonPortions: unknown;
  updatedAt: string;
  deletedAt: string | null;
}

export function serializeCustomFood(row: CustomFoodRow): WireCustomFood {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    kcal: row.kcal,
    protein: row.protein,
    carbs: row.carbs,
    fat: row.fat,
    commonPortions: row.commonPortions,
    updatedAt: toIso(row.updatedAt),
    deletedAt: toIsoOrNull(row.deletedAt),
  };
}

export interface WireFavourite {
  foodId: string;
  updatedAt: string;
  deletedAt: string | null;
}

export function serializeFavourite(row: FavouriteRow): WireFavourite {
  return {
    foodId: row.foodId,
    updatedAt: toIso(row.updatedAt),
    deletedAt: toIsoOrNull(row.deletedAt),
  };
}
