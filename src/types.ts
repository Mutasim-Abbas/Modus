/** Shared domain types. Kept dependency-free so lib/ and data/ stay pure. */

export type Sex = 'male' | 'female';

export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'very' | 'extra';

export type Goal = 'cut' | 'maintain' | 'bulk';

export interface Profile {
  sex: Sex;
  /** years */
  age: number;
  /** centimetres */
  heightCm: number;
  /** kilograms */
  weightKg: number;
  activity: ActivityLevel;
  goal: Goal;
}

/** Grams of each macro plus the calories they add up to. */
export interface Macros {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface Targets extends Macros {
  bmr: number;
  tdee: number;
}

export type FoodCategory =
  | 'protein'
  | 'grains'
  | 'dairy'
  | 'fruit'
  | 'vegetables'
  | 'fats & nuts'
  | 'snacks'
  | 'drinks'
  | 'turkish & middle eastern';

export interface CommonPortion {
  label: string;
  grams: number;
}

/**
 * Approximate reference values per 100 g. See data/foods.ts for the basis and
 * the honesty note shown in the UI.
 */
export interface Food {
  id: string;
  name: string;
  category: FoodCategory;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  per: 100;
  commonPortions: CommonPortion[];
}

export type MealSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack';

/** How a logged entry got its numbers — surfaced in the UI, never hidden. */
export type EntrySource = 'food-db' | 'scan' | 'manual';

export interface LogEntry {
  id: string;
  /** Food id when source is 'food-db'; absent for scanned/manual entries. */
  foodId?: string;
  name: string;
  grams: number;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  meal: MealSlot;
  source: EntrySource;
  /** epoch ms — when this entry was logged. */
  loggedAt: number;
  /** epoch ms — bumped on every edit. Mirrors `docs/DB.md`'s sync trio (updated_at). */
  updatedAt: number;
  /**
   * epoch ms tombstone, or `null` while live. A deleted entry is kept (not spliced out
   * of storage) so a future sync push can propagate the delete instead of resurrecting
   * it — see `docs/DB.md` §2.4. `lib/store.ts`'s selectors filter these out; nothing
   * else in the app should read a `LogEntry` without going through a selector.
   */
  deletedAt: number | null;
}

/** ISO date key, `YYYY-MM-DD`, in the user's local timezone. */
export type DayKey = string;

export interface DayLog {
  date: DayKey;
  entries: LogEntry[];
}

/** A body-weight log entry. One live entry per day (docs/DB.md §4.6). */
export interface WeightEntry {
  id: string;
  day: DayKey;
  /** kilograms */
  weightKg: number;
  updatedAt: number;
  deletedAt: number | null;
}

/**
 * A user-entered food, same per-100g shape as the built-in `Food` database, minus the
 * fixed `per: 100` contract (docs/DB.md §4.7). Always rendered with a "your food" badge
 * in the UI — the honesty rule about invented precision applies to the user's own
 * numbers too (the project brief).
 */
export interface CustomFood {
  id: string;
  name: string;
  category: FoodCategory;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  per: 100;
  commonPortions: CommonPortion[];
  updatedAt: number;
  deletedAt: number | null;
}

/**
 * A favourited food — built-in (`Food.id`) or user-entered (`CustomFood.id`); the two
 * id spaces don't collide today (built-in ids are kebab-case slugs, custom ids are
 * UUIDs) but nothing here enforces that, mirroring `entries.foodId`'s deliberate lack
 * of a foreign key (docs/DB.md §4.5, §4.8).
 */
export interface Favourite {
  foodId: string;
  updatedAt: number;
  deletedAt: number | null;
}

export interface Settings {
  /** Reserved for a future imperial toggle; metric is the only implemented unit today. */
  units: 'metric';
  reducedMotion: boolean;
}

export interface AppState {
  version: number;
  profile: Profile | null;
  targets: Targets | null;
  days: Record<DayKey, DayLog>;
  weights: WeightEntry[];
  customFoods: CustomFood[];
  favourites: Favourite[];
  settings: Settings;
}

/** One item as estimated by the AI scan. Always editable before it is logged. */
export interface AnalyzedItem {
  name: string;
  grams: number;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  /** 0..1 — the model's own stated confidence. Displayed, never hidden. */
  confidence: number;
}

export interface AnalyzeMealResponse {
  items: AnalyzedItem[];
  totals: Macros;
  note: string;
}
