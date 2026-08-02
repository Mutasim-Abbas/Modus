/**
 * FitMacro v3 — Drizzle schema (single source of truth for the Postgres shape).
 *
 * The full reasoning for every table, column, index, constraint and cascade lives in
 * `docs/DB.md` — this file is deliberately light on prose so the two don't drift out of
 * sync; read DB.md alongside it. A short pointer comment sits on anything non-obvious.
 *
 * Conventions:
 * - Every column name is explicit snake_case (drizzle-kit here has no `casing` option
 *   configured, so it will not infer it from the camelCase TS property).
 * - `numeric(...)` columns are read back as strings by drizzle by design (mode defaults
 *   to 'string') — this is what keeps macro totals free of float drift end to end; do not
 *   add `{ mode: 'number' }` to any money-style column.
 * - `timestamp(..., { withTimezone: true })` everywhere. Every `updated_at` on a synced
 *   table is additionally pinned server-side by a trigger (see
 *   `drizzle/0001_updated_at_triggers.sql`) so a client-supplied value can never win,
 *   even if application code has a bug — see docs/DB.md "Server-assigned time".
 * - Six tables are the sync surface (profiles, entries, weights, custom_foods,
 *   favourites, user_settings): each carries `updated_at`, `deleted_at` and a
 *   `(user_id, updated_at)` index, per docs/TODO.md P2.1's non-negotiables.
 */

import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/* ------------------------------------------------------------------ *
 * Enums — closed value sets that mirror src/types.ts unions exactly.  *
 * Adding a variant is already a code change on the client, so the     *
 * matching `ALTER TYPE ... ADD VALUE` migration carries no extra      *
 * friction. See docs/DB.md "Enums vs text+check" for the alternative  *
 * considered and rejected.                                            *
 * ------------------------------------------------------------------ */

export const sexEnum = pgEnum('sex', ['male', 'female']);
export const activityLevelEnum = pgEnum('activity_level', [
  'sedentary',
  'light',
  'moderate',
  'very',
  'extra',
]);
export const goalEnum = pgEnum('goal', ['cut', 'maintain', 'bulk']);
export const mealSlotEnum = pgEnum('meal_slot', ['breakfast', 'lunch', 'dinner', 'snack']);
export const entrySourceEnum = pgEnum('entry_source', ['food-db', 'scan', 'manual']);
export const foodCategoryEnum = pgEnum('food_category', [
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
export const localeEnum = pgEnum('locale', ['en', 'ar']);
export const authAttemptScopeEnum = pgEnum('auth_attempt_scope', ['ip', 'account']);
export const authAttemptActionEnum = pgEnum('auth_attempt_action', [
  'login',
  'signup',
  'password_change',
  'recovery_redeem',
]);

/* ------------------------------------------------------------------ *
 * users                                                                *
 * ------------------------------------------------------------------ */

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    emailVerified: boolean('email_verified').notNull().default(false),
    passwordHash: text('password_hash').notNull(),
    recoveryCodeHash: text('recovery_code_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    // No deleted_at: account deletion is real deletion (docs/PLAN.md §4.1), not a flag.
  },
  (t) => [
    uniqueIndex('users_email_key').on(t.email),
    // Defense in depth: the app must already lowercase email before it ever reaches
    // here (P2.2's job), but a DB-level invariant survives an application bug too.
    check('users_email_lowercase', sql`${t.email} = lower(${t.email})`),
    check('users_email_not_blank', sql`length(btrim(${t.email})) > 0`),
  ],
);

/* ------------------------------------------------------------------ *
 * sessions — server-side session state, NOT part of the sync surface. *
 * ------------------------------------------------------------------ */

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Hex-encoded HMAC-SHA256(token, SESSION_PEPPER) — the raw opaque token is never
    // stored. text, not bytea: this drizzle-orm version ships no bytea column type, and
    // hex text is trivially indexable/comparable at a cost that is irrelevant here.
    tokenHash: text('token_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    // Sliding 30-day window, pushed forward on activity by application code.
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    // Hard 90-day cap, set once at creation and never extended — bounds how long a
    // stolen-but-still-active token stays usable even with continuous activity.
    absoluteExpiresAt: timestamp('absolute_expires_at', { withTimezone: true }).notNull(),
    userAgent: text('user_agent'),
    // Hashed, never raw — same rule and same hash function as auth_attempts.key.
    ipHash: text('ip_hash').notNull(),
    // Set on logout / logout-everywhere / password-change rotation. A row with
    // revoked_at set must never authenticate again, even if expires_at is still future.
    // Kept (not deleted) so account settings can show a device/session history.
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('sessions_token_hash_key').on(t.tokenHash),
    index('sessions_user_id_idx').on(t.userId),
    check('sessions_token_hash_shape', sql`${t.tokenHash} ~ '^[0-9a-f]{64}$'`),
    check('sessions_ip_hash_shape', sql`${t.ipHash} ~ '^[0-9a-f]{64}$'`),
  ],
);

