import type {
  ActivityLevel,
  AppState,
  CommonPortion,
  CustomFood,
  DayKey,
  DayLog,
  EntrySource,
  Favourite,
  FoodCategory,
  Goal,
  LogEntry,
  MealSlot,
  Profile,
  Settings,
  Targets,
  WeightEntry,
} from '@/types';
import { calculateTargets } from '@/lib/macros';
import { isDayKey, toDayKey } from '@/lib/date';

/**
 * Typed, versioned localStorage persistence.
 *
 * Everything read back from storage is treated as untrusted input and validated
 * field by field: a corrupt or hand-edited blob degrades to defaults instead of
 * crashing the app. Bump SCHEMA_VERSION and add a migration when the shape changes.
 */

// The storage key is a fixed identifier, not a version label — it must never change,
// or every existing user's data becomes unreachable on their next visit. Schema
// evolution happens entirely through `version` inside the stored blob + MIGRATIONS.
export const STORAGE_KEY = 'fitmacro.v2';
export const SCHEMA_VERSION = 3;

const DEFAULT_SETTINGS: Settings = { units: 'metric', reducedMotion: false };

export function defaultState(): AppState {
  return {
    version: SCHEMA_VERSION,
    profile: null,
    targets: null,
    days: {},
    weights: [],
    customFoods: [],
    favourites: [],
    settings: DEFAULT_SETTINGS,
  };
}

/* ------------------------------------------------------------------ *
 * Validation helpers — the trust boundary between storage and the app *
 * ------------------------------------------------------------------ */

