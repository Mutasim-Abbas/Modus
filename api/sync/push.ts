import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { errorResponse, jsonResponse } from '../_lib/http.js';
import { type AuthHandlerDeps, resolveAuthDeps } from '../_lib/auth/deps.js';
import { isTrustedOrigin } from '../_lib/auth/origin.js';
import { authenticateSession } from '../_lib/auth/session-store.js';
import { customFoods, entries, favourites, profiles, userSettings, weights } from '../_lib/db/schema.js';
import type { Db } from '../_lib/db/client.js';
import { isUniqueViolation } from '../_lib/db/pg-errors.js';
import {
  type CustomFoodOp,
  type EntryOp,
  type FavouriteOp,
  MAX_PUSH_BODY_BYTES,
  type ProfileOp,
  pushRequestSchema,
  type SettingsOp,
  type WeightOp,
} from '../_lib/sync/schemas.js';
import { parseJsonBody } from '../_lib/auth/schemas.js';
import { toNumeric } from '../_lib/sync/rows.js';

/**
 * POST /api/sync/push — idempotent upsert (by client-generated id) plus tombstone-aware
 * delete, across all six synced tables, in one request.
 *
 * **Every write below is scoped to the session's own `user_id` — never a value from the
 * body.** There is no `userId` field in any push schema at all (every op schema is
 * `.strict()`, so trying to smuggle one is a `400 invalid_input`, not a silently-dropped
 * key); ownership for id-addressable tables (entries, custom_foods) is additionally
 * enforced at the SQL layer itself — see `applyIdTable` below — so a forged/foreign id
 * cannot overwrite another account's row even if the id happens to collide.
 * `api/sync/push.test.ts` proves this directly with two real accounts.
 *
 * **No `db.transaction()` — deliberately, and documented, not silently absent.** See
 * "Atomicity" in docs/API.md: `@neondatabase/serverless`'s HTTP driver (`neon-http`,
 * chosen specifically to avoid serverless connection-pool exhaustion — the project plan §2)
 * has no transaction support, the same gap `docs/API.md`'s Auth section already
 * documents for `api/auth/change-password.ts`. Every write here is upsert-shaped and
 * therefore safely retryable — the atomicity guarantee this endpoint actually provides
 * is per-row, not per-batch: a crash between two tables (or two rows) leaves whatever
 * was already committed correctly persisted and the remainder simply un-pushed, which a
 * retry of the identical batch resolves with no duplication.
 */
export function createHandler(overrides: AuthHandlerDeps = {}) {
  return async function handler(request: Request): Promise<Response> {
    try {
      if (request.method !== 'POST') {
        return errorResponse('method_not_allowed', 405, { Allow: 'POST' });
      }

      const deps = resolveAuthDeps(overrides);
      if (!deps) return errorResponse('sync_unconfigured', 503);
      const { db, pepper } = deps;

      if (!isTrustedOrigin(request)) {
        return errorResponse('origin_rejected', 403);
      }

      const auth = await authenticateSession(db, pepper, request);
      if (!auth.ok) return errorResponse('unauthorized', 401);
      const userId = auth.session.userId;

      const parsed = await parseJsonBody(request, pushRequestSchema, MAX_PUSH_BODY_BYTES);
      if (!parsed.ok) {
        return errorResponse(parsed.reason, parsed.reason === 'too_large' ? 413 : 400);
      }
      const body = parsed.value;

      const [profileResult, settingsResult, entriesResult, weightsResult, customFoodsResult, favouritesResult] =
        await Promise.all([
          applyProfile(db, userId, body.profile ?? null),
          applySettings(db, userId, body.settings ?? null),
          applyEntries(db, userId, body.entries ?? []),
          applyWeights(db, userId, body.weights ?? []),
          applyCustomFoods(db, userId, body.customFoods ?? []),
          applyFavourites(db, userId, body.favourites ?? []),
        ]);

      const serverState = await buildServerState(db, userId);

      return jsonResponse(
        {
          serverState,
          applied: {
            profile: profileResult,
            settings: settingsResult,
            entries: entriesResult.applied,
            weights: weightsResult.applied,
            customFoods: customFoodsResult.applied,
            favourites: favouritesResult.applied,
          },
          rejected: {
            entries: entriesResult.rejected,
            weights: weightsResult.rejected,
            customFoods: customFoodsResult.rejected,
            favourites: favouritesResult.rejected,
          },
        },
        200,
        { 'Set-Cookie': auth.cookieHeader },
      );
    } catch (cause) {
      console.error('sync/push: unhandled error', {
        name: cause instanceof Error ? cause.name : typeof cause,
      });
      return errorResponse('server_error', 500);
    }
  };
}

