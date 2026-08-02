/**
 * Zod schemas for `api/sync/pull` and `api/sync/push` (`P2.3`).
 *
 * Two rules shape every schema here, both non-negotiable per `docs/TODO.md` P2.3:
 *
 * 1. **The server assigns every timestamp that governs sync ordering.** A push payload
 *    never carries a client `updatedAt`/`deletedAt` value — it carries a `deleted`
 *    boolean (the client's *intent*), and the handler is what stamps `now()` on it
 *    (via `db.insert(...).values(...)` for `deleted_at`, and unconditionally by
 *    `fitmacro_set_updated_at()` for `updated_at` — see `docs/DB.md` §3). This is
 *    stricter than just "the trigger would win anyway": it means there is no client
 *    timestamp anywhere in this file to even be tempted to trust.
 *    The one deliberate exception is `entries.day` / `weights.day` / `entries.loggedAt`
 *    — domain data the user controls on purpose (backdating), identical to the
 *    exception `docs/DB.md` §2.1 already carves out at the schema layer.
 * 2. **Every bound mirrors a real `CHECK` constraint in `api/_lib/db/schema.ts`.** This
 *    is defense in depth, not a replacement for it: a request that would fail the
 *    database's own constraint fails here first, as a clean `400 invalid_input`
 *    instead of a raw Postgres error reaching `api/sync/push.ts`'s catch-all.
 *
 * Every object schema is `.strict()` — the same mass-assignment guard
 * `api/_lib/auth/schemas.ts` documents: an unrecognised key (e.g. a smuggled `userId`)
 * is a validation failure, not a silently-ignored extra field.
 */

import { z } from 'zod';

/* ------------------------------------------------------------------ *
 * Shared primitives                                                    *
 * ------------------------------------------------------------------ */

/** Client-generated UUID (entries/weights/custom_foods ids) — docs/DB.md §2.3. */
const idSchema = z.uuid();

/**
 * `YYYY-MM-DD`, calendar-valid (z.iso.date rejects e.g. 2026-02-30) **and** inside a range
 * Postgres will actually accept.
 *
 * SECURITY — the internal security audit F-08. `z.iso.date()` alone accepts `0000-01-01`: calendar-
 * valid by the grammar, but Postgres has no year zero and rejects the INSERT outright,
 * so the row reached `api/sync/push.ts`'s catch-all and returned `500` from a boundary
 * this document promises is a `400`. The bounds are deliberately far wider than any real
 * food log (a birth-year weigh-in through the next century) — this is a "Postgres will
 * take it" guard, not a business rule, and it must never be tightened into one.
 *
 * String comparison is correct here, not lazy: `YYYY-MM-DD` is fixed-width and
 * zero-padded, so lexicographic order IS chronological order, and `z.iso.date()` has
 * already guaranteed that shape before this refinement runs.
 */
const MIN_DAY = '1900-01-01';
const MAX_DAY = '2100-12-31';
const daySchema = z
  .iso
  .date()
  .refine((d) => d >= MIN_DAY && d <= MAX_DAY, `day must be between ${MIN_DAY} and ${MAX_DAY}`);

/**
 * Epoch milliseconds, matching `src/types.ts`'s `LogEntry.loggedAt` exactly. Bounded to
 * roughly year 2000–2100 — generous for real data, tight enough to catch an obviously
 * wrong unit (e.g. seconds instead of milliseconds).
 */
const epochMsSchema = z
  .number()
  .finite()
  .int()
  .min(946684800000)
  .max(4102444800000);

const nonBlankText = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((s) => s.length > 0, 'must not be blank');

/** foods.ts static id or a custom_foods.id — see docs/DB.md §4.5 for why this has no FK. */
const foodIdSchema = nonBlankText(200);

