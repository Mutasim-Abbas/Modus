# FitMacro v3 — Database

Owner: `backend-developer` (P2.1). Source of truth for the schema is
`api/_lib/db/schema.ts`; this document explains **why** each part of it exists, per
Mutasim's explicit instruction that the reasoning be written down, not just the SQL.
If this document and the schema ever disagree, the schema is what runs — file a fix here.

Read the project plan §2 (stack) and §3 (bounding sketch) first. This doc goes deeper than
that sketch in several places and says so inline wherever it deviates.

---

## 1. How this was verified — read this before trusting anything below

There is **no live Neon project yet** (that's `P5.1`, later). What follows is exactly
what was and wasn't run, stated plainly:

- **Ran for real:** `npm run db:generate` against `api/_lib/db/schema.ts` produced
  `drizzle/0000_cuddly_doorman.sql` (the full schema) and a hand-written
  `drizzle/0001_updated_at_triggers.sql` (the trigger, see §3). Both are committed.
- **Ran for real:** those two committed migration files were applied, unmodified, to a
  **real embedded Postgres** — [PGlite](https://pglite.dev) (`@electric-sql/pglite`,
  devDependency, WASM Postgres, not a mock or a hand-rolled SQL parser) — via
  `drizzle-orm/pglite/migrator`'s `migrate()`, the same migration-runner mechanism
  `drizzle-kit migrate` uses against a real connection string. See
  `api/_lib/db/schema.test.ts` (15 tests, all passing as of this writing). That suite
  proves, by actually executing SQL and reading results back, not by assertion:
  - both migration files apply cleanly to an empty database;
  - re-running `migrate()` on an already-migrated database is a no-op (idempotency);
  - deleting a `users` row cascades to `sessions`, `profiles`, `entries`, `weights`,
    `custom_foods`, `favourites` and `user_settings` — and that `auth_attempts` rows
    for that user's email **survive**, which is the one documented exception (§4.3, §5);
  - the `fitmacro_set_updated_at()` trigger overwrites a client-supplied `updated_at`
    on both `INSERT` and `UPDATE`;
  - `numeric` columns round-trip as exact decimal strings (`'0.10'`, not a float);
  - the check constraints (email lowercasing, weight/age ranges, the auth-attempts
    IP-hash shape guard, the one-live-weight-per-day partial unique index) actually
    reject the bad input they're meant to.
- **NOT run:** anything Neon-specific — the HTTP driver (`@neondatabase/serverless`),
  connection pooling behaviour, autosuspend/resume, or Neon's specific Postgres version
  and extension set. PGlite is a real Postgres engine but it is not Neon; this is a
  legitimate, disclosed gap, closed in `P5.1` when a real project exists.
- **NOT run:** `npm run db:migrate` itself (it needs a real `DATABASE_URL`; there is
  none yet). What was verified is functionally identical — the same committed SQL
  files, applied via the same underlying drizzle migration runner, to a real Postgres
  engine, from empty. `db:generate` (schema → SQL) **was** run for real, twice, and the
  second run reported `No schema changes, nothing to migrate`, which is what
  "idempotent" means at that step too.

---

## 2. Conventions that apply across every table

### 2.1 `timestamptz` everywhere, server-assigned

Every timestamp column is `timestamp with time zone`. Client clocks are never trusted
for anything that affects ordering or conflict resolution:

- `created_at`, `updated_at`, `expires_at`, etc. all default to `now()` at the database.
- For the six tables that sync (§4), `updated_at` is **additionally** pinned by a
  `BEFORE INSERT OR UPDATE` trigger, `fitmacro_set_updated_at()`
  (`drizzle/0001_updated_at_triggers.sql`), which unconditionally sets
  `NEW.updated_at := now()`. This is deliberately redundant with "application code
  will never send a client-supplied `updated_at`" (true today, and `P2.2`/`P2.3`'s job
  to keep true) — the trigger means that even if a future bug in the API layer forwards
  a client value, the database still refuses to honour it. Last-write-wins sync
  (the project plan §2) is only as trustworthy as this guarantee.
- The one deliberate exception is `entries.day` and `weights.day` (plain `date`, no
  time zone) and `entries.logged_at`: these are **domain data the user controls on
  purpose** — backdating to an earlier day is a real feature (the project plan P3.2), not
  a clock to defend against. They are never used for sync ordering or conflict
  resolution; `updated_at` is what LWW compares.