const handler = createHandler();
export default { fetch: handler };

/* ------------------------------------------------------------------ *
 * Per-table apply functions.                                          *
 * ------------------------------------------------------------------ */

interface AppliedRow {
  id: string;
  updatedAt: string;
  deletedAt: string | null;
}
interface AppliedFavourite {
  foodId: string;
  updatedAt: string;
  deletedAt: string | null;
}
type RejectReason = 'owner_conflict' | 'duplicate_day';

/**
 * Collapses ops that address the same row to the LAST one in the batch.
 *
 * SECURITY / DATA-LOSS — the internal security audit F-02. Without this, a batch carrying the same
 * id twice becomes a single multi-row `INSERT ... VALUES (a),(a) ON CONFLICT (id) DO
 * UPDATE`, which Postgres refuses outright: "ON CONFLICT DO UPDATE command cannot affect
 * row a second time" (SQLSTATE 21000 — note: NOT 23505, so the weights unique-violation
 * fallback rethrows it). The handler's catch-all then answers 500, deterministically, so
 * retrying the identical batch fails identically and the client's offline queue never
 * drains: permanent, silent sync loss for that user. A duplicate id is exactly what an
 * offline queue produces when a row is created and then edited before the first push.
 *
 * Last-wins rather than first-wins because the later op is the client's later intent —
 * the same rule last-write-wins already applies across pushes (docs/API.md). It also
 * gives a deterministic answer when one batch contains both a live op and a tombstone for
 * one id, which previously resolved to "the tombstone always wins" purely because deletes
 * happened to be applied second.
 */
function dedupeOps<T>(ops: T[], keyOf: (op: T) => string): T[] {
  const byKey = new Map<string, T>();
  for (const op of ops) byKey.set(keyOf(op), op);
  return [...byKey.values()];
}

/*
 * `isUniqueViolation` (SQLSTATE 23505) — used by weights' `(user_id, day)`
 * live-uniqueness fallback below — now lives in `api/_lib/db/pg-errors.ts`, shared with
 * `api/auth/signup.ts`'s concurrent-signup fix (the internal security audit F-07). The `.cause`
 * unwrapping that drizzle's error envelope requires is documented there.
 */

async function applyProfile(db: Db, userId: string, op: ProfileOp | null) {
  if (!op) return null;

  if (op.deleted) {
    const [row] = await db
      .update(profiles)
      .set({ deletedAt: new Date() })
      .where(eq(profiles.userId, userId))
      .returning({ updatedAt: profiles.updatedAt, deletedAt: profiles.deletedAt });
    if (!row) return null;
    return { updatedAt: row.updatedAt.toISOString(), deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null };
  }

  const [row] = await db
    .insert(profiles)
    .values({
      userId,
      sex: op.sex,
      age: op.age,
      heightCm: toNumeric(op.heightCm, 1),
      weightKg: toNumeric(op.weightKg, 1),
      activity: op.activity,
      goal: op.goal,
      deletedAt: null,
    })
    .onConflictDoUpdate({
      target: profiles.userId,
      set: {
        sex: sql`excluded.sex`,
        age: sql`excluded.age`,
        heightCm: sql`excluded.height_cm`,
        weightKg: sql`excluded.weight_kg`,
        activity: sql`excluded.activity`,
        goal: sql`excluded.goal`,
        deletedAt: null,
      },
    })
    .returning({ updatedAt: profiles.updatedAt, deletedAt: profiles.deletedAt });

  // Invariant, not a real runtime possibility: a single-row insert with an
  // unconditional (no setWhere) onConflictDoUpdate on the row's own primary key always
  // returns exactly one row. Guarded explicitly rather than asserted so a future change
  // that violates the invariant fails loudly (caught by the handler's own try/catch,
  // never a stack trace to the client) instead of silently reading `undefined`.
  if (!row) throw new Error('sync/push: profile upsert returned no row');
  return { updatedAt: row.updatedAt.toISOString(), deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null };
}

