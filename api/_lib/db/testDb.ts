// @vitest-environment node
//
// Shared PGlite test fixture for every `api/auth/*.test.ts` file — factored out of
// `schema.test.ts`'s `freshDb()` so every auth test exercises the exact same real
// (embedded WASM) Postgres, via the exact same committed migrations, without repeating
// the setup five times over. Not a route, not shipped: `api/_lib/` paths are skipped by
// Vercel's api builder (see api/_lib/http.ts's header comment).

import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import type { Db } from './client.js';
import * as schema from './schema.js';

const MIGRATIONS_FOLDER = resolve(process.cwd(), 'drizzle');

export interface TestDb {
  db: Db;
  client: PGlite;
  close: () => Promise<void>;
}

/** A fresh, fully-migrated, real Postgres (via PGlite) for one test. */
export async function freshTestDb(): Promise<TestDb> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return { db, client, close: () => client.close() };
}

/** A syntactically valid 32-byte-hex pepper, standing in for a real `SESSION_PEPPER`. */
export const TEST_PEPPER = 'f'.repeat(64);