const sexSchema = z.enum(['male', 'female']);
const activitySchema = z.enum(['sedentary', 'light', 'moderate', 'very', 'extra']);
const goalSchema = z.enum(['cut', 'maintain', 'bulk']);
const mealSchema = z.enum(['breakfast', 'lunch', 'dinner', 'snack']);
const sourceSchema = z.enum(['food-db', 'scan', 'manual']);
const localeSchema = z.enum(['en', 'ar']);
const foodCategorySchema = z.enum([
  'protein',
  'grains',
  'dairy',
  'fruit',
  'vegetables',
  'fats & nuts',
  'snacks',
  'drinks',
  'turkish & middle eastern',
]);

/** Mirrors entries_grams_range: 0 <= grams < 100000 (schema.ts). */
const gramsSchema = z.number().finite().min(0).max(99999.99);
/** Mirrors entries_kcal_range: 0 <= kcal < 100000. */
const entryKcalSchema = z.number().finite().min(0).max(99999.99);
/** Mirrors entries_{protein,carbs,fat}_range: 0 <= x < 10000. */
const entryMacroSchema = z.number().finite().min(0).max(9999.99);
/** Mirrors custom_foods_kcal_range: 0 <= kcal < 10000. */
const foodKcalSchema = z.number().finite().min(0).max(9999.99);
/** Mirrors custom_foods_{protein,carbs,fat}_range: 0 <= x < 1000. */
const foodMacroSchema = z.number().finite().min(0).max(999.99);
/** Mirrors profiles_weight_range / weights_weight_range: 0 < kg < 500. */
const weightKgSchema = z.number().finite().min(0.1).max(499.9);
/** Mirrors profiles_height_range: 0 < cm < 300. */
const heightCmSchema = z.number().finite().min(0.1).max(299.9);
/** Mirrors profiles_age_range: 0 < age < 130. */
const ageSchema = z.number().finite().int().min(1).max(129);

const commonPortionSchema = z
  .object({ label: nonBlankText(80), grams: z.number().finite().min(0).max(99999.99) })
  .strict();
/** Generous — no real food needs more than a handful of named portions. */
const commonPortionsSchema = z.array(commonPortionSchema).max(50);

/* ------------------------------------------------------------------ *
 * Push — per-row discriminated union: `deleted: true` (tombstone, no  *
 * content needed) vs `deleted: false` (live upsert, full content).    *
 * ------------------------------------------------------------------ */

const MAX_ROWS_PER_TABLE = 500;

/** Tombstone ops for the two key shapes in play: a client UUID, or a bare food id. */
const idTombstoneSchema = z.object({ id: idSchema, deleted: z.literal(true) }).strict();
const foodIdTombstoneSchema = z.object({ foodId: foodIdSchema, deleted: z.literal(true) }).strict();

const profileOpSchema = z.discriminatedUnion('deleted', [
  z.object({ deleted: z.literal(true) }).strict(),
  z
    .object({
      deleted: z.literal(false),
      sex: sexSchema,
      age: ageSchema,
      heightCm: heightCmSchema,
      weightKg: weightKgSchema,
      activity: activitySchema,
      goal: goalSchema,
    })
    .strict(),
]);

const settingsOpSchema = z.discriminatedUnion('deleted', [
  z.object({ deleted: z.literal(true) }).strict(),
  z
    .object({ deleted: z.literal(false), locale: localeSchema, reducedMotion: z.boolean() })
    .strict(),
]);

const entryOpSchema = z.discriminatedUnion('deleted', [
  idTombstoneSchema,
  z
    .object({
      id: idSchema,
      deleted: z.literal(false),
      day: daySchema,
      name: nonBlankText(200),
      grams: gramsSchema,
      kcal: entryKcalSchema,
      protein: entryMacroSchema,
      carbs: entryMacroSchema,
      fat: entryMacroSchema,
      meal: mealSchema,
      source: sourceSchema,
      foodId: foodIdSchema.nullable().optional(),
      loggedAt: epochMsSchema,
    })
    .strict(),
]);

const weightOpSchema = z.discriminatedUnion('deleted', [
  idTombstoneSchema,
  z.object({ id: idSchema, deleted: z.literal(false), day: daySchema, weightKg: weightKgSchema }).strict(),
]);

