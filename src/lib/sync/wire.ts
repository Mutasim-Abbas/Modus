import type {
  PullCursor,
  PullResult,
  RemoteCustomFood,
  RemoteEntry,
  RemoteFavourite,
  RemoteProfile,
  RemoteSettings,
  RemoteWeight,
  RowCursor,
  ServerStateWatermark,
  TableCounts,
  WireCommonPortion,
} from '@/lib/sync/types';

/**
 * Wire-format parsing for `GET /api/sync/pull` / `POST /api/sync/push` responses.
 *
 * Every value here is untrusted server input, handled the same way `src/lib/store.ts`
 * treats localStorage: validated field by field, degrading to a safe default rather
 * than throwing, so one malformed row cannot take down the whole sync cycle.
 *
 * docs/API.md, "Numeric fields are decimal strings, not numbers — on the wire, both
 * ways": every macro/weight/height field arrives as an exact decimal string
 * (`"248.00"`) on pull and must be `Number(x)`'d — never parsed with anything that
 * could introduce float drift beyond what `Number()` itself does (which is exact for
 * every value Postgres's `numeric` type can emit at the scales this schema uses).
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function nullableStr(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** Decimal-string -> number. `NaN`/non-string input falls back to `0`, never crashes. */
function decimal(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function bool(value: unknown): boolean {
  return value === true;
}

function nullableFoodId(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function parseCommonPortions(value: unknown): WireCommonPortion[] {
  if (!Array.isArray(value)) return [];
  const portions: WireCommonPortion[] = [];
  for (const raw of value) {
    if (!isRecord(raw)) continue;
    const label = str(raw.label);
    const grams = num(raw.grams);
    if (!label || grams <= 0) continue;
    portions.push({ label, grams });
  }
  return portions;
}

function parseRowCursor(value: unknown): RowCursor | null {
  if (!isRecord(value)) return null;
  const updatedAt = str(value.updatedAt);
  const id = str(value.id);
  if (!updatedAt || !id) return null;
  return { updatedAt, id };
}

/** Shared by both `PullCursor` and `ServerStateWatermark` — identical shape, see
 *  `src/lib/sync/types.ts`'s comment on why they are still two distinct type names. */
function parseWatermark(value: unknown): PullCursor {
  const record = isRecord(value) ? value : {};
  return {
    profile: nullableStr(record.profile),
    settings: nullableStr(record.settings),
    entries: parseRowCursor(record.entries),
    weights: parseRowCursor(record.weights),
    customFoods: parseRowCursor(record.customFoods),
    favourites: parseRowCursor(record.favourites),
  };
}

export function parsePullCursor(value: unknown): PullCursor {
  return parseWatermark(value);
}

export function parseServerState(value: unknown): ServerStateWatermark {
  return parseWatermark(value);
}

function parseEntry(value: unknown): RemoteEntry | null {
  if (!isRecord(value)) return null;
  const id = str(value.id);
  const updatedAt = str(value.updatedAt);
  if (!id || !updatedAt) return null;
  return {
    id,
    day: str(value.day),
    name: str(value.name),
    grams: decimal(value.grams),
    kcal: decimal(value.kcal),
    protein: decimal(value.protein),
    carbs: decimal(value.carbs),
    fat: decimal(value.fat),
    meal: str(value.meal, 'snack'),
    source: str(value.source, 'manual'),
    foodId: nullableFoodId(value.foodId),
    loggedAt: num(value.loggedAt),
    updatedAt: Date.parse(updatedAt),
    deletedAt: typeof value.deletedAt === 'string' ? Date.parse(value.deletedAt) : null,
  };
}

function parseWeight(value: unknown): RemoteWeight | null {
  if (!isRecord(value)) return null;
  const id = str(value.id);
  const updatedAt = str(value.updatedAt);
  if (!id || !updatedAt) return null;
  return {
    id,
    day: str(value.day),
    weightKg: decimal(value.weightKg),
    updatedAt: Date.parse(updatedAt),
    deletedAt: typeof value.deletedAt === 'string' ? Date.parse(value.deletedAt) : null,
  };
}

function parseCustomFood(value: unknown): RemoteCustomFood | null {
  if (!isRecord(value)) return null;
  const id = str(value.id);
  const updatedAt = str(value.updatedAt);
  if (!id || !updatedAt) return null;
  return {
    id,
    name: str(value.name),
    category: str(value.category, 'snacks'),
    kcal: decimal(value.kcal),
    protein: decimal(value.protein),
    carbs: decimal(value.carbs),
    fat: decimal(value.fat),
    commonPortions: parseCommonPortions(value.commonPortions),
    updatedAt: Date.parse(updatedAt),
    deletedAt: typeof value.deletedAt === 'string' ? Date.parse(value.deletedAt) : null,
  };
}

function parseFavourite(value: unknown): RemoteFavourite | null {
  if (!isRecord(value)) return null;
  const foodId = str(value.foodId);
  const updatedAt = str(value.updatedAt);
  if (!foodId || !updatedAt) return null;
  return {
    foodId,
    updatedAt: Date.parse(updatedAt),
    deletedAt: typeof value.deletedAt === 'string' ? Date.parse(value.deletedAt) : null,
  };
}

function parseProfile(value: unknown): RemoteProfile | null {
  if (!isRecord(value)) return null;
  const updatedAt = str(value.updatedAt);
  if (!updatedAt) return null;
  return {
    sex: str(value.sex, 'male'),
    age: num(value.age),
    heightCm: decimal(value.heightCm),
    weightKg: decimal(value.weightKg),
    activity: str(value.activity, 'sedentary'),
    goal: str(value.goal, 'maintain'),
    updatedAt: Date.parse(updatedAt),
    deletedAt: typeof value.deletedAt === 'string' ? Date.parse(value.deletedAt) : null,
  };
}

function parseSettings(value: unknown): RemoteSettings | null {
  if (!isRecord(value)) return null;
  const updatedAt = str(value.updatedAt);
  if (!updatedAt) return null;
  return {
    locale: str(value.locale, 'en'),
    reducedMotion: bool(value.reducedMotion),
    updatedAt: Date.parse(updatedAt),
    deletedAt: typeof value.deletedAt === 'string' ? Date.parse(value.deletedAt) : null,
  };
}

function parseCounts(value: unknown): TableCounts {
  const record = isRecord(value) ? value : {};
  const entries = isRecord(record.entries) ? record.entries : {};
  const weights = isRecord(record.weights) ? record.weights : {};
  const customFoods = isRecord(record.customFoods) ? record.customFoods : {};
  const favourites = isRecord(record.favourites) ? record.favourites : {};
  return {
    entries: {
      total: num(entries.total),
      days: num(entries.days),
      firstDay: nullableStr(entries.firstDay),
      lastDay: nullableStr(entries.lastDay),
    },
    weights: { total: num(weights.total) },
    customFoods: { total: num(customFoods.total) },
    favourites: { total: num(favourites.total) },
    lastChangeAt: nullableStr(record.lastChangeAt),
  };
}

export function parsePullResult(value: unknown): PullResult {
  const record = isRecord(value) ? value : {};
  const hasMoreRaw = isRecord(record.hasMore) ? record.hasMore : {};

  return {
    cursor: parsePullCursor(record.cursor),
    hasMore: {
      entries: bool(hasMoreRaw.entries),
      weights: bool(hasMoreRaw.weights),
      customFoods: bool(hasMoreRaw.customFoods),
      favourites: bool(hasMoreRaw.favourites),
    },
    profile: parseProfile(record.profile),
    settings: parseSettings(record.settings),
    entries: Array.isArray(record.entries)
      ? record.entries.map(parseEntry).filter((e): e is RemoteEntry => e !== null)
      : [],
    weights: Array.isArray(record.weights)
      ? record.weights.map(parseWeight).filter((w): w is RemoteWeight => w !== null)
      : [],
    customFoods: Array.isArray(record.customFoods)
      ? record.customFoods.map(parseCustomFood).filter((f): f is RemoteCustomFood => f !== null)
      : [],
    favourites: Array.isArray(record.favourites)
      ? record.favourites.map(parseFavourite).filter((f): f is RemoteFavourite => f !== null)
      : [],
    counts: parseCounts(record.counts),
  };
}