const SEXES = ['male', 'female'] as const;
const ACTIVITIES: readonly ActivityLevel[] = ['sedentary', 'light', 'moderate', 'very', 'extra'];
const GOALS: readonly Goal[] = ['cut', 'maintain', 'bulk'];
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A tombstone timestamp: a finite number, or `null` while the row is live. */
function nullableTimestamp(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

function parseProfile(value: unknown): Profile | null {
  if (!isRecord(value)) return null;
  const age = num(value.age);
  const heightCm = num(value.heightCm);
  const weightKg = num(value.weightKg);
  if (age <= 0 || heightCm <= 0 || weightKg <= 0) return null;

  return {
    sex: oneOf(value.sex, SEXES, 'male'),
    age,
    heightCm,
    weightKg,
    activity: oneOf(value.activity, ACTIVITIES, 'sedentary'),
    goal: oneOf(value.goal, GOALS, 'maintain'),
  };
}

function parseEntry(value: unknown): LogEntry | null {
  if (!isRecord(value)) return null;
  const name = typeof value.name === 'string' ? value.name.trim() : '';
  if (!name) return null;

  const foodId = typeof value.foodId === 'string' ? value.foodId : undefined;
  const loggedAt = num(value.loggedAt, Date.now());
  const entry: LogEntry = {
    id: typeof value.id === 'string' && value.id ? value.id : createId(),
    name,
    grams: Math.max(0, num(value.grams)),
    kcal: Math.max(0, num(value.kcal)),
    protein: Math.max(0, num(value.protein)),
    carbs: Math.max(0, num(value.carbs)),
    fat: Math.max(0, num(value.fat)),
    meal: oneOf(value.meal, MEALS, 'snack'),
    source: oneOf(value.source, SOURCES, 'manual'),
    loggedAt,
    // A v2 entry (or any payload written before this field existed) has never been
    // edited since it was logged — `loggedAt` is the honest default, not `Date.now()`.
    updatedAt: num(value.updatedAt, loggedAt),
    deletedAt: nullableTimestamp(value.deletedAt),
  };
  return foodId === undefined ? entry : { ...entry, foodId };
}

function parseDays(value: unknown): Record<DayKey, DayLog> {
  if (!isRecord(value)) return {};
  const days: Record<DayKey, DayLog> = {};

  for (const [key, raw] of Object.entries(value)) {
    if (!isDayKey(key) || !isRecord(raw)) continue;
    const rawEntries = Array.isArray(raw.entries) ? raw.entries : [];
    const entries = rawEntries
      .map(parseEntry)
      .filter((entry): entry is LogEntry => entry !== null);
    days[key] = { date: key, entries };
  }
  return days;
}

function parseWeight(value: unknown): WeightEntry | null {
  if (!isRecord(value)) return null;
  if (!isDayKey(value.day)) return null;
  const weightKg = num(value.weightKg);
  if (weightKg <= 0) return null;

  return {
    id: typeof value.id === 'string' && value.id ? value.id : createId(),
    day: value.day,
    weightKg,
    updatedAt: num(value.updatedAt, Date.now()),
    deletedAt: nullableTimestamp(value.deletedAt),
  };
}

function parseWeights(value: unknown): WeightEntry[] {
  if (!Array.isArray(value)) return [];
  return value.map(parseWeight).filter((w): w is WeightEntry => w !== null);
}

function parseCommonPortions(value: unknown): CommonPortion[] {
  if (!Array.isArray(value)) return [];
  const portions: CommonPortion[] = [];
  for (const raw of value) {
    if (!isRecord(raw)) continue;
    const label = typeof raw.label === 'string' ? raw.label.trim() : '';
    const grams = num(raw.grams);
    if (!label || grams <= 0) continue;
    portions.push({ label, grams });
  }
  return portions;
}

function parseCustomFood(value: unknown): CustomFood | null {
  if (!isRecord(value)) return null;
  const name = typeof value.name === 'string' ? value.name.trim() : '';
  if (!name) return null;

  return {
    id: typeof value.id === 'string' && value.id ? value.id : createId(),
    name,
    category: oneOf(value.category, CATEGORIES, 'snacks'),
    kcal: Math.max(0, num(value.kcal)),
    protein: Math.max(0, num(value.protein)),
    carbs: Math.max(0, num(value.carbs)),
    fat: Math.max(0, num(value.fat)),
    per: 100,
    commonPortions: parseCommonPortions(value.commonPortions),
    updatedAt: num(value.updatedAt, Date.now()),
    deletedAt: nullableTimestamp(value.deletedAt),
  };
}

function parseCustomFoods(value: unknown): CustomFood[] {
  if (!Array.isArray(value)) return [];
  return value.map(parseCustomFood).filter((f): f is CustomFood => f !== null);
}

function parseFavourite(value: unknown): Favourite | null {
  if (!isRecord(value)) return null;
  const foodId = typeof value.foodId === 'string' ? value.foodId.trim() : '';
  if (!foodId) return null;

  return {
    foodId,
    updatedAt: num(value.updatedAt, Date.now()),
    deletedAt: nullableTimestamp(value.deletedAt),
  };
}

function parseFavourites(value: unknown): Favourite[] {
  if (!Array.isArray(value)) return [];
  const favourites = value.map(parseFavourite).filter((f): f is Favourite => f !== null);
  // Guard the natural-key uniqueness docs/DB.md relies on (composite PK there; here just
  // "one row per foodId") in case a corrupted/hand-edited blob has duplicates — keep the
  // most recently updated row per foodId, exactly what an upsert-on-conflict would leave.
  const byFoodId = new Map<string, Favourite>();
  for (const favourite of favourites) {
    const current = byFoodId.get(favourite.foodId);
    if (!current || favourite.updatedAt >= current.updatedAt) byFoodId.set(favourite.foodId, favourite);
  }
  return Array.from(byFoodId.values());
}

function parseSettings(value: unknown): Settings {
  if (!isRecord(value)) return DEFAULT_SETTINGS;
  return {
    units: 'metric',
    reducedMotion: value.reducedMotion === true,
  };
}

function parseTargets(value: unknown, profile: Profile | null): Targets | null {
  if (isRecord(value) && num(value.kcal) > 0) {
    return {
      bmr: Math.max(0, num(value.bmr)),
      tdee: Math.max(0, num(value.tdee)),
      kcal: num(value.kcal),
      protein: Math.max(0, num(value.protein)),
      carbs: Math.max(0, num(value.carbs)),
      fat: Math.max(0, num(value.fat)),
    };
  }
  // Targets are derivable — recompute rather than lose the user's setup.
  return profile ? calculateTargets(profile) : null;
}

/* --------------------------------- *
 * Migration                          *
 * --------------------------------- */

/**
 * A migration step transforms a stored blob from one schema version to the next.
 * Registered per source version; `migrate` walks the chain until SCHEMA_VERSION.
 */
const MIGRATIONS: Record<number, (raw: Record<string, unknown>) => Record<string, unknown>> = {
  // v2 -> v3: adds three new top-level collections (weights, customFoods, favourites)
  // and, on every LogEntry, `updatedAt`/`deletedAt`. The entry-level fields are *not*
  // rewritten here — `parseEntry` (used uniformly by every version, old or new) already
  // backfills them field-by-field with the same honest default this step would use, so
  // duplicating that logic here would just be a second place for it to drift. What this
  // step alone is responsible for is the shape hydrate() can't infer: the three
  // collections simply didn't exist in v2, so there is nothing to read them from.
  2: (raw) => ({
    ...raw,
    version: 3,
    weights: Array.isArray(raw.weights) ? raw.weights : [],
    customFoods: Array.isArray(raw.customFoods) ? raw.customFoods : [],
    favourites: Array.isArray(raw.favourites) ? raw.favourites : [],
  }),
};

/**
 * Brings any persisted blob up to SCHEMA_VERSION, then validates it.
 *
 * Blobs written by a *newer* build are hydrated on a best-effort basis: we read the
 * fields we understand and drop the rest, which is preferable to wiping the user's log.
 */
export function migrate(raw: unknown): AppState {
  if (!isRecord(raw)) return defaultState();

  let working = raw;
  let version = num(working.version, SCHEMA_VERSION);

  while (version < SCHEMA_VERSION) {
    const step = MIGRATIONS[version];
    if (!step) break; // Unknown legacy shape — hydrate() below salvages what it can.
    working = step(working);
    version += 1;
  }

  return hydrate(working);
}

function hydrate(raw: Record<string, unknown>): AppState {
  const profile = parseProfile(raw.profile);
  return {
    version: SCHEMA_VERSION,
    profile,
    targets: parseTargets(raw.targets, profile),
    days: parseDays(raw.days),
    weights: parseWeights(raw.weights),
    customFoods: parseCustomFoods(raw.customFoods),
    favourites: parseFavourites(raw.favourites),
    settings: parseSettings(raw.settings),
  };
}

/* --------------------------------- *
 * Storage I/O                        *
 * --------------------------------- */

function safeStorage(): Storage | null {
  try {
    const probe = '__fitmacro_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    // Private mode / disabled storage: the app still runs, in-memory only.
    return null;
  }
}

export function loadState(): AppState {
  const storage = safeStorage();
  if (!storage) return defaultState();

  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    return migrate(JSON.parse(raw) as unknown);
  } catch {
    return defaultState();
  }
}