async function applySettings(db: Db, userId: string, op: SettingsOp | null) {
  if (!op) return null;

  if (op.deleted) {
    const [row] = await db
      .update(userSettings)
      .set({ deletedAt: new Date() })
      .where(eq(userSettings.userId, userId))
      .returning({ updatedAt: userSettings.updatedAt, deletedAt: userSettings.deletedAt });
    if (!row) return null;
    return { updatedAt: row.updatedAt.toISOString(), deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null };
  }

  const [row] = await db
    .insert(userSettings)
    .values({ userId, locale: op.locale, reducedMotion: op.reducedMotion, deletedAt: null })
    .onConflictDoUpdate({
      target: userSettings.userId,
      set: { locale: sql`excluded.locale`, reducedMotion: sql`excluded.reduced_motion`, deletedAt: null },
    })
    .returning({ updatedAt: userSettings.updatedAt, deletedAt: userSettings.deletedAt });

  if (!row) throw new Error('sync/push: settings upsert returned no row');
  return { updatedAt: row.updatedAt.toISOString(), deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null };
}

async function applyEntries(db: Db, userId: string, rawOps: EntryOp[]) {
  const ops = dedupeOps(rawOps, (o) => o.id);
  const liveOps = ops.filter((o): o is Extract<EntryOp, { deleted: false }> => !o.deleted);
  const deleteIds = ops.filter((o) => o.deleted).map((o) => o.id);

  const appliedMap = new Map<string, AppliedRow>();
  const rejected: { id: string; reason: RejectReason }[] = [];

  if (liveOps.length > 0) {
    const values = liveOps.map((op) => ({
      id: op.id,
      userId,
      day: op.day,
      name: op.name,
      grams: toNumeric(op.grams, 2),
      kcal: toNumeric(op.kcal, 2),
      protein: toNumeric(op.protein, 2),
      carbs: toNumeric(op.carbs, 2),
      fat: toNumeric(op.fat, 2),
      meal: op.meal,
      source: op.source,
      foodId: op.foodId ?? null,
      loggedAt: new Date(op.loggedAt),
      deletedAt: null as Date | null,
    }));

    const returned = await db
      .insert(entries)
      .values(values)
      .onConflictDoUpdate({
        target: entries.id,
        set: {
          day: sql`excluded.day`,
          name: sql`excluded.name`,
          grams: sql`excluded.grams`,
          kcal: sql`excluded.kcal`,
          protein: sql`excluded.protein`,
          carbs: sql`excluded.carbs`,
          fat: sql`excluded.fat`,
          meal: sql`excluded.meal`,
          source: sql`excluded.source`,
          foodId: sql`excluded.food_id`,
          loggedAt: sql`excluded.logged_at`,
          deletedAt: null,
        },
        // The ownership guard: only applies the update when the EXISTING (conflicting)
        // row already belongs to this session's user. If it belongs to someone else,
        // this evaluates false, the UPDATE is skipped, and — because the id collided —
        // the INSERT is skipped too: the whole row is a silent no-op. The victim's row
        // is untouched. See api/sync/push.test.ts's IDOR test.
        setWhere: eq(entries.userId, userId),
      })
      .returning({ id: entries.id, updatedAt: entries.updatedAt, deletedAt: entries.deletedAt });

    for (const row of returned) {
      appliedMap.set(row.id, toAppliedRow(row));
    }
    for (const op of liveOps) {
      if (!appliedMap.has(op.id)) rejected.push({ id: op.id, reason: 'owner_conflict' });
    }
  }

  if (deleteIds.length > 0) {
    const returned = await db
      .update(entries)
      .set({ deletedAt: new Date() })
      .where(and(eq(entries.userId, userId), inArray(entries.id, deleteIds)))
      .returning({ id: entries.id, updatedAt: entries.updatedAt, deletedAt: entries.deletedAt });
    for (const row of returned) appliedMap.set(row.id, toAppliedRow(row));
    // An id not returned here was either never created server-side (nothing to delete —
    // the client's own local delete already satisfies its intent, so this is a genuine
    // no-op, not an error) or belongs to another user (silently ignored, same as above).
    // Neither is reported as `rejected` — see docs/API.md "Tombstones for unknown ids".
  }

  return { applied: [...appliedMap.values()], rejected };
}

