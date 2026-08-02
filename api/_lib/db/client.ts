/**
 * Database handle construction — shared by every `api/auth/*` and (later) `api/sync/*`
 * route.
 *
 * `Db` is typed against `PgDatabase<PgQueryResultHKT, typeof schema>` — the generic base
 * class both `NeonHttpDatabase` (production, `@neondatabase/serverless`'s HTTP driver)
 * and `PgliteDatabase` (tests, `@electric-sql/pglite`) extend — so a handler written
 * against `Db` accepts either without a cast at the call site, and the exact same
 * handler code path that runs in production is what `*.test.ts` exercises against a
 * real embedded Postgres. See docs/DB.md §1 for why PGlite, not a mock, is used in tests.
 */

import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import * as schema from './schema.js';

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

/**
 * Builds a DB handle from `DATABASE_URL`, or `null` if it is unset/blank.
 *
 * The caller's job is to turn `null` into `503 { error: 'sync_unconfigured' }` — this
 * mirrors `api/analyze-meal.ts`'s `ai_unconfigured` pattern exactly: an unconfigured
 * deployment is a supported state, answered honestly and cheaply, never a 500.
 */
export function createDb(): Db | null {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) return null;
  const sql = neon(url);
  return drizzle(sql, { schema });
}