### 2.2 `numeric`, never `float`, for anything money-style

Every macro/weight column (`kcal`, `protein`, `carbs`, `fat`, `grams`, `*_kg`,
`*_cm`) is Postgres `numeric(precision, scale)`. Drizzle's `numeric()` column defaults
to `mode: 'string'` — deliberately left at that default everywhere in this schema, so a
value like `0.1 + 0.2` is never represented as a JS `double` anywhere between the
database and the API layer. Verified directly: `schema.test.ts` inserts `'0.1'` into a
`numeric(8,2)` column and reads back the exact string `'0.10'`, not a float-rounded
approximation.

### 2.3 UUIDs: server-random vs client-generated, on purpose

Two different UUID strategies are used, deliberately:

- `users.id`, `sessions.id`, `auth_attempts.id`: `uuid` with `.defaultRandom()`
  (`DEFAULT gen_random_uuid()`, built into Postgres core since v13 — **no extension
  required**, which matters because it must also work on whatever Postgres version
  Neon's free tier runs). These rows are only ever created server-side, so there is no
  reason for the client to mint the id.
- `entries.id`, `weights.id`, `custom_foods.id`: `uuid` **with no default**. The id is
  **client-generated** (UUIDv7-style per the project plan §2), because these rows must be
  creatable fully offline, and re-pushing the same id must be an idempotent upsert, not
  a duplicate insert — that's `P2.3`'s job, but the schema is what makes it possible.
- `favourites` has no `id` column at all — see §4.6.

### 2.4 Soft deletes (tombstones) vs real deletes — not the same rule everywhere

- **Six sync tables** (`profiles`, `entries`, `weights`, `custom_foods`, `favourites`,
  `user_settings`) are **soft-deleted**: `deleted_at timestamptz`, nullable. A sync
  pull has to be able to tell "this row was deleted since your last cursor" apart from
  "this row was never touched," and only a tombstone can do that (the project plan §2,
  "Sync model").
- **`users` is hard-deleted.** the project plan §4.1 is explicit: "delete account (real
  deletion, not a flag)." There is no `deleted_at` on `users`. Deleting the row is what
  cascades to every owned row (§4.1) — a real `DELETE`, not a flag flip, is what makes
  that cascade actually happen at the database level rather than needing every future
  query to remember to filter out "soft-deleted" accounts.
- **`sessions` uses neither.** A session is invalidated by setting `revoked_at`
  (logout, logout-everywhere, password-change rotation) or by `expires_at`/
  `absolute_expires_at` lapsing. The row is kept, not deleted or tombstoned, so account
  settings can show a device/session history. It is not part of the sync surface, so it
  carries no `updated_at`/`(user_id, updated_at)` index either — see §5 for what "known
  limitation" that leaves.

### 2.5 Enums vs `text` + `CHECK` — which one and why

Closed value sets that mirror a `src/types.ts` TypeScript union exactly (`sex`,
`activity_level`, `goal`, `meal_slot`, `entry_source`, `food_category`, `locale`,
`auth_attempt_scope`, `auth_attempt_action`) use native Postgres `ENUM` types. The
counter-argument — "enums are annoying to extend, `ALTER TYPE ... ADD VALUE` is a real
migration" — is true, but adding a value to any of these sets is **already** a code
change on the client (the TS union has to grow first), so the matching schema migration
carries no extra friction, and an enum gives stronger integrity (an invalid value is a
`22P02` at the database, not just at whatever validation layer remembered to check) and
smaller storage than `text` + a `CHECK ... IN (...)` list. Everywhere else (free text —
food names, session user-agent strings) is plain `text`, obviously not an enum candidate.

### 2.6 Every synced table's non-negotiable trio

Per the project plan P2.1: `profiles`, `entries`, `weights`, `custom_foods`,
`favourites` and `user_settings` **each** have `updated_at`, `deleted_at`, and a
`(user_id, updated_at)` btree index. This is what lets `P2.3`'s pull endpoint be one
query shape reused six times — `WHERE user_id = $1 AND updated_at > $2` — rather than
six bespoke ones. On the two 1-row-per-user tables (`profiles`, `user_settings`) this
index is nearly redundant with the primary key and costs close to nothing; it is kept
anyway so the promise is literally true, not "true except for the small tables."

---