async function applyWeights(db: Db, userId: string, rawOps: WeightOp[]) {
  const ops = dedupeOps(rawOps, (o) => o.id);
  const liveOps = ops.filter((o): o is Extract<WeightOp, { deleted: false }> => !o.deleted);
  const deleteIds = ops.filter((o) => o.deleted).map((o) => o.id);

  const appliedMap = new Map<string, AppliedRow>();
  const rejected: { id: string; reason: RejectReason }[] = [];

  if (liveOps.length > 0) {
    try {
      const returned = await bulkUpsertWeights(db, userId, liveOps);
      for (const row of returned) appliedMap.set(row.id, toAppliedRow(row));
      for (const op of liveOps) {
        if (!appliedMap.has(op.id)) rejected.push({ id: op.id, reason: 'owner_conflict' });
      }
    } catch (error) {
      // The bulk statement hit weights_user_day_live_key (one live weigh-in per day) —
      // some row in this batch collides with another row (a different id, same day)
      // already live for this user. Fall back to one-row-at-a-time so a single
      // conflicting row doesn't take the rest of a legitimate batch down with it.
      if (!isUniqueViolation(error)) throw error;
      for (const op of liveOps) {
        try {
          const [row] = await bulkUpsertWeights(db, userId, [op]);
          if (row) appliedMap.set(row.id, toAppliedRow(row));
          else rejected.push({ id: op.id, reason: 'owner_conflict' });
        } catch (rowError) {
          if (!isUniqueViolation(rowError)) throw rowError;
          rejected.push({ id: op.id, reason: 'duplicate_day' });
        }
      }
    }
  }

  if (deleteIds.length > 0) {
    const returned = await db
      .update(weights)
      .set({ deletedAt: new Date() })
      .where(and(eq(weights.userId, userId), inArray(weights.id, deleteIds)))
      .returning({ id: weights.id, updatedAt: weights.updatedAt, deletedAt: weights.deletedAt });
    for (const row of returned) appliedMap.set(row.id, toAppliedRow(row));
  }

  return { applied: [...appliedMap.values()], rejected };
}

async function bulkUpsertWeights(db: Db, userId: string, ops: Extract<WeightOp, { deleted: false }>[]) {
  const values = ops.map((op) => ({ id: op.id, userId, day: op.day, weightKg: toNumeric(op.weightKg, 1), deletedAt: null as Date | null }));
  return db
    .insert(weights)
    .values(values)
    .onConflictDoUpdate({
      target: weights.id,
      set: { day: sql`excluded.day`, weightKg: sql`excluded.weight_kg`, deletedAt: null },
      setWhere: eq(weights.userId, userId),
    })
    .returning({ id: weights.id, updatedAt: weights.updatedAt, deletedAt: weights.deletedAt });
}