const customFoodOpSchema = z.discriminatedUnion('deleted', [
  idTombstoneSchema,
  z
    .object({
      id: idSchema,
      deleted: z.literal(false),
      name: nonBlankText(200),
      category: foodCategorySchema,
      kcal: foodKcalSchema,
      protein: foodMacroSchema,
      carbs: foodMacroSchema,
      fat: foodMacroSchema,
      commonPortions: commonPortionsSchema,
    })
    .strict(),
]);

const favouriteOpSchema = z.discriminatedUnion('deleted', [
  foodIdTombstoneSchema,
  z.object({ foodId: foodIdSchema, deleted: z.literal(false) }).strict(),
]);

const pushBodySchema = z
  .object({
    profile: profileOpSchema.nullable().optional(),
    settings: settingsOpSchema.nullable().optional(),
    entries: z.array(entryOpSchema).max(MAX_ROWS_PER_TABLE).optional(),
    weights: z.array(weightOpSchema).max(MAX_ROWS_PER_TABLE).optional(),
    customFoods: z.array(customFoodOpSchema).max(MAX_ROWS_PER_TABLE).optional(),
    favourites: z.array(favouriteOpSchema).max(MAX_ROWS_PER_TABLE).optional(),
  })
  .strict();

const ROW_CAPPED_TABLES = ['entries', 'weights', 'customFoods', 'favourites'] as const;

/**
 * O(1)-per-table length gate that runs BEFORE any element is validated.
 *
 * SECURITY — the internal security audit F-06 (CPU amplification). `z.array(x).max(500)` is a real
 * cap, but it parses **every** element first and only then checks `.length`, allocating
 * one issue object per failing element: a 2 MB body of 400 000 zeroes was measured at
 * ~0.9 s of CPU and 400 001 issue objects for a request that gets rejected anyway. With
 * `api/sync/*` deliberately carrying no rate limit of its own (docs/API.md, "Known
 * limitations"), an authenticated client could repeat that as fast as it could open
 * connections.
 *
 * The check reads `.length` on each of at most four arrays and stops there. It is
 * `.pipe()`d in front of the body schema rather than bolted onto the one call site in
 * `api/sync/push.ts` on purpose: a zod pipe does not run its output schema when the input
 * schema fails, so the cheap gate cannot be forgotten, reordered, or bypassed by a future
 * second caller. `.max(MAX_ROWS_PER_TABLE)` is deliberately LEFT on each array as well —
 * this gate is a cost guard, not the source of truth, and the schema must stay correct on
 * its own if the pipe is ever unwrapped.
 *
 * Non-arrays are passed through untouched so `pushBodySchema` still produces the precise
 * type error for them; this stage only ever rejects "too many rows".
 */
export const pushRequestSchema = z
  .unknown()
  .superRefine((raw, ctx) => {
    if (raw === null || typeof raw !== 'object') return;
    for (const table of ROW_CAPPED_TABLES) {
      const value = (raw as Record<string, unknown>)[table];
      if (Array.isArray(value) && value.length > MAX_ROWS_PER_TABLE) {
        ctx.addIssue({
          code: 'custom',
          path: [table],
          message: `at most ${MAX_ROWS_PER_TABLE} rows per table`,
        });
      }
    }
  })
  .pipe(pushBodySchema);

export type PushRequestBody = z.infer<typeof pushBodySchema>;
export type EntryOp = z.infer<typeof entryOpSchema>;
export type WeightOp = z.infer<typeof weightOpSchema>;
export type CustomFoodOp = z.infer<typeof customFoodOpSchema>;
export type FavouriteOp = z.infer<typeof favouriteOpSchema>;
export type ProfileOp = z.infer<typeof profileOpSchema>;
export type SettingsOp = z.infer<typeof settingsOpSchema>;