## 3. The `updated_at` trigger — `drizzle/0001_updated_at_triggers.sql`

Drizzle's schema DSL has no first-class way to express a trigger, so this migration is
hand-written SQL (via `drizzle-kit generate --custom`, which reserves the correct slot
in `drizzle/meta/_journal.json` for it — it is a real, ordered migration, not a
side-channel script). It defines one function, `fitmacro_set_updated_at()`, and
attaches it `BEFORE INSERT OR UPDATE` on the six synced tables. It intentionally does
**not** touch `users`, `sessions` or `auth_attempts` — those aren't part of delta sync,
and their `created_at`/`updated_at`/`last_seen_at` semantics belong to `P2.2`'s
application code (e.g. `sessions.last_seen_at` is bumped on activity by the auth
middleware, not by a blanket trigger).

---

## 4. Tables

### 4.1 `users`

The account row. One per person; the login identifier is `email`.

| Column | Type | Why |
| --- | --- | --- |
| `id` | `uuid`, PK, `gen_random_uuid()` | Server-assigned identity; every other table's `user_id` points here. |
| `email` | `text`, not null | The login identifier. `email_verified` exists but v3 sends no email (the project plan §2, "Account recovery") — always `false` today, kept honest rather than removed, since a future Brevo integration is the documented upgrade path. |
| `email_verified` | `boolean`, default `false` | See above. |
| `password_hash` | `text`, not null | argon2id hash (`@node-rs/argon2`, `P2.2`). Never selected into an API response — that's a `P2.2`/audit concern, not enforceable at the schema layer, and is called out explicitly so it isn't forgotten. |
| `recovery_code_hash` | `text`, not null | argon2id hash of the one-time recovery code shown at signup (the project plan §2). |
| `created_at`, `updated_at` | `timestamptz`, default `now()` | Audit trail. Not part of sync — no client ever reads another user's account row, and a user's own account metadata isn't currently surfaced as a syncable "record" the way their data is. |

**No `deleted_at`.** Account deletion is real (§2.4); the row is `DELETE`d and the
cascade (§4.1 cascades below) does the rest inside one transaction.

**Constraints:**

- `UNIQUE (email)` — `users_email_key`. One account per email.
- `CHECK (email = lower(email))` — `users_email_lowercase`. **Deviation from
  the project plan §3's sketch**, which wrote `email citext unique`. `citext` needs a
  Postgres extension (`CREATE EXTENSION citext`), which is one more thing that has to
  be enabled on whatever database this ends up on (Neon today, PGlite in tests) and one
  more thing to verify rather than assume. Storing the email pre-lowercased and
  enforcing that invariant with a plain `CHECK` gets the same case-insensitive
  uniqueness with zero extension dependency, and it is portable to the PGlite test
  engine used in §1 with no extra setup. **This makes lowercasing the caller's
  responsibility** — `P2.2` must lowercase the email before every insert/lookup. That
  is now a documented contract, not an assumption; the `CHECK` is what turns a slip
  there into a hard `23514` at the database instead of a silent duplicate-account bug.
- `CHECK (length(btrim(email)) > 0)` — `users_email_not_blank`. Blocks a
  whitespace-only email from being valid input; belt-and-braces alongside `P2.2`'s zod
  validation, which is the real first line of defence.

### 4.2 `sessions`

Server-side session state. **Not** part of the sync surface — a session belongs to a
device/browser, not to the user's data.

| Column | Type | Why |
| --- | --- | --- |
| `id` | `uuid`, PK | Row identity; not the cookie value. |
| `user_id` | `uuid`, FK → `users.id` `ON DELETE CASCADE` | Row ownership. |
| `token_hash` | `text`, not null, unique | Hex-encoded `HMAC-SHA256(token, SESSION_PEPPER)`. The raw opaque 256-bit token (the project plan §2) is **never** stored — only its keyed hash. `text` storing hex, not `bytea`: the installed `drizzle-orm@0.45.2` ships no `bytea` pg-core column type at all (checked directly against `node_modules/drizzle-orm/pg-core/columns/`), and hex `text` is trivially indexable/comparable at a storage cost (2x the raw 32 bytes) that is irrelevant at this row count. |
| `created_at` | `timestamptz` | When the session was created. |
| `last_seen_at` | `timestamptz` | Bumped by `P2.2`'s auth middleware on each authenticated request — this is what "sliding 30-day expiry" slides against. |
| `expires_at` | `timestamptz` | The sliding expiry itself, pushed forward on activity. |
| `absolute_expires_at` | `timestamptz` | Hard 90-day cap, set once at creation, never extended — bounds how long a stolen-but-still-used token stays valid even under continuous activity (the project plan §2). |
| `user_agent` | `text`, nullable | For a future "your devices" list in account settings — a modern, low-cost feature the row shape already supports. |
| `ip_hash` | `text`, not null | Hashed at session creation with the same function as `auth_attempts.key` — **never the raw IP** (the project plan P2.1 non-negotiable). |
| `revoked_at` | `timestamptz`, nullable | Set on logout / logout-everywhere / password-change rotation. A session with `revoked_at` set must never authenticate again even if `expires_at` is still in the future — `P2.2`'s lookup must check `revoked_at IS NULL AND expires_at > now() AND absolute_expires_at > now()` together, not `expires_at` alone. |