async function applyCustomFoods(db: Db, userId: string, rawOps: CustomFoodOp[]) {
  const ops = dedupeOps(rawOps, (o) => o.id);
  const liveOps = ops.filter((o): o is Extract<CustomFoodOp, { deleted: false }> => !o.deleted);
  const deleteIds = ops.filter((o) => o.deleted).map((o) => o.id);

  const appliedMap = new Map<string, AppliedRow>();
  const rejected: { id: string; reason: RejectReason }[] = [];

  if (liveOps.length > 0) {
    const values = liveOps.map((op) => ({
      id: op.id,
      userId,
      name: op.name,
      category: op.category,
      kcal: toNumeric(op.kcal, 2),
      protein: toNumeric(op.protein, 2),
      carbs: toNumeric(op.carbs, 2),
      fat: toNumeric(op.fat, 2),
      commonPortions: op.commonPortions,
      deletedAt: null as Date | null,
    }));

    const returned = await db
      .insert(customFoods)
      .values(values)
      .onConflictDoUpdate({
        target: customFoods.id,
        set: {
          name: sql`excluded.name`,
          category: sql`excluded.category`,
          kcal: sql`excluded.kcal`,
          protein: sql`excluded.protein`,
          carbs: sql`excluded.carbs`,
          fat: sql`excluded.fat`,
          commonPortions: sql`excluded.common_portions`,
          deletedAt: null,
        },
        setWhere: eq(customFoods.userId, userId),
      })
      .returning({ id: customFoods.id, updatedAt: customFoods.updatedAt, deletedAt: customFoods.deletedAt });

    for (const row of returned) appliedMap.set(row.id, toAppliedRow(row));
    for (const op of liveOps) {
      if (!appliedMap.has(op.id)) rejected.push({ id: op.id, reason: 'owner_conflict' });
    }
  }

  if (deleteIds.length > 0) {
    const returned = await db
      .update(customFoods)
      .set({ deletedAt: new Date() })
      .where(and(eq(customFoods.userId, userId), inArray(customFoods.id, deleteIds)))
      .returning({ id: customFoods.id, updatedAt: customFoods.updatedAt, deletedAt: customFoods.deletedAt });
    for (const row of returned) appliedMap.set(row.id, toAppliedRow(row));
  }

  return { applied: [...appliedMap.values()], rejected };
}

async function applyFavourites(db: Db, userId: string, rawOps: FavouriteOp[]) {
  const ops = dedupeOps(rawOps, (o) => o.foodId);
  // No ownership-conflict surface at all: the primary key is (user_id, food_id), and
  // user_id always comes from the session — a client cannot even address another
  // account's favourite row, forged or not.
  const liveOps = ops.filter((o): o is Extract<FavouriteOp, { deleted: false }> => !o.deleted);
  const deleteIds = ops.filter((o) => o.deleted).map((o) => o.foodId);

  const appliedMap = new Map<string, AppliedFavourite>();

  if (liveOps.length > 0) {
    const values = liveOps.map((op) => ({ userId, foodId: op.foodId, deletedAt: null as Date | null }));
    const returned = await db
      .insert(favourites)
      .values(values)
      .onConflictDoUpdate({
        target: [favourites.userId, favourites.foodId],
        set: { deletedAt: null },
      })
      .returning({ foodId: favourites.foodId, updatedAt: favourites.updatedAt, deletedAt: favourites.deletedAt });
    for (const row of returned) {
      appliedMap.set(row.foodId, {
        foodId: row.foodId,
        updatedAt: row.updatedAt.toISOString(),
        deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
      });
    }
  }

  if (deleteIds.length > 0) {
    const returned = await db
      .update(favourites)
      .set({ deletedAt: new Date() })
      .where(and(eq(favourites.userId, userId), inArray(favourites.foodId, deleteIds)))
      .returning({ foodId: favourites.foodId, updatedAt: favourites.updatedAt, deletedAt: favourites.deletedAt });
    for (const row of returned) {
      appliedMap.set(row.foodId, {
        foodId: row.foodId,
        updatedAt: row.updatedAt.toISOString(),
        deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
      });
    }
  }

  return { applied: [...appliedMap.values()], rejected: [] as { foodId: string; reason: RejectReason }[] };
}

function toAppliedRow(row: { id: string; updatedAt: Date; deletedAt: Date | null }): AppliedRow {
  return { id: row.id, updatedAt: row.updatedAt.toISOString(), deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null };
}

