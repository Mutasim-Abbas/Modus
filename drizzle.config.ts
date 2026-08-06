import { defineConfig } from 'drizzle-kit';

// Scaffolding for P2.1 (backend) — this file has nothing to point at yet.
// `api/_lib/db/schema.ts` does not exist until P2.1 lands; api/_lib is where the rest of
// the server-only code already lives (http.ts, rate-limit.ts, validate.ts), so the schema
// follows that convention. Migrations are plain, reviewable SQL committed to `./drizzle`
// per the project plan §2 ("ORM + migrations").
//
// drizzle-kit reads `DATABASE_URL` from a local `.env` automatically (it bundles dotenv) —
// see .env.example. Never set a real connection string here or in the repo.
export default defineConfig({
  dialect: 'postgresql',
  schema: './api/_lib/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
  strict: true,
  verbose: true,
});
