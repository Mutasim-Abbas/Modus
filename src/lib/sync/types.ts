/**
 * Shared types for the sync engine (`docs/API.md`'s "Sync API" section, `docs/TODO.md`
 * P4.2). Kept dependency-free (no React) so `src/lib/sync/*` stays pure and testable
 * without a DOM.
 */

/** The compound cursor for one of the four id-addressable tables — see docs/API.md
 *  "Cursor semantics": `{ updatedAt, id }`, both ISO strings on the wire. */
export interface RowCursor {
  updatedAt: string;
  id: string;
}

/**
 * A pull cursor — or `serverState`, which has the identical SHAPE but must never be
 * treated as one (docs/API.md "serverState", the internal security audit F-03). Keeping one
 * type for both shapes (rather than two identical interfaces) would invite exactly the
 * mistake F-03 is about, so this file exposes two distinctly-named aliases instead —
 * see `PullCursor` and `ServerStateWatermark` below. Never write a function whose
 * parameter accepts one where the other is meant.
 */
interface SyncWatermarkShape {
  profile: string | null;
  settings: string | null;
  entries: RowCursor | null;
  weights: RowCursor | null;
  customFoods: RowCursor | null;
  favourites: RowCursor | null;
}

/** Only ever assigned from a `GET /api/sync/pull` response's `cursor` field. */
export type PullCursor = SyncWatermarkShape;

/**
 * Only ever assigned from a `POST /api/sync/push` response's `serverState` field.
 * Never compared for equality with, or assigned to, a `PullCursor` variable — see the
 * 🚨 callout above `syncEngine`'s push handling.
 */
export type ServerStateWatermark = SyncWatermarkShape;

export interface TableCounts {
  entries: { total: number; days: number; firstDay: string | null; lastDay: string | null };
  weights: { total: number };
  customFoods: { total: number };
  favourites: { total: number };
  lastChangeAt: string | null;
}

/** A pulled row, still on the wire (numeric fields as decimal strings). */
export interface WireEntry {
  id: string;
  day: string;
  name: string;
  grams: string;
  kcal: string;
  protein: string;
  carbs: string;
  fat: string;
  meal: string;
  source: string;
  foodId: string | null;
  loggedAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface WireWeight {
  id: string;
  day: string;
  weightKg: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface WireCommonPortion {
  label: string;
  grams: number;
}

export interface WireCustomFood {
  id: string;
  name: string;
  category: string;
  kcal: string;
  protein: string;
  carbs: string;
  fat: string;
  commonPortions: WireCommonPortion[];
  updatedAt: string;
  deletedAt: string | null;
}

export interface WireFavourite {
  foodId: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface WireProfile {
  sex: string;
  age: number;
  heightCm: string;
  weightKg: string;
  activity: string;
  goal: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface WireSettings {
  locale: string;
  reducedMotion: boolean;
  updatedAt: string;
  deletedAt: string | null;
}

/** A parsed pull row: numeric fields are real `number`s, everything else preserved. */
export type RemoteEntry = Omit<WireEntry, 'grams' | 'kcal' | 'protein' | 'carbs' | 'fat' | 'loggedAt' | 'updatedAt' | 'deletedAt'> & {
  grams: number;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  loggedAt: number;
  updatedAt: number;
  deletedAt: number | null;
};

export type RemoteWeight = Omit<WireWeight, 'weightKg' | 'updatedAt' | 'deletedAt'> & {
  weightKg: number;
  updatedAt: number;
  deletedAt: number | null;
};

export type RemoteCustomFood = Omit<WireCustomFood, 'kcal' | 'protein' | 'carbs' | 'fat' | 'updatedAt' | 'deletedAt'> & {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  updatedAt: number;
  deletedAt: number | null;
};

export type RemoteFavourite = Omit<WireFavourite, 'updatedAt' | 'deletedAt'> & {
  updatedAt: number;
  deletedAt: number | null;
};

export type RemoteProfile = Omit<WireProfile, 'heightCm' | 'weightKg' | 'updatedAt' | 'deletedAt'> & {
  heightCm: number;
  weightKg: number;
  updatedAt: number;
  deletedAt: number | null;
};

export type RemoteSettings = Omit<WireSettings, 'updatedAt' | 'deletedAt'> & {
  updatedAt: number;
  deletedAt: number | null;
};

export interface PullResult {
  cursor: PullCursor;
  hasMore: { entries: boolean; weights: boolean; customFoods: boolean; favourites: boolean };
  profile: RemoteProfile | null;
  settings: RemoteSettings | null;
  entries: RemoteEntry[];
  weights: RemoteWeight[];
  customFoods: RemoteCustomFood[];
  favourites: RemoteFavourite[];
  counts: TableCounts;
}

/** One row op in a push request body — see docs/API.md "Server assigns every timestamp". */
export type PushEntryOp =
  | { id: string; deleted: true }
  | {
      id: string;
      deleted: false;
      day: string;
      name: string;
      grams: number;
      kcal: number;
      protein: number;
      carbs: number;
      fat: number;
      meal: string;
      source: string;
      foodId: string | null;
      loggedAt: number;
    };

export type PushWeightOp =
  | { id: string; deleted: true }
  | { id: string; deleted: false; day: string; weightKg: number };

export type PushCustomFoodOp =
  | { id: string; deleted: true }
  | {
      id: string;
      deleted: false;
      name: string;
      category: string;
      kcal: number;
      protein: number;
      carbs: number;
      fat: number;
      commonPortions: WireCommonPortion[];
    };

export type PushFavouriteOp = { foodId: string; deleted: boolean };

export type PushProfileOp =
  | { deleted: true }
  | {
      deleted: false;
      sex: string;
      age: number;
      heightCm: number;
      weightKg: number;
      activity: string;
      goal: string;
    };

export type PushSettingsOp = { deleted: true } | { deleted: false; locale: string; reducedMotion: boolean };

export interface PushRequestBody {
  profile?: PushProfileOp | null;
  settings?: PushSettingsOp | null;
  entries?: PushEntryOp[];
  weights?: PushWeightOp[];
  customFoods?: PushCustomFoodOp[];
  favourites?: PushFavouriteOp[];
}

export interface AppliedRow {
  id: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface AppliedFavourite {
  foodId: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface RejectedRow {
  id: string;
  reason: 'owner_conflict' | 'duplicate_day';
}

export interface PushResult {
  /** An informational watermark — NEVER a pull cursor. See `ServerStateWatermark`. */
  serverState: ServerStateWatermark;
  applied: {
    profile: { updatedAt: string; deletedAt: string | null } | null;
    settings: { updatedAt: string; deletedAt: string | null } | null;
    entries: AppliedRow[];
    weights: AppliedRow[];
    customFoods: AppliedRow[];
    favourites: AppliedFavourite[];
  };
  rejected: {
    entries: RejectedRow[];
    weights: RejectedRow[];
    customFoods: RejectedRow[];
    favourites: never[];
  };
}