/* ------------------------------------------------------------------ *
 * auth_attempts — Postgres-backed rate limiting, per-IP and per-account. *
 * Deliberately has NO foreign key to users: a login attempt against an  *
 * email that was never registered (or was since deleted) must still be *
 * throttled, and deleting an account must not reset an attacker's       *
 * lockout clock against that email. See docs/DB.md for the full        *
 * reasoning and the honest limitation this trades away.                *
 * ------------------------------------------------------------------ */

export const authAttempts = pgTable(
  'auth_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // ip_hash when scope='ip'; lowercased email when scope='account'.
    key: text('key').notNull(),
    scope: authAttemptScopeEnum('scope').notNull(),
    action: authAttemptActionEnum('action').notNull(),
    success: boolean('success').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Sliding-window count query: WHERE key = ? AND scope = ? AND action = ? AND
    // created_at > ?. This index serves it directly, in that column order.
    index('auth_attempts_window_idx').on(t.key, t.scope, t.action, t.createdAt),
    // Supports a future retention/purge job (DELETE WHERE created_at < now() - x).
    // No such job exists yet — recorded as a known limitation in docs/DB.md.
    index('auth_attempts_created_at_idx').on(t.createdAt),
    // Schema-level guard: an IP-scoped key must look like a 64-hex-char hash, never a
    // raw dotted-quad or IPv6 literal. Catches a future logging bug at the DB, not in
    // review.
    check(
      'auth_attempts_ip_key_shape',
      sql`${t.scope} <> 'ip' OR ${t.key} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);

/* ------------------------------------------------------------------ *
 * profiles — one row per user, synced.                                *
 * ------------------------------------------------------------------ */

export const profiles = pgTable(
  'profiles',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    sex: sexEnum('sex').notNull(),
    age: integer('age').notNull(),
    heightCm: numeric('height_cm', { precision: 5, scale: 1 }).notNull(),
    weightKg: numeric('weight_kg', { precision: 5, scale: 1 }).notNull(),
    activity: activityLevelEnum('activity').notNull(),
    goal: goalEnum('goal').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    // (user_id, updated_at) is required uniformly across every synced table by
    // docs/TODO.md P2.1 so P2.3's pull query is one code path, not six. On a 1-row-per-
    // user table this is nearly free and mostly redundant with the primary key, but it
    // keeps that promise literally true and costs nothing measurable at this scale.
    index('profiles_user_updated_idx').on(t.userId, t.updatedAt),
    check('profiles_age_range', sql`${t.age} > 0 AND ${t.age} < 130`),
    check('profiles_height_range', sql`${t.heightCm} > 0 AND ${t.heightCm} < 300`),
    check('profiles_weight_range', sql`${t.weightKg} > 0 AND ${t.weightKg} < 500`),
  ],
);

/* ------------------------------------------------------------------ *
 * entries — logged food, synced. Client-generated id (UUIDv7-style).  *
 * ------------------------------------------------------------------ */

export const entries = pgTable(
  'entries',
  {
    // No .defaultRandom(): the id is client-generated so an offline device can create
    // a fully-formed row with no round trip, and a re-push of the same id is an
    // idempotent upsert rather than a duplicate (P2.3).
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // The calendar day this entry is logged against, in the user's local timezone as
    // chosen client-side (lib/date.ts). Deliberately NOT server-derived: backdating to
    // an arbitrary past day is a real, intended feature, not a clock to defend.
    day: date('day').notNull(),
    name: text('name').notNull(),
    grams: numeric('grams', { precision: 8, scale: 2 }).notNull(),
    kcal: numeric('kcal', { precision: 9, scale: 2 }).notNull(),
    protein: numeric('protein', { precision: 7, scale: 2 }).notNull(),
    carbs: numeric('carbs', { precision: 7, scale: 2 }).notNull(),
    fat: numeric('fat', { precision: 7, scale: 2 }).notNull(),
    meal: mealSlotEnum('meal').notNull(),
    source: entrySourceEnum('source').notNull(),
    // Either a built-in foods.ts id or a custom_foods.id, as a bare string. No FK: the
    // built-in catalogue is static client data with no server table to reference, so a
    // single heterogeneous column (documented, not guessed at) beats a fake FK to only
    // half its possible targets. The macros above are already denormalised onto the
    // row, so a dangling or tombstoned food_id never corrupts a historical entry.
    foodId: text('food_id'),
    // Client-supplied domain timestamp: "when I ate this", not a sync-control field.
    // Never used for ordering or conflict resolution — updated_at is.
    loggedAt: timestamp('logged_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('entries_user_updated_idx').on(t.userId, t.updatedAt),
    // Partial: tombstones never need to show up in a "what's logged today" read.
    index('entries_user_day_idx')
      .on(t.userId, t.day)
      .where(sql`${t.deletedAt} IS NULL`),
    check('entries_grams_range', sql`${t.grams} >= 0 AND ${t.grams} < 100000`),
    check('entries_kcal_range', sql`${t.kcal} >= 0 AND ${t.kcal} < 100000`),
    check('entries_protein_range', sql`${t.protein} >= 0 AND ${t.protein} < 10000`),
    check('entries_carbs_range', sql`${t.carbs} >= 0 AND ${t.carbs} < 10000`),
    check('entries_fat_range', sql`${t.fat} >= 0 AND ${t.fat} < 10000`),
    check('entries_name_not_blank', sql`length(btrim(${t.name})) > 0`),
  ],
);

/* ------------------------------------------------------------------ *
 * weights — body-weight log, synced. Client-generated id.             *
 * ------------------------------------------------------------------ */

export const weights = pgTable(
  'weights',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    day: date('day').notNull(),
    weightKg: numeric('weight_kg', { precision: 5, scale: 1 }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('weights_user_updated_idx').on(t.userId, t.updatedAt),
    // One live weigh-in per day is the domain rule (docs/PLAN.md §3). Partial so a
    // tombstoned entry frees the day for a new one instead of permanently blocking it.
    uniqueIndex('weights_user_day_live_key')
      .on(t.userId, t.day)
      .where(sql`${t.deletedAt} IS NULL`),
    check('weights_weight_range', sql`${t.weightKg} > 0 AND ${t.weightKg} < 500`),
  ],
);

/* ------------------------------------------------------------------ *
 * custom_foods — user-entered foods, synced. Client-generated id.     *
 * ------------------------------------------------------------------ */

export const customFoods = pgTable(
  'custom_foods',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    category: foodCategoryEnum('category').notNull(),
    // Always per 100 g, matching src/types.ts Food['per']; not stored as a column
    // because it is a fixed contract, not a per-row value — storing it would only
    // create a way for a row to lie about the unit it uses.
    kcal: numeric('kcal', { precision: 7, scale: 2 }).notNull(),
    protein: numeric('protein', { precision: 6, scale: 2 }).notNull(),
    carbs: numeric('carbs', { precision: 6, scale: 2 }).notNull(),
    fat: numeric('fat', { precision: 6, scale: 2 }).notNull(),
    // [{ label, grams }], small and never queried by content — jsonb is a better fit
    // than a join table here, per the "modern capabilities where they help" guidance.
    commonPortions: jsonb('common_portions').notNull().default([]),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('custom_foods_user_updated_idx').on(t.userId, t.updatedAt),
    // Serves the "list my live custom foods" read (search/autocomplete) without
    // dragging tombstones through a sequential scan.
    index('custom_foods_user_live_idx')
      .on(t.userId)
      .where(sql`${t.deletedAt} IS NULL`),
    check('custom_foods_kcal_range', sql`${t.kcal} >= 0 AND ${t.kcal} < 10000`),
    check('custom_foods_protein_range', sql`${t.protein} >= 0 AND ${t.protein} < 1000`),
    check('custom_foods_carbs_range', sql`${t.carbs} >= 0 AND ${t.carbs} < 1000`),
    check('custom_foods_fat_range', sql`${t.fat} >= 0 AND ${t.fat} < 1000`),
    check('custom_foods_name_not_blank', sql`length(btrim(${t.name})) > 0`),
    check(
      'custom_foods_common_portions_is_array',
      sql`jsonb_typeof(${t.commonPortions}) = 'array'`,
    ),
  ],
);

/* ------------------------------------------------------------------ *
 * favourites — a toggle per (user, food), synced. No id of its own:   *
 * the natural key IS the identity, which makes the sync push an       *
 * upsert on (user_id, food_id) with no UUID coordination needed.      *
 * ------------------------------------------------------------------ */

export const favourites = pgTable(
  'favourites',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Built-in foods.ts id or custom_foods.id — same heterogeneous-reference rationale
    // as entries.food_id above. No FK.
    foodId: text('food_id').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.foodId] }),
    index('favourites_user_updated_idx').on(t.userId, t.updatedAt),
  ],
);

/* ------------------------------------------------------------------ *
 * user_settings — one row per user, synced.                           *
 * ------------------------------------------------------------------ */

export const userSettings = pgTable(
  'user_settings',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    locale: localeEnum('locale').notNull().default('en'),
    reducedMotion: boolean('reduced_motion').notNull().default(false),
    // NOTE: docs/PLAN.md §3's bounding sketch also lists a `theme` column. It is
    // deliberately cut here, for the identical reason PLAN.md §4 cut
    // `Settings.units: 'metric'`: there is no second theme in this codebase, so a
    // `theme` column today would be exactly the "type stub implying a capability that
    // doesn't exist" anti-pattern the project already rejected once. Add it in a real
    // migration alongside the UI that needs it. Recorded here and in docs/DB.md so the
    // deviation from the sketch is visible, not silent.
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [index('user_settings_user_updated_idx').on(t.userId, t.updatedAt)],
);