**Indexes:**

- `UNIQUE (token_hash)` — `sessions_token_hash_key`. The lookup path for every
  authenticated request; also the thing that makes token collision structurally
  impossible.
- `(user_id)` — `sessions_user_id_idx`. Two jobs: makes "logout everywhere" (`UPDATE
  sessions SET revoked_at = now() WHERE user_id = $1`) an index scan instead of a
  sequential one, and — just as important — **Postgres does not automatically index
  the referencing side of a foreign key**, only the referenced side. Without this
  index, cascading `DELETE FROM users WHERE id = $1` would sequentially scan
  `sessions` to find rows to cascade-delete. Every child table below gets the
  equivalent via its `(user_id, updated_at)` index, which has `user_id` as the leading
  column and therefore serves the same purpose.

**Constraints:** `CHECK (token_hash ~ '^[0-9a-f]{64}$')` and `CHECK (ip_hash ~
'^[0-9a-f]{64}$')` — a schema-level guard that a hash-shaped value, not a raw token or
raw IP, is what's actually stored. This exists to catch a *future coding bug* at the
database (a hard failure) rather than in code review or, worse, in production logs. A
raw opaque 256-bit token base64url-encoded is ~43 characters, not 64 hex characters, so
these regexes meaningfully distinguish "looks like a proper hash" from "looks like the
secret itself" — this is not a decorative check.

### 4.3 `auth_attempts`

Postgres-backed rate limiting, per-IP and per-account (the project plan §2 — replacing
the in-memory limiter in `api/_lib/rate-limit.ts` for anything security-relevant).

| Column | Type | Why |
| --- | --- | --- |
| `id` | `uuid`, PK | Row identity. |
| `key` | `text`, not null | The rate-limited identifier: a hashed IP when `scope = 'ip'`, a lowercased email when `scope = 'account'`. |
| `scope` | enum `('ip', 'account')` | **Refinement of the project plan §3's sketch**, which had a single `kind` column holding `ip\|email`. Splitting into `scope` (which kind of key) and `action` (what was attempted) makes the sliding-window query (`WHERE key = ? AND scope = ? AND action = ? AND created_at > ?`) precise without string-parsing a combined field, and makes "throttle logins per-account" and "throttle logins per-IP" two clean, independently-tunable counters instead of one. |
| `action` | enum `('login', 'signup', 'password_change', 'recovery_redeem')` | What was attempted — lets signup abuse and login brute-force be throttled independently, which they should be (very different legitimate-use velocities). |
| `success` | `boolean`, default `false` | Recorded per attempt so `P2.2` can choose to only count *failures* toward a lockout while still counting *all* attempts toward a coarser velocity check — that policy choice belongs to `P2.2`, not this schema, but the column is what makes it possible. |
| `created_at` | `timestamptz`, default `now()` | The only timestamp this table needs — it's an append-only log, not a synced/editable record. |

**Indexes:**

- `(key, scope, action, created_at)` — `auth_attempts_window_idx`. Directly serves the
  sliding-window count query in that column order.
- `(created_at)` — `auth_attempts_created_at_idx`. Supports a future retention/purge
  job (`DELETE FROM auth_attempts WHERE created_at < now() - interval '...'`). **No
  such job exists yet** — recorded honestly in §5, not silently assumed.

