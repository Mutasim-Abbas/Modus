import { and, asc, count, countDistinct, eq, gt, isNull, max, min, or } from 'drizzle-orm';
import { errorResponse, jsonResponse } from '../_lib/http.js';
import { type AuthHandlerDeps, resolveAuthDeps } from '../_lib/auth/deps.js';
import { authenticateSession } from '../_lib/auth/session-store.js';
import { customFoods, entries, favourites, profiles, userSettings, weights } from '../_lib/db/schema.js';
import type { Db } from '../_lib/db/client.js';
import { parsePullCursorParam, PULL_PAGE_LIMIT, type PullCursor } from '../_lib/sync/schemas.js';
import {
  serializeCustomFood,
  serializeEntry,
  serializeFavourite,
  serializeProfile,
  serializeSettings,
  serializeWeight,
  type WireCustomFood,
  type WireEntry,
  type WireFavourite,
  type WireProfile,
  type WireSettings,
  type WireWeight,
} from '../_lib/sync/rows.js';

/**
 * GET /api/sync/pull?cursor=<url-encoded JSON> — delta pull of every synced table.
 *
 * Read-only, so — same reasoning as `GET /api/auth/me` — no Origin/Sec-Fetch-Site check;
 * that guard exists for mutating requests. A `cursor` echoed back by a previous pull (or
 * omitted/empty on the very first sync for a device) selects exactly which rows this call
 * returns; see docs/API.md "Cursor semantics" for the compound `(updated_at, id)` shape
 * and why it exists.
 *
 * **Every query below filters on the session's own `user_id` — never anything from the
 * request.** There is no id in a pull request to forge in the first place (the cursor
 * only ever echoes back ids this same account has already seen from a previous pull of
 * its own data); `api/sync/pull.test.ts` still asserts directly that one account's pull
 * never surfaces a row belonging to another.
 */
export function createHandler(overrides: AuthHandlerDeps = {}) {
  return async function handler(request: Request): Promise<Response> {
    try {
      if (request.method !== 'GET') {
        return errorResponse('method_not_allowed', 405, { Allow: 'GET' });
      }

      const deps = resolveAuthDeps(overrides);
      if (!deps) return errorResponse('sync_unconfigured', 503);
      const { db, pepper } = deps;

      const auth = await authenticateSession(db, pepper, request);
      if (!auth.ok) return errorResponse('unauthorized', 401);
      const userId = auth.session.userId;

      const url = new URL(request.url);
      const cursorResult = parsePullCursorParam(url.searchParams.get('cursor'));
      if (!cursorResult.ok) {
        return errorResponse(cursorResult.reason, cursorResult.reason === 'too_large' ? 413 : 400);
      }
      const cursor = cursorResult.cursor;

      const body = await buildPullResponse(db, userId, cursor);
      return jsonResponse(body, 200, { 'Set-Cookie': auth.cookieHeader });
    } catch (cause) {
      console.error('sync/pull: unhandled error', {
        name: cause instanceof Error ? cause.name : typeof cause,
      });
      return errorResponse('server_error', 500);
    }
  };
}

const handler = createHandler();
export default { fetch: handler };

/* ------------------------------------------------------------------ *
 * Query + response assembly. Kept in this file (not a shared _lib)    *
 * because it is the one place that reads six tables shaped by one     *
 * request — nothing else in the codebase needs it, and factoring it   *
 * out now would be exactly the "speculative abstraction" the          *
 * project's working rules reject.                                     *
 * ------------------------------------------------------------------ */

interface IdCursor {
  updatedAt: string;
  id: string;
}

interface Page<TWire> {
  rows: TWire[];
  hasMore: boolean;
  cursor: IdCursor | null;
  /** The most recent `updated_at` actually seen in this page — feeds `counts.lastChangeAt`
   * without a dedicated extra query. `null` when the page is empty. */
  latestUpdatedAt: Date | null;
}