/* ------------------------------------------------------------------ *
 * serverState: the newest (updated_at, id) per table across every row *
 * this account owns. It is an INFORMATIONAL watermark for the client  *
 * ("is the server ahead of me?"), and it is deliberately NOT named    *
 * `cursor`.                                                           *
 *                                                                     *
 * SECURITY / DATA-LOSS — the internal security audit F-03. This value must NEVER *
 * be adopted as a pull cursor. A pull cursor means "everything up to  *
 * here has been DELIVERED TO ME"; this is "everything the account     *
 * owns, including rows written by other devices that this client has  *
 * never seen". Adopting it skips those rows permanently: device B     *
 * logs breakfast at T1, device A (which has not pulled) pushes lunch  *
 * at T2, A adopts T2, and B's breakfast at T1 is never delivered to A *
 * on this or any later pull. Only a PULL response may advance a pull  *
 * cursor.                                                             *
 * ------------------------------------------------------------------ */

// Written as three explicit functions rather than one generic helper over a table union:
// drizzle's query builder resolves `.from()`/`.where()`/`.orderBy()` against one concrete
// table type at a time, and entries/weights/custom_foods are structurally similar but
// not the same branded column types — a union parameter fights the type checker for no
// real benefit at this size. Same tradeoff api/sync/pull.ts already made explicitly.
async function latestEntriesCursor(db: Db, userId: string): Promise<{ updatedAt: string; id: string } | null> {
  const [row] = await db
    .select({ id: entries.id, updatedAt: entries.updatedAt })
    .from(entries)
    .where(eq(entries.userId, userId))
    .orderBy(desc(entries.updatedAt), desc(entries.id))
    .limit(1);
  return row ? { updatedAt: row.updatedAt.toISOString(), id: row.id } : null;
}

async function latestWeightsCursor(db: Db, userId: string): Promise<{ updatedAt: string; id: string } | null> {
  const [row] = await db
    .select({ id: weights.id, updatedAt: weights.updatedAt })
    .from(weights)
    .where(eq(weights.userId, userId))
    .orderBy(desc(weights.updatedAt), desc(weights.id))
    .limit(1);
  return row ? { updatedAt: row.updatedAt.toISOString(), id: row.id } : null;
}

async function latestCustomFoodsCursor(db: Db, userId: string): Promise<{ updatedAt: string; id: string } | null> {
  const [row] = await db
    .select({ id: customFoods.id, updatedAt: customFoods.updatedAt })
    .from(customFoods)
    .where(eq(customFoods.userId, userId))
    .orderBy(desc(customFoods.updatedAt), desc(customFoods.id))
    .limit(1);
  return row ? { updatedAt: row.updatedAt.toISOString(), id: row.id } : null;
}

async function buildServerState(db: Db, userId: string) {
  const [profileRow] = await db.select({ updatedAt: profiles.updatedAt }).from(profiles).where(eq(profiles.userId, userId)).limit(1);
  const [settingsRow] = await db
    .select({ updatedAt: userSettings.updatedAt })
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
    .limit(1);
  const [favouriteRow] = await db
    .select({ foodId: favourites.foodId, updatedAt: favourites.updatedAt })
    .from(favourites)
    .where(eq(favourites.userId, userId))
    .orderBy(desc(favourites.updatedAt), desc(favourites.foodId))
    .limit(1);

  const [entriesLatest, weightsLatest, customFoodsLatest] = await Promise.all([
    latestEntriesCursor(db, userId),
    latestWeightsCursor(db, userId),
    latestCustomFoodsCursor(db, userId),
  ]);

  return {
    profile: profileRow ? profileRow.updatedAt.toISOString() : null,
    settings: settingsRow ? settingsRow.updatedAt.toISOString() : null,
    entries: entriesLatest,
    weights: weightsLatest,
    customFoods: customFoodsLatest,
    favourites: favouriteRow ? { updatedAt: favouriteRow.updatedAt.toISOString(), id: favouriteRow.foodId } : null,
  };
}