**Constraint:** `CHECK (scope <> 'ip' OR key ~ '^[0-9a-f]{64}$')` —
`auth_attempts_ip_key_shape`. The literal, schema-enforced version of the acceptance
criterion "IPs are stored hashed, never raw": if `scope = 'ip'`, the `key` **must**
look like a 64-hex-char hash. `schema.test.ts` proves this rejects a raw dotted-quad
IP outright.

**Deliberately no foreign key to `users`.** This is the one documented exception to
"deleting a user cascades to every row they own" (the project plan P2.1's own wording).
Two independent reasons, both real:

1. A login attempt can target an email that was **never** registered — there is no
   `users` row to reference in the first place, so a `NOT NULL` FK is not even
   expressible.
2. If an account **is** deleted, its `auth_attempts` history under that email should
   **survive** the deletion. Otherwise "delete my account, sign up again with the same
   email" would reset an attacker's lockout clock for free — the exact opposite of
   what a security-focused rate limiter is for. `schema.test.ts`'s cascade test asserts
   this survival directly, not just the absence of an FK.

This is a genuine privacy/security trade-off, not a free lunch, and is recorded as such
in §5.

### 4.4 `profiles`

One row per user; mirrors `src/types.ts`'s `Profile` exactly. Synced.

| Column | Type | Why |
| --- | --- | --- |
| `user_id` | `uuid`, PK, FK → `users.id` `ON DELETE CASCADE` | 1:1 with the account; the PK **is** the FK, so there is no separate surrogate id to keep in sync with ownership. |
| `sex` | enum `('male', 'female')` | Mirrors `types.ts`'s `Sex`. |
| `age` | `integer` | Stored as the number the user typed, **not** derived from a birth date — the client never collects a birth date, and inventing one would be data the user never gave. |
| `height_cm`, `weight_kg` | `numeric(5,1)` | Not `float`, for the same reason as macros (§2.2) — precise enough for a scale/tape measure, never IEEE-754-approximated. |
| `activity` | enum `('sedentary','light','moderate','very','extra')` | Mirrors `types.ts`'s `ActivityLevel`. |
| `goal` | enum `('cut','maintain','bulk')` | Mirrors `types.ts`'s `Goal`. |
| `updated_at`, `deleted_at` | see §2.6 | |

**`bmr`/`tdee`/target macros are deliberately NOT stored here.** `src/lib/store.ts`
already treats `Targets` as derivable — its own comment reads "Targets are derivable —
recompute rather than lose the user's setup." `lib/macros.ts`'s `calculateTargets()` is
a pure function of `Profile`; storing its output server-side would just be a second
place for the number to go stale relative to the formula. The client recomputes
targets locally after every profile pull.

**Index:** `(user_id, updated_at)` — required uniformly (§2.6); on this 1-row table
it's nearly redundant with the PK, kept for query-shape uniformity in `P2.3`.

**Constraints:** `CHECK (age > 0 AND age < 130)`, `CHECK (height_cm > 0 AND height_cm <
300)`, `CHECK (weight_kg > 0 AND weight_kg < 500)` — sanity bounds that stop obviously
garbage data (a negative age, a zero height) from ever reaching the database, as
defence in depth behind `P2.2`'s zod validation, not a replacement for it.

### 4.5 `entries`

Logged food. Mirrors `src/types.ts`'s `LogEntry` plus the `day` bucket it lives under
in `AppState.days`. Synced. Client-generated id (§2.3).

| Column | Type | Why |
| --- | --- | --- |
| `id` | `uuid`, PK, no default | Client-generated; makes an offline-created entry and its eventual sync-push idempotent by id (`P2.3`). |
| `user_id` | `uuid`, FK → `users.id` `ON DELETE CASCADE` | Ownership. |
| `day` | `date`, not null | The calendar day this entry is logged against, in the timezone the client already resolved via `lib/date.ts`. **Not server-derived** — backdating to an arbitrary past day is an intended feature (the project plan P3.2), so this is domain data the user chose, not a clock to defend (§2.1). |
| `name`, `grams`, `kcal`, `protein`, `carbs`, `fat` | `text` / `numeric` | Mirrors `LogEntry` field-for-field; macros as `numeric` (§2.2), never `float`. |
| `meal` | enum `('breakfast','lunch','dinner','snack')` | Mirrors `types.ts`'s `MealSlot`. |
| `source` | enum `('food-db','scan','manual')` | Mirrors `types.ts`'s `EntrySource` — the honesty label the UI already shows for how an entry got its numbers. |
| `food_id` | `text`, nullable | Either a `src/data/foods.ts` static id or a `custom_foods.id`. **No foreign key** — see the callout below. |
| `logged_at` | `timestamptz`, not null | Client-supplied domain timestamp ("when I ate this"), explicitly **not** used for sync ordering or conflict resolution (§2.1) — `updated_at` is. |
| `updated_at`, `deleted_at` | see §2.6 | |

**Why `food_id` has no foreign key:** it can point at one of two fundamentally
different things — a `src/data/foods.ts` entry, which is **static client bundle data
with no server-side table at all**, or a `custom_foods.id`, which does exist server-
side. A single column that can validly reference "one of two possible tables, one of
which isn't a table" cannot be expressed as a real FK without either faking one target
or splitting the column in a way the client doesn't need. The macros on the row are
already fully denormalised from whatever `food_id` might have pointed at (`name`,
`grams`, `kcal`, `protein`, `carbs`, `fat` are all copied onto the entry at log time),
so a stale, dangling, or later-tombstoned `food_id` **cannot corrupt a historical
entry** — this mirrors how the client already works (`LogEntry` carries its own
macros, not a live reference).

**Indexes:**

- `(user_id, updated_at)` — `entries_user_updated_idx`. Sync delta pull (§2.6).
- `(user_id, day) WHERE deleted_at IS NULL` — `entries_user_day_idx`. Partial: the
  "what's logged today / on this day" read (Log, History, backdate views) should never
  have to skip past tombstones, and a live-rows-only index is both smaller and faster
  for that specific, very common query.

**Constraints:** range checks on `grams`/`kcal`/`protein`/`carbs`/`fat` (all `>= 0`,
each bounded well above any real food's plausible values — generous enough to never
reject genuine data, tight enough to catch a decimal-place bug or a bad AI-scan
estimate before it lands in the log) and `CHECK (length(btrim(name)) > 0)` — an entry
must have a name.

### 4.6 `weights`

Body-weight log. Synced. Client-generated id.

| Column | Type | Why |
| --- | --- | --- |
| `id` | `uuid`, PK, no default | Same reasoning as `entries.id`. |
| `user_id` | `uuid`, FK → `users.id` `ON DELETE CASCADE` | Ownership. |
| `day` | `date` | The day this weigh-in belongs to. |
| `weight_kg` | `numeric(5,1)` | Not `float` (§2.2). |
| `updated_at`, `deleted_at` | see §2.6 | |

**Indexes:**

- `(user_id, updated_at)` — `weights_user_updated_idx`. Sync delta pull.
- `UNIQUE (user_id, day) WHERE deleted_at IS NULL` — `weights_user_day_live_key`. One
  **live** weigh-in per user per day is the domain rule from the project plan §3's
  sketch. The index is **partial** on purpose: if the user deletes today's weight and
  logs a new one, the tombstoned row must not permanently occupy that day — verified
  directly in `schema.test.ts` (`allows a new live weight for the same day once the
  first is tombstoned`).

**Constraint:** `CHECK (weight_kg > 0 AND weight_kg < 500)`.

### 4.7 `custom_foods`

User-entered foods. Mirrors `src/types.ts`'s `Food` shape minus `per` (see below).
Synced. Client-generated id.

| Column | Type | Why |
| --- | --- | --- |
| `id` | `uuid`, PK, no default | Same reasoning as `entries.id`. |
| `user_id` | `uuid`, FK → `users.id` `ON DELETE CASCADE` | Ownership. |
| `name`, `category`, `kcal`, `protein`, `carbs`, `fat` | mirrors `Food` | `category` is the `food_category` enum (§2.5), the exact 9-value union from `types.ts`'s `FoodCategory`, including the two multi-word/`&` values (`'fats & nuts'`, `'turkish & middle eastern'`) — Postgres enum labels handle arbitrary strings fine. |
| `common_portions` | `jsonb`, default `'[]'` | `[{ label, grams }]`. `jsonb`, not a join table: the list is small, never independently queried (no "find all foods with a 200 g portion" feature exists or is planned), and the "modern capabilities where they help" guidance in the project plan points exactly at this kind of shape. |
| `updated_at`, `deleted_at` | see §2.6 | |

**Not stored:** a `per` column. `Food['per']` in `types.ts` is a fixed literal `100` —
every custom food is per-100g **by contract**, not by per-row choice. Storing it would
only create a column that could lie about the unit a row uses; the fixed contract is
enforced by never giving a row the option to say otherwise.

**Indexes:**

- `(user_id, updated_at)` — `custom_foods_user_updated_idx`. Sync delta pull.
- `(user_id) WHERE deleted_at IS NULL` — `custom_foods_user_live_idx`. Serves "list my
  live custom foods" (search/autocomplete) without a tombstone-filtering sequential
  scan.

**Constraints:** non-negative range checks on the four macro columns (`kcal < 10000`,
`protein`/`carbs`/`fat < 1000` — generous for a single 100 g reference value, tight
enough to catch a fat-fingered extra digit), `CHECK (length(btrim(name)) > 0)`,
and `CHECK (jsonb_typeof(common_portions) = 'array')` — a database-level guarantee that
this column is always a JSON array, never an object or a scalar, so `P2.3`/the client
never has to defensively type-check its shape on the way out.

**Deliberately not added: full-text search.** the project plan's "modern capabilities"
guidance mentions full-text search as a general option; it is **not** added here (no
`tsvector` column, no GIN index) because nothing in scope queries it — the only search
surface in the project plan's v3 plan is `src/lib/search.ts`, entirely client-side, over
data already synced down. Adding a server-side search index nothing calls would be
exactly the "speculative abstraction" the project's own working rules reject.

### 4.8 `favourites`

A toggle per `(user, food)`. Synced. **No `id` column** — the natural key `(user_id,
food_id)` **is** the identity.

| Column | Type | Why |
| --- | --- | --- |
| `user_id` | `uuid`, FK → `users.id` `ON DELETE CASCADE` | Ownership; first half of the composite PK. |
| `food_id` | `text`, not null | Same heterogeneous built-in-or-custom reference as `entries.food_id` (§4.5) — same no-FK reasoning applies identically. Second half of the composite PK. |
| `updated_at`, `deleted_at` | see §2.6 | |

**Why no surrogate `id`:** unlike `entries`/`weights`/`custom_foods`, a favourite has
no independent existence separate from the `(user, food)` pair it toggles — you cannot
have two favourites of the same food for the same user, ever, by definition. Making the
natural key the primary key means `P2.3`'s push handler can do a single
`INSERT ... ON CONFLICT (user_id, food_id) DO UPDATE SET updated_at = now(), deleted_at
= <null or now()>` with **no client-side UUID coordination needed for this table at
all** — proven directly in `schema.test.ts`'s "idempotent by natural key" test using
exactly that `onConflictDoUpdate` shape.

**Constraint:** `PRIMARY KEY (user_id, food_id)` — `favourites_user_id_food_id_pk`.

**Index:** `(user_id, updated_at)` — `favourites_user_updated_idx`. Sync delta pull;
`user_id` as the leading column also covers the FK-cascade-lookup need (§4.2's callout).

### 4.9 `user_settings`

One row per user. Synced.

| Column | Type | Why |
| --- | --- | --- |
| `user_id` | `uuid`, PK, FK → `users.id` `ON DELETE CASCADE` | 1:1 with the account, same shape as `profiles`. |
| `locale` | enum `('en', 'ar')`, default `'en'` | The two languages actually in scope for v3 (the project plan P3.5 — English + Arabic, RTL). |
| `reduced_motion` | `boolean`, default `false` | Mirrors `types.ts`'s `Settings.reducedMotion`. |
| `updated_at`, `deleted_at` | see §2.6 | |

**Deliberately NOT included: `theme`.** the project plan §3's bounding sketch lists a
`theme` column. It is cut here, on purpose, for the **identical reason** the project plan
§4 already cut `Settings.units: 'metric'` from the client type: there is exactly one
theme in this codebase today. A `theme` column with nothing to hold but one constant
value would be precisely the "a type stub implying an unbuilt capability is the same
lie one layer down" anti-pattern the project explicitly rejected once already. This is
a deliberate deviation from the sketch, not an oversight — recorded here, and in a code
comment on `userSettings` in `schema.ts`, so it's visible rather than silently dropped.
Add it back in a real migration alongside the UI feature that needs it.

**Also NOT included: `Settings.units`.** the project plan §4 already cut this from the
client type entirely (dead single-value union); there is nothing to sync, so there is
nothing to store.

**Index:** `(user_id, updated_at)` — `user_settings_user_updated_idx`. Same "uniform
query shape across all six synced tables" reasoning as `profiles` (§4.4).

---

## 5. Cascades — the full picture, and the one exception

the project plan P2.1's acceptance criterion: **"deleting a user cascades to every row
they own, proven by a test, not asserted."** Every foreign key to `users.id` in this
schema is declared `ON DELETE CASCADE`:

```
sessions.user_id      → users.id  ON DELETE CASCADE
profiles.user_id      → users.id  ON DELETE CASCADE
entries.user_id       → users.id  ON DELETE CASCADE
weights.user_id       → users.id  ON DELETE CASCADE
custom_foods.user_id  → users.id  ON DELETE CASCADE
favourites.user_id    → users.id  ON DELETE CASCADE
user_settings.user_id → users.id  ON DELETE CASCADE
```

`DELETE FROM users WHERE id = $1` is therefore a single statement (inside whatever
transaction `P2.2`'s delete-account handler wraps it in) that removes every row the
user owns across all seven tables above, in one cascade, at the database level — not
seven separate `DELETE` statements that a bug could forget one of. This is proven by
execution, not just by reading the `ON DELETE CASCADE` clauses: see
`schema.test.ts`'s `deleting a user cascades to every row they own` test, which inserts
a row into every one of those seven tables for one user, deletes the user, and asserts
all seven are gone.

**The one documented exception is `auth_attempts`**, which has no foreign key to
`users` at all — see §4.3 for the full reasoning (an attempt can target a never-
registered email, and rate-limit history for an email must survive that email's
account being deleted, or account deletion becomes a lockout-bypass trick). This is a
conscious trade-off between "delete everything this user owns" and "don't let account
deletion reset an attacker's clock," resolved in favour of the latter because
`auth_attempts` rows contain no data more sensitive than "this email/IP attempted this
action at this time" — not the kind of personal data the "real deletion" promise in
the project plan §4.1 is about.

---

## 6. Known limitations — recorded honestly, not hidden

- **No session/auth_attempts retention job yet.** `sessions` rows are never deleted,
  only marked `revoked_at` or left to expire; `auth_attempts` grows forever. Both have
  an index (`sessions_user_id_idx`, `auth_attempts_created_at_idx`) that a future purge
  job could use efficiently, but no such job exists in this phase. At Neon's free tier
  (0.5 GB) this is not an immediate concern for a personal project's user count, but
  it is a real gap for a production deployment at scale.
- **`auth_attempts.key` stores the account-scope value (lowercased email) in plain
  text, not hashed.** Only the acceptance criterion's literal requirement — IPs hashed,
  never raw — is enforced at the schema level (§4.3's `CHECK`). Emails are already
  stored in plaintext in `users.email` as the (unverified) login identifier, so this is
  consistent with that, not a new exposure, but hashing it too would be modest
  additional hardening, deferred rather than silently assumed done.
- **PGlite, not Neon, was used for verification (§1).** Real Neon-specific behaviour —
  the HTTP driver, connection handling under Vercel's serverless model, autosuspend/
  resume timing — is unverified until `P5.1`.
- **No seed script in this task.** A dev-data seed script is normal for this kind of
  project, but there is no database to run it against yet (no Neon project exists
  until `P5.1`), so writing one now would be unverifiable and is deferred rather than
  shipped untested.
- **`gen_random_uuid()` requires Postgres ≥ 13.** Not a concern for Neon (which runs a
  current Postgres major version) or for PGlite (ships a modern Postgres build), stated
  here only so the assumption is explicit rather than silent.

---

## 7. Regenerating / extending the schema

```
npm run db:generate   # schema.ts → a new drizzle/000N_*.sql, only when the TS changes
npm run db:migrate     # applies drizzle/*.sql to $DATABASE_URL, in order, idempotently
npm run db:studio      # drizzle-kit's local DB browser, against $DATABASE_URL
```

Adding or changing a trigger, extension, or anything else Drizzle's DSL can't express
directly: `npx drizzle-kit generate --custom --name <description>` reserves the next
slot in the journal and hands you an empty `.sql` file to fill in by hand — that's how
`drizzle/0001_updated_at_triggers.sql` was made. Never hand-edit an already-committed
migration file that may have run somewhere; add a new one instead, the same rule that
applies to any other migration tool.