async function fetchEntriesPage(db: Db, userId: string, cursor: IdCursor | null | undefined): Promise<Page<WireEntry>> {
  const boundary = cursor ? new Date(cursor.updatedAt) : null;
  const condition = boundary
    ? and(
        eq(entries.userId, userId),
        or(gt(entries.updatedAt, boundary), and(eq(entries.updatedAt, boundary), gt(entries.id, cursor!.id))),
      )
    : eq(entries.userId, userId);

  const rows = await db
    .select()
    .from(entries)
    .where(condition)
    .orderBy(asc(entries.updatedAt), asc(entries.id))
    .limit(PULL_PAGE_LIMIT + 1);

  const hasMore = rows.length > PULL_PAGE_LIMIT;
  const page = hasMore ? rows.slice(0, PULL_PAGE_LIMIT) : rows;
  const last = page[page.length - 1];
  return {
    rows: page.map(serializeEntry),
    hasMore,
    cursor: last ? { updatedAt: last.updatedAt.toISOString(), id: last.id } : (cursor ?? null),
    latestUpdatedAt: last ? last.updatedAt : null,
  };
}

async function fetchWeightsPage(db: Db, userId: string, cursor: IdCursor | null | undefined): Promise<Page<WireWeight>> {
  const boundary = cursor ? new Date(cursor.updatedAt) : null;
  const condition = boundary
    ? and(
        eq(weights.userId, userId),
        or(gt(weights.updatedAt, boundary), and(eq(weights.updatedAt, boundary), gt(weights.id, cursor!.id))),
      )
    : eq(weights.userId, userId);

  const rows = await db
    .select()
    .from(weights)
    .where(condition)
    .orderBy(asc(weights.updatedAt), asc(weights.id))
    .limit(PULL_PAGE_LIMIT + 1);

  const hasMore = rows.length > PULL_PAGE_LIMIT;
  const page = hasMore ? rows.slice(0, PULL_PAGE_LIMIT) : rows;
  const last = page[page.length - 1];
  return {
    rows: page.map(serializeWeight),
    hasMore,
    cursor: last ? { updatedAt: last.updatedAt.toISOString(), id: last.id } : (cursor ?? null),
    latestUpdatedAt: last ? last.updatedAt : null,
  };
}

async function fetchCustomFoodsPage(db: Db, userId: string, cursor: IdCursor | null | undefined): Promise<Page<WireCustomFood>> {
  const boundary = cursor ? new Date(cursor.updatedAt) : null;
  const condition = boundary
    ? and(
        eq(customFoods.userId, userId),
        or(
          gt(customFoods.updatedAt, boundary),
          and(eq(customFoods.updatedAt, boundary), gt(customFoods.id, cursor!.id)),
        ),
      )
    : eq(customFoods.userId, userId);

  const rows = await db
    .select()
    .from(customFoods)
    .where(condition)
    .orderBy(asc(customFoods.updatedAt), asc(customFoods.id))
    .limit(PULL_PAGE_LIMIT + 1);

  const hasMore = rows.length > PULL_PAGE_LIMIT;
  const page = hasMore ? rows.slice(0, PULL_PAGE_LIMIT) : rows;
  const last = page[page.length - 1];
  return {
    rows: page.map(serializeCustomFood),
    hasMore,
    cursor: last ? { updatedAt: last.updatedAt.toISOString(), id: last.id } : (cursor ?? null),
    latestUpdatedAt: last ? last.updatedAt : null,
  };
}

async function fetchFavouritesPage(db: Db, userId: string, cursor: IdCursor | null | undefined): Promise<Page<WireFavourite>> {
  const boundary = cursor ? new Date(cursor.updatedAt) : null;
  const condition = boundary
    ? and(
        eq(favourites.userId, userId),
        or(
          gt(favourites.updatedAt, boundary),
          and(eq(favourites.updatedAt, boundary), gt(favourites.foodId, cursor!.id)),
        ),
      )
    : eq(favourites.userId, userId);

  const rows = await db
    .select()
    .from(favourites)
    .where(condition)
    .orderBy(asc(favourites.updatedAt), asc(favourites.foodId))
    .limit(PULL_PAGE_LIMIT + 1);

  const hasMore = rows.length > PULL_PAGE_LIMIT;
  const page = hasMore ? rows.slice(0, PULL_PAGE_LIMIT) : rows;
  const last = page[page.length - 1];
  return {
    rows: page.map(serializeFavourite),
    hasMore,
    cursor: last ? { updatedAt: last.updatedAt.toISOString(), id: last.foodId } : (cursor ?? null),
    latestUpdatedAt: last ? last.updatedAt : null,
  };
}