export function saveState(state: AppState): boolean {
  const storage = safeStorage();
  if (!storage) return false;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

/**
 * UUIDv7-style id: a 48-bit millisecond timestamp in the high bits followed by random
 * bits, so ids sort chronologically as plain strings — unlike v4, which is fully
 * random. This matters once sync lands (the project plan §2, `docs/DB.md` §2.3): these
 * are the client-generated ids for `entries`/`weights`/`custom_foods` rows, and a
 * time-ordered id is easier to reason about in logs and query plans than a random one.
 * Falls back to a non-UUID-shaped but still-unique string when `crypto.getRandomValues`
 * isn't available; that fallback was already the v2 behaviour for the no-`crypto` case.
 */
export function createId(): string {
  if (typeof crypto === 'undefined' || typeof crypto.getRandomValues !== 'function') {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);

  const timestamp = Date.now();
  bytes[0] = (timestamp / 2 ** 40) & 0xff;
  bytes[1] = (timestamp / 2 ** 32) & 0xff;
  bytes[2] = (timestamp / 2 ** 24) & 0xff;
  bytes[3] = (timestamp / 2 ** 16) & 0xff;
  bytes[4] = (timestamp / 2 ** 8) & 0xff;
  bytes[5] = timestamp & 0xff;

  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70; // version 7
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80; // variant 10 (RFC 4122)

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/* --------------------------------- *
 * Store                              *
 * --------------------------------- */

type Listener = () => void;

export type EditableEntryFields = Partial<
  Pick<LogEntry, 'name' | 'grams' | 'kcal' | 'protein' | 'carbs' | 'fat' | 'meal' | 'source' | 'foodId'>
>;

export type NewCustomFood = Omit<CustomFood, 'id' | 'updatedAt' | 'deletedAt'>;
export type EditableCustomFoodFields = Partial<NewCustomFood>;

export interface Store {
  getState: () => AppState;
  subscribe: (listener: Listener) => () => void;
  setProfile: (profile: Profile) => void;
  addEntry: (entry: Omit<LogEntry, 'id' | 'loggedAt' | 'updatedAt' | 'deletedAt'>, date?: DayKey) => LogEntry;
  /** Patches a live entry's fields on a given day. No-op (returns null) if not found. */
  updateEntry: (id: string, patch: EditableEntryFields, date?: DayKey) => LogEntry | null;
  removeEntry: (id: string, date?: DayKey) => void;
  /** Copies every live entry from one day onto another (e.g. "copy yesterday"). Each
   *  copy gets a fresh id/timestamps — it is a new entry, not a shared reference. */
  copyDay: (fromDate: DayKey, toDate?: DayKey) => LogEntry[];
  /** Upserts the day's live weigh-in (one live entry per day, docs/DB.md §4.6). */
  logWeight: (weightKg: number, date?: DayKey) => WeightEntry;
  removeWeight: (id: string) => void;
  addCustomFood: (food: NewCustomFood) => CustomFood;
  updateCustomFood: (id: string, patch: EditableCustomFoodFields) => CustomFood | null;
  removeCustomFood: (id: string) => void;
  /** Toggles a favourite on/off for a food id (built-in or custom). */
  toggleFavourite: (foodId: string) => void;
  setSettings: (patch: Partial<Settings>) => void;
  exportJSON: () => string;
  reset: () => void;
  /** True when writes are not reaching localStorage (private mode, quota, etc.). */
  isPersisted: () => boolean;
  /**
   * Sync-only: replaces the synced collections wholesale with values that are already
   * authoritative — either freshly merged from a `GET /api/sync/pull` response
   * (`src/lib/sync/applyRemote.ts`), or the outcome of an explicit `/sync/merge`
   * decision (`src/lib/sync/adoption.ts`). Unlike every mutator above, this never bumps
   * `updatedAt`/`loggedAt` and never generates a new id — the values it's given already
   * carry the correct timestamps (the server's, or the local ones being kept as-is), and
   * re-stamping them here would make this device's own merge indistinguishable from a
   * fresh edit on the very next sync cycle. Never called by ordinary UI actions.
   */
  replaceSyncedState: (
    patch: Partial<Pick<AppState, 'profile' | 'days' | 'weights' | 'customFoods' | 'favourites' | 'settings'>>,
  ) => void;
}

export function createStore(initial: AppState = loadState()): Store {
  let state: AppState = initial;
  let persisted = true;
  const listeners = new Set<Listener>();

  const commit = (next: AppState): void => {
    state = next;
    persisted = saveState(state);
    listeners.forEach((listener) => listener());
  };

  const dayOf = (state: AppState, date: DayKey): DayLog => state.days[date] ?? { date, entries: [] };

  return {
    getState: () => state,

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    setProfile(profile) {
      commit({ ...state, profile, targets: calculateTargets(profile) });
    },

    addEntry(input, date = toDayKey()) {
      const now = Date.now();
      const entry: LogEntry = { ...input, id: createId(), loggedAt: now, updatedAt: now, deletedAt: null };
      const day = dayOf(state, date);
      commit({
        ...state,
        days: { ...state.days, [date]: { date, entries: [...day.entries, entry] } },
      });
      return entry;
    },

    updateEntry(id, patch, date = toDayKey()) {
      const day = state.days[date];
      const existing = day?.entries.find((entry) => entry.id === id && entry.deletedAt === null);
      if (!day || !existing) return null;

      const updated: LogEntry = { ...existing, ...patch, id: existing.id, updatedAt: Date.now() };
      const entries = day.entries.map((entry) => (entry.id === id ? updated : entry));
      commit({ ...state, days: { ...state.days, [date]: { date, entries } } });
      return updated;
    },

    removeEntry(id, date = toDayKey()) {
      const day = state.days[date];
      const existing = day?.entries.find((entry) => entry.id === id && entry.deletedAt === null);
      if (!day || !existing) return;

      const now = Date.now();
      const entries = day.entries.map((entry) =>
        entry.id === id ? { ...entry, deletedAt: now, updatedAt: now } : entry,
      );
      commit({ ...state, days: { ...state.days, [date]: { date, entries } } });
    },

    copyDay(fromDate, toDate = toDayKey()) {
      const liveSourceEntries = (state.days[fromDate]?.entries ?? []).filter(
        (entry) => entry.deletedAt === null,
      );
      if (liveSourceEntries.length === 0) return [];

      const now = Date.now();
      const copies: LogEntry[] = liveSourceEntries.map((entry) => ({
        ...entry,
        id: createId(),
        loggedAt: now,
        updatedAt: now,
        deletedAt: null,
      }));

      const targetDay = dayOf(state, toDate);
      commit({
        ...state,
        days: { ...state.days, [toDate]: { date: toDate, entries: [...targetDay.entries, ...copies] } },
      });
      return copies;
    },

    logWeight(weightKg, date = toDayKey()) {
      const now = Date.now();
      const existingLive = state.weights.find((w) => w.day === date && w.deletedAt === null);

      let result: WeightEntry;
      let weights: WeightEntry[];
      if (existingLive) {
        result = { ...existingLive, weightKg, updatedAt: now };
        weights = state.weights.map((w) => (w.id === existingLive.id ? result : w));
      } else {
        result = { id: createId(), day: date, weightKg, updatedAt: now, deletedAt: null };
        weights = [...state.weights, result];
      }

      commit({ ...state, weights });
      return result;
    },

    removeWeight(id) {
      const existing = state.weights.find((w) => w.id === id && w.deletedAt === null);
      if (!existing) return;

      const now = Date.now();
      const weights = state.weights.map((w) =>
        w.id === id ? { ...w, deletedAt: now, updatedAt: now } : w,
      );
      commit({ ...state, weights });
    },

    addCustomFood(food) {
      const now = Date.now();
      const created: CustomFood = { ...food, id: createId(), updatedAt: now, deletedAt: null };
      commit({ ...state, customFoods: [...state.customFoods, created] });
      return created;
    },

    updateCustomFood(id, patch) {
      const existing = state.customFoods.find((food) => food.id === id && food.deletedAt === null);
      if (!existing) return null;

      const updated: CustomFood = { ...existing, ...patch, id: existing.id, updatedAt: Date.now() };
      const customFoods = state.customFoods.map((food) => (food.id === id ? updated : food));
      commit({ ...state, customFoods });
      return updated;
    },

    removeCustomFood(id) {
      const existing = state.customFoods.find((food) => food.id === id && food.deletedAt === null);
      if (!existing) return;

      const now = Date.now();
      const customFoods = state.customFoods.map((food) =>
        food.id === id ? { ...food, deletedAt: now, updatedAt: now } : food,
      );
      commit({ ...state, customFoods });
    },

    toggleFavourite(foodId) {
      const now = Date.now();
      const existing = state.favourites.find((f) => f.foodId === foodId);

      let favourites: Favourite[];
      if (existing) {
        const nowLive = existing.deletedAt !== null;
        const updated: Favourite = { foodId, updatedAt: now, deletedAt: nowLive ? null : now };
        favourites = state.favourites.map((f) => (f.foodId === foodId ? updated : f));
      } else {
        favourites = [...state.favourites, { foodId, updatedAt: now, deletedAt: null }];
      }

      commit({ ...state, favourites });
    },

    setSettings(patch) {
      commit({ ...state, settings: { ...state.settings, ...patch } });
    },

    exportJSON() {
      return JSON.stringify(state, null, 2);
    },

    replaceSyncedState(patch) {
      const nextProfile = 'profile' in patch ? patch.profile ?? null : state.profile;
      commit({
        ...state,
        ...patch,
        targets: nextProfile ? calculateTargets(nextProfile) : null,
      });
    },

    reset() {
      const storage = safeStorage();
      try {
        storage?.removeItem(STORAGE_KEY);
      } catch {
        /* nothing more we can do; in-memory reset below still applies */
      }
      state = defaultState();
      persisted = true;
      listeners.forEach((listener) => listener());
    },

    isPersisted: () => persisted,
  };
}

/** The app-wide store instance. Tests create their own via createStore(). */
export const store = createStore();

/* --------------------------------- *
 * Selectors (pure)                   *
 * --------------------------------- */

export function selectDay(state: AppState, date: DayKey): DayLog {
  const entries = (state.days[date]?.entries ?? []).filter((entry) => entry.deletedAt === null);
  return { date, entries };
}

/** Days that have at least one live entry, newest first. */
export function selectLoggedDays(state: AppState): DayLog[] {
  return Object.values(state.days)
    .map((day) => ({ date: day.date, entries: day.entries.filter((entry) => entry.deletedAt === null) }))
    .filter((day) => day.entries.length > 0)
    .sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Live weigh-ins, one per day, oldest first (chart-ready order). Defensively dedupes
 * by day (keeping the most recently updated row) in case a corrupted/hand-edited blob
 * ever has more than one live row for the same day — the real invariant `docs/DB.md`
 * §4.6 enforces with a partial unique index, re-applied here for storage the database
 * never touched.
 */
export function selectLiveWeights(state: AppState): WeightEntry[] {
  const byDay = new Map<DayKey, WeightEntry>();
  for (const weight of state.weights) {
    if (weight.deletedAt !== null) continue;
    const current = byDay.get(weight.day);
    if (!current || weight.updatedAt >= current.updatedAt) byDay.set(weight.day, weight);
  }
  return Array.from(byDay.values()).sort((a, b) => a.day.localeCompare(b.day));
}

export function selectWeightForDay(state: AppState, date: DayKey): WeightEntry | null {
  return state.weights
    .filter((w) => w.day === date && w.deletedAt === null)
    .sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null;
}

export function selectCustomFoods(state: AppState): CustomFood[] {
  return state.customFoods.filter((food) => food.deletedAt === null);
}

export function selectFavouriteIds(state: AppState): string[] {
  return state.favourites.filter((f) => f.deletedAt === null).map((f) => f.foodId);
}

export function isFavourite(state: AppState, foodId: string): boolean {
  return state.favourites.some((f) => f.foodId === foodId && f.deletedAt === null);
}