/**
 * A push batch is real user data, not a handful of short auth fields — this cap is
 * `api/_lib/auth/schemas.ts`'s `MAX_AUTH_BODY_BYTES` (8 KB) sized up for that, not a new
 * mechanism: `parseJsonBody`'s byte-capped streaming reader is reused unmodified with
 * this larger limit passed explicitly. 2 MB comfortably covers `MAX_ROWS_PER_TABLE`
 * (500) rows in all four arrays at once (worst case well under 1 MB of JSON) with
 * headroom to spare, while staying far under Vercel's serverless request body ceiling.
 */
export const MAX_PUSH_BODY_BYTES = 2 * 1024 * 1024;

/* ------------------------------------------------------------------ *
 * Pull cursor — per-table, compound (updated_at, id) for the four     *
 * id-addressable tables so cursor pagination is correct even when a   *
 * batch of rows shares one `updated_at` (Postgres `now()` is constant *
 * within one transaction, so one push's rows commonly do). Singleton  *
 * tables (profile, settings) need no id tiebreaker — there is only    *
 * ever one row.                                                       *
 * ------------------------------------------------------------------ */

/**
 * SECURITY — the internal security audit F-04. The cursor `id` is compared against the table's own
 * primary key (`gt(entries.id, cursor.id)`), so its validation must match that column's
 * TYPE, not merely "some non-blank string".
 *
 * `entries`, `weights` and `custom_foods` key on a **`uuid`** column. A cursor id of
 * `"x"` made Postgres raise `invalid input syntax for type uuid`, which reached
 * `api/sync/pull.ts`'s catch-all and returned `500 server_error` from a boundary this
 * contract documents as `400 invalid_input` — a validation boundary that was not one, and
 * an authenticated caller could generate alert-worthy 500s at will. (It was never SQL
 * injection: the value is a bound parameter throughout.)
 *
 * `favourites` keys on `food_id`, a plain `text` column holding either a static
 * `src/lib/foods.ts` id or a `custom_foods.id` — an arbitrary bounded string is the
 * CORRECT validation there, and tightening it to a uuid would break every static food id.
 * The two schemas differ because the two columns differ.
 */
const uuidCursorSchema = z.object({ updatedAt: z.iso.datetime(), id: idSchema }).strict();
const foodIdCursorSchema = z.object({ updatedAt: z.iso.datetime(), id: foodIdSchema }).strict();
const singletonCursorSchema = z.iso.datetime();

export const pullCursorSchema = z
  .object({
    profile: singletonCursorSchema.nullable().optional(),
    settings: singletonCursorSchema.nullable().optional(),
    entries: uuidCursorSchema.nullable().optional(),
    weights: uuidCursorSchema.nullable().optional(),
    customFoods: uuidCursorSchema.nullable().optional(),
    favourites: foodIdCursorSchema.nullable().optional(),
  })
  .strict();

export type PullCursor = z.infer<typeof pullCursorSchema>;

/** How many changed rows `api/sync/pull` returns per table in one call. See docs/API.md
 * "Pagination and the same-timestamp tie" for why this must stay >= MAX_ROWS_PER_TABLE. */
export const PULL_PAGE_LIMIT = 1000;

/**
 * The `cursor` query-string parameter is small (a handful of ISO timestamps and ids) —
 * this is a defensive upper bound on the raw string before it is ever JSON.parse'd, the
 * same "reject before doing real work" shape as the push body's byte cap.
 */
const MAX_CURSOR_QUERY_CHARS = 4000;

export type ParseCursorResult =
  | { ok: true; cursor: PullCursor | null }
  | { ok: false; reason: 'invalid_input' | 'too_large' };

/** Parses the `?cursor=` query param: absent/empty means "full pull" (cursor: null). */
export function parsePullCursorParam(raw: string | null): ParseCursorResult {
  if (raw === null || raw.length === 0) return { ok: true, cursor: null };
  if (raw.length > MAX_CURSOR_QUERY_CHARS) return { ok: false, reason: 'too_large' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'invalid_input' };
  }

  const result = pullCursorSchema.safeParse(parsed);
  if (!result.success) return { ok: false, reason: 'invalid_input' };
  return { ok: true, cursor: result.data };
}