async function fetchSingleton<T extends { updatedAt: Date }>(rows: Promise<T[]>): Promise<T | null> {
  const result = await rows;
  return result[0] ?? null;
}

interface EntryCounts {
  total: number;
  days: number;
  firstDay: string | null;
  lastDay: string | null;
}

async function buildPullResponse(db: Db, userId: string, cursor: PullCursor | null) {
  const [
    profileRow,
    settingsRow,
    entriesPage,
    weightsPage,
    customFoodsPage,
    favouritesPage,
    entryAgg,
    weightAgg,
    customFoodAgg,
    favouriteAgg,
  ] = await Promise.all([
    fetchSingleton(db.select().from(profiles).where(eq(profiles.userId, userId)).limit(1)),
    fetchSingleton(db.select().from(userSettings).where(eq(userSettings.userId, userId)).limit(1)),
    fetchEntriesPage(db, userId, cursor?.entries),
    fetchWeightsPage(db, userId, cursor?.weights),
    fetchCustomFoodsPage(db, userId, cursor?.customFoods),
    fetchFavouritesPage(db, userId, cursor?.favourites),
    db
      .select({ total: count(), days: countDistinct(entries.day), firstDay: min(entries.day), lastDay: max(entries.day) })
      .from(entries)
      .where(and(eq(entries.userId, userId), isNull(entries.deletedAt))),
    db.select({ total: count() }).from(weights).where(and(eq(weights.userId, userId), isNull(weights.deletedAt))),
    db
      .select({ total: count() })
      .from(customFoods)
      .where(and(eq(customFoods.userId, userId), isNull(customFoods.deletedAt))),
    db
      .select({ total: count() })
      .from(favourites)
      .where(and(eq(favourites.userId, userId), isNull(favourites.deletedAt))),
  ]);

  const profileChanged =
    profileRow && (!cursor?.profile || profileRow.updatedAt.getTime() > new Date(cursor.profile).getTime());
  const settingsChanged =
    settingsRow && (!cursor?.settings || settingsRow.updatedAt.getTime() > new Date(cursor.settings).getTime());

  const wireProfile: WireProfile | null = profileChanged && profileRow ? serializeProfile(profileRow) : null;
  const wireSettings: WireSettings | null = settingsChanged && settingsRow ? serializeSettings(settingsRow) : null;

  const entryCounts: EntryCounts = {
    total: entryAgg[0]?.total ?? 0,
    days: entryAgg[0]?.days ?? 0,
    firstDay: entryAgg[0]?.firstDay ?? null,
    lastDay: entryAgg[0]?.lastDay ?? null,
  };

  const lastChangeCandidates = [
    profileRow?.updatedAt ?? null,
    settingsRow?.updatedAt ?? null,
    entriesPage.latestUpdatedAt,
    weightsPage.latestUpdatedAt,
    customFoodsPage.latestUpdatedAt,
    favouritesPage.latestUpdatedAt,
  ].filter((d): d is Date => d !== null);
  const lastChangeAt =
    lastChangeCandidates.length > 0
      ? new Date(Math.max(...lastChangeCandidates.map((d) => d.getTime()))).toISOString()
      : null;

  return {
    cursor: {
      profile: profileRow ? profileRow.updatedAt.toISOString() : (cursor?.profile ?? null),
      settings: settingsRow ? settingsRow.updatedAt.toISOString() : (cursor?.settings ?? null),
      entries: entriesPage.cursor,
      weights: weightsPage.cursor,
      customFoods: customFoodsPage.cursor,
      favourites: favouritesPage.cursor,
    },
    hasMore: {
      entries: entriesPage.hasMore,
      weights: weightsPage.hasMore,
      customFoods: customFoodsPage.hasMore,
      favourites: favouritesPage.hasMore,
    },
    profile: wireProfile,
    settings: wireSettings,
    entries: entriesPage.rows,
    weights: weightsPage.rows,
    customFoods: customFoodsPage.rows,
    favourites: favouritesPage.rows,
    counts: {
      entries: entryCounts,
      weights: { total: weightAgg[0]?.total ?? 0 },
      customFoods: { total: customFoodAgg[0]?.total ?? 0 },
      favourites: { total: favouriteAgg[0]?.total ?? 0 },
      lastChangeAt,
    },
  };
}
