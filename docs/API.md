# FitMacro API

Three surfaces today: the AI meal-scan endpoint (v2, unchanged), the auth endpoints
(`api/auth/*`, `P2.2`), and the sync endpoints (`api/sync/*`, `P2.3` — delta pull/push of
entries/profile/weights/custom foods/favourites/settings). Everything below is either
implemented and tested today, or explicitly marked otherwise.

> **`analyze-meal` status: implemented.** `api/analyze-meal.ts` (+ `api/_lib/`) serves
> that contract, and both sides are tested — the client in `src/lib/api.ts`, the function
> in `api/analyze-meal.test.ts` and `api/_lib/*.test.ts`. Tests mock the Anthropic SDK:
> they never make a real API call and never need a key.
>
> **The AI scan is off until an `ANTHROPIC_API_KEY` is set in the deployment.** That is a
> supported state, not a broken one: the function returns `503 ai_unconfigured`, scanning
> disables itself with an honest message, and everything else (food database, logging,
> planner, history) keeps working offline.
>
> **`api/auth/*` status: implemented (`P2.2`).** Server-side code and tests exist —
> `api/auth/*.ts` (+ `api/_lib/auth/*`, `api/_lib/db/*`) — and are exercised against a
> real embedded Postgres (PGlite), not a mock; see "How this was verified" below. **No
> frontend UI exists yet** — that is `P4.1`. Until then, this section is the contract for
> whoever builds that screen. **Auth is off until both `DATABASE_URL` and
> `SESSION_PEPPER` are set** — every `api/auth/*` route returns
> `503 { "error": "sync_unconfigured" }` if either is missing, the same pattern as
> `ai_unconfigured`, and the app must stay fully usable in guest mode regardless
> (`docs/PLAN.md` §2).
>
> **`api/sync/*` status: implemented (`P2.3`).** `api/sync/pull.ts` and `api/sync/push.ts`
> (+ `api/_lib/sync/*`) exist and are exercised the same way auth is — against a real
> embedded Postgres, calling the exact handler that ships. **No sync engine or merge UI
> exists on the client yet** — that is `P4.2`; this section, plus `docs/DESIGN.md` §7.11,
> is the contract it builds against. Same `503 sync_unconfigured` gate as auth.

---

## `POST /api/analyze-meal`

Estimates the macros in a photo of a meal.

### Request

```jsonc
{
  "imageBase64": "iVBORw0KGgo...", // raw base64, NO "data:image/jpeg;base64," prefix
  "mediaType": "image/jpeg"        // "image/jpeg" | "image/png" | "image/webp"
}
```

Constraints enforced by the client before it sends (`src/lib/api.ts`):

| Rule | Value |
| --- | --- |
| Max decoded image size | 5 MB (`MAX_IMAGE_BYTES`) |
| Allowed media types | `image/jpeg`, `image/png`, `image/webp` |

The server must re-check both; the client check is a courtesy, not a security boundary.

### 200 — success

```jsonc
{
  "items": [
    {
      "name": "Grilled chicken breast",
      "grams": 150,
      "kcal": 248,
      "protein": 46,
      "carbs": 0,
      "fat": 5,
      "confidence": 0.85   // 0..1, the model's own stated confidence
    }
  ],
  "totals": { "kcal": 248, "protein": 46, "carbs": 0, "fat": 5 },
  "note": "Portion size estimated from the plate; the rice may be under-counted."
}
```

Client behaviour on 200:

- Items with a blank `name` are dropped.
- Negative or non-numeric macros are coerced to `0`.
- `confidence` is clamped to `0..1`, defaulting to `0` when absent.
- `totals` is recomputed from `items` if the server omits it.
- **Zero items is not an error status**, but the UI reports "no food identified" and logs
  nothing rather than logging zeroes.
- Every number lands in an **editable review step**. Nothing is logged without the user
  pressing confirm.

### Error responses

| Status | Body | Client `kind` | What the user sees |
| --- | --- | --- | --- |
| 400 | `{ "error": "invalid_input" }` | `invalid_input` | "That image couldn't be read." |
| 413 | `{ "error": "too_large" }` | `too_large` | "That photo is too large (5 MB max)." |
| 429 | `{ "error": "rate_limited" }` | `rate_limited` | "Too many scans right now." |
| 503 | `{ "error": "ai_unconfigured" }` | `ai_unconfigured` | **Feature disabled** with an honest message |
| 404 | (endpoint not deployed) | `not_deployed` | Same as 503 |
| 5xx | any | `server` | "The scan failed on the server. Nothing was logged." |
| — | network failure | `network` | "Couldn't reach the server." |
| — | non-JSON / malformed 200 | `malformed_response` | "The server sent back something unexpected." |

### The 503 contract — important

When `ANTHROPIC_API_KEY` is unset, the function **must** return:

```json
{ "error": "ai_unconfigured" }
```

with status `503`. It must not throw, must not return a fake result, and must not 500.

On receiving it the client:

1. Shows "AI scanning isn't configured on this deployment" and points the user to the
   food database instead.
2. Removes the uploader, and remembers the state **in memory for the session**
   (`src/features/scan/availability.ts`) so the user is not invited to fail again.
3. Deliberately does **not** persist that flag — a redeploy that adds the key should not
   have to fight a stale value in someone's localStorage.

A `404` is treated identically, so the app behaves correctly before the function ships.

---

## Server implementation notes

These are requirements from the project brief, restated here for whoever builds the
function. The frontend does not depend on them beyond the contract above.

- Use the official **`@anthropic-ai/sdk`**. Never raw `fetch`, never an OpenAI shim.
- Model **`claude-opus-4-8`** exactly. `max_tokens: 16000`.
- `thinking: { type: "adaptive" }`. Do **not** send `budget_tokens` — it 400s on Opus 4.8.
- Do **not** send `temperature` / `top_p` / `top_k` — they 400 on Opus 4.8.
- Structured output via `output_config: { format: { type: "json_schema", schema } }`
  (or `client.messages.parse()` with `zodOutputFormat`). Not the deprecated `output_format`.
- Vision: the base64 image content block goes **before** the text block.
- Key from `process.env.ANTHROPIC_API_KEY`. Never logged, never returned, never bundled.
- Guardrails: ~5 MB cap, per-IP rate limit, reject non-image media types.

### Guardrails as built

| Guardrail | Implementation |
| --- | --- |
| Size | Rejected from the base64 length *before* decoding, then re-checked on the decoded buffer. 5 MB. |
| Media type | Allowlist (`jpeg`/`png`/`webp`) **and** magic-byte sniffing — the declared type must match the actual bytes, so arbitrary content can't be relabelled and forwarded upstream. |
| Base64 | Strict alphabet check first. `Buffer.from(s, 'base64')` silently discards junk, so it can "succeed" on non-base64 input. |
| Method | Non-POST → 405 with `Allow: POST`. |
| Key | Read from `process.env` only; checked before the body is even parsed. Never logged, returned, or bundled. |
| Timeout | 50s client-side, under the 60s `maxDuration` set for `api/**` in `vercel.json`. Without that setting Vercel would kill the function at its 10s default — a vision call with adaptive thinking does not reliably finish in 10s. |

**Rate limiting — honest limitation.** The limiter (`api/_lib/rate-limit.ts`) is a fixed
window held **in the memory of a single serverless instance**. Vercel runs many instances
and recycles them freely, so the real ceiling is roughly
`10 requests/min × active instances`, and any cold start resets the count to zero. It is a
courtesy brake against one client hammering the scan button — **not** a durable defence
against a determined attacker. Durable limiting needs shared state (Vercel KV / Upstash).
This is documented rather than papered over.
- Catch typed SDK errors (`Anthropic.RateLimitError`, `Anthropic.APIError`) — no string
  matching on error messages.
- Prompt the model to estimate honestly, return a per-item `confidence`, and say in
  `note` when it cannot tell. The UI presents all of it as an estimate.

## Client reference

| Export | Purpose |
| --- | --- |
| `analyzeMeal({ imageBase64, mediaType, signal })` | POSTs and returns a parsed `AnalyzeMealResponse`. Throws `AnalyzeError`. |
| `AnalyzeError` | Typed error carrying `kind` and `isFeatureUnavailable`. |
| `analyzeErrorMessage(error)` | User-facing copy for every `kind`. |
| `parseAnalyzeResponse(payload)` | Validates an untrusted response body. |
| `parseDataUrl(dataUrl)` | Splits a data URL into `{ base64, mediaType }`. |
| `fileToDataUrl(file)` | Reads a `File` into a data URL. |

Covered by `src/lib/api.test.ts` and `src/features/scan/ScanScreen.test.tsx`.

---

# Auth API (`api/auth/*`) — `P2.2`

Built per `docs/PLAN.md` §2 and `docs/TODO.md` P2.2. No auth SaaS — first-party,
DB-backed sessions, so every line of it is auditable and every session is genuinely
revocable (the reason it is **not** JWT).

## How this was verified

Every route below is exercised in `api/auth/*.test.ts` against a **real embedded
Postgres** (`@electric-sql/pglite`, via `api/_lib/db/testDb.ts`), running the exact
committed migrations from `P2.1`, calling the exact handler function that ships — not a
mock of the database, not a mock of argon2id hashing. What is **not yet verified**:
Neon-specific behaviour (same disclosed gap as `docs/DB.md` §1, closed in `P5.1`), and
there is **no frontend UI for any of this yet** (`P4.1`).

## The session cookie

Every successful signup/login/change-password/recovery-redeem sets:

```
__Host-fm_session=<opaque-256-bit-token>; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=<seconds>
```

- **Opaque, not a JWT.** The cookie value is meaningless on its own; the server looks up
  `SHA-256-family-HMAC(token, SESSION_PEPPER)` against `sessions.token_hash` on every
  request. The raw token is never stored — see `docs/DB.md` §4.2.
- **`__Host-` prefix**: requires (and gets) `Secure`, `Path=/`, and no `Domain`
  attribute — browsers refuse to set the cookie otherwise, which is a second, browser-
  enforced guarantee on top of the server's own flags.
- **Sliding 30-day expiry, hard 90-day cap.** Every authenticated request (including
  `GET /api/auth/me`) pushes `expires_at` forward by 30 days from *now*, capped at
  `absolute_expires_at` (set once, at session creation, never extended) — so a session
  used continuously still dies at 90 days, bounding how long a stolen-but-still-used
  token stays valid.
- **Rotated on password change and on recovery-code redemption**: every other live
  session for the account is revoked and a fresh one is issued for the device that made
  the request.
- The client **never reads or stores the token itself** — it is `HttpOnly`. The frontend
  only ever knows "am I signed in", answered by calling `GET /api/auth/me`.

## CSRF — `Origin`/`Sec-Fetch-Site` on every mutating request

Every `POST` route below rejects with `403 { "error": "origin_rejected" }` unless the
request can be attributed to this app's own origin: a matching `Origin` header, or
(when `Origin` is absent) `Sec-Fetch-Site: same-origin` / `none`. A request with neither
header is rejected, not assumed same-origin — see `api/_lib/auth/origin.ts`. This is
belt-and-braces on top of the cookie's own `SameSite=Lax`. `GET /api/auth/me` is
read-only and does not apply this check.

## Rate limiting — Postgres-backed, survives a cold start

Unlike `api/_lib/rate-limit.ts` (in-memory, resets on every serverless cold start — fine
for the scan button, not fine for auth), every route below counts real rows in the
`auth_attempts` table (`api/_lib/auth/rate-limit-db.ts`), keyed independently **per-IP**
(hashed IP) and **per-account** (the lowercased email as submitted, whether or not it is
a real account — see `docs/DB.md` §4.3 for why). Both counters must clear for a request
to proceed; either tripping returns `429 { "error": "rate_limited" }` with a
`Retry-After` header. Current thresholds (`RATE_LIMIT_RULES` in that file):

| Action | Per-IP | Per-account |
| --- | --- | --- |
| `login` | 20 / 15 min | 8 / 15 min |
| `signup` | 10 / hour | 5 / hour |
| `password_change` (also used by `delete-account`, see below) | 30 / hour | 10 / hour |
| `recovery_redeem` | 20 / hour | 5 / hour |

`Retry-After` is the rule's window length, not the exact time until the oldest counted
attempt expires — a conservative, honestly-approximate upper bound, not a precise value.

## User enumeration — none on login or recovery; **deliberate on signup**

> The heading here used to read "No user enumeration", which claimed more than the
> implementation delivers (the internal security audit **F-12**). The behaviour below is unchanged
> and is the right behaviour; only the claim is corrected. For a nutrition and body-weight
> app, "does this person have a FitMacro account" is itself personal information, so the
> honest statement matters: **login and recovery leak nothing; signup discloses existence,
> on purpose.**

`POST /api/auth/login` and `POST /api/auth/recovery-redeem` are the two identity-proving
endpoints without a prior authenticated session, and both are enumeration-safe: a
non-existent email and a wrong password/recovery-code produce the **identical** status
(`401`), body (`{ "error": "invalid_credentials" }` / `{ "error": "recovery_invalid" }`),
and cost — a fixed, pre-computed dummy hash is verified when the account doesn't exist,
so exactly one `argon2id`/`scrypt` verify call runs either way
(`api/_lib/auth/password.ts`'s `getDummyHash()`). Verified directly in
`api/auth/login.test.ts` and `api/auth/recovery-redeem.test.ts`, including a best-effort
timing assertion (documented there as approximate, not a substitute for the structural
guarantee).

`POST /api/auth/signup`, by contrast, **does** say `409 { "error": "email_taken" }` for a
duplicate email — a deliberate, different choice: revealing that at signup is normal,
expected UX (how else does the user learn to sign in instead?), and the acceptance
criterion about enumeration is specifically about login. Signup is still rate-limited
per-IP and per-account to slow a scan.

**A concurrent duplicate is also `409`, not `500`** (the internal security audit F-07). There is no
transaction on `neon-http`, so two simultaneous signups for one email both pass the
existence check and both insert; the `users_email_key` unique index means only one account
is ever created, and the loser's unique violation is caught and reported as the same
`409 email_taken`. A client never needs to treat "email taken" as a possible server fault.

## Account recovery — no email in v3

`docs/PLAN.md` §2: v3 sends no email at all. The recovery code shown once at signup is
the **entire** recovery mechanism. It is single-use and **regenerable by construction**:
every successful `recovery-redeem` call rotates it — the code just used stops verifying,
and a brand-new one is returned in that same response, shown once, exactly like signup.
There is no separate "regenerate my recovery code" endpoint; redemption already requires
proving possession of the current one.

## Errors common to every route below

| Status | Body | When |
| --- | --- | --- |
| 503 | `{ "error": "sync_unconfigured" }` | `DATABASE_URL` or `SESSION_PEPPER` unset. Checked first, before parsing the body. |
| 405 | `{ "error": "method_not_allowed" }` | Wrong HTTP method. `Allow` header names the right one. |
| 400 | `{ "error": "invalid_input" }` | Body fails zod validation — wrong shape, wrong type, unrecognised extra key (mass-assignment guard: every schema is `.strict()`), or unparseable JSON. |
| 413 | `{ "error": "too_large" }` | Body exceeds 8 KB — every legitimate auth body (email, password(s), recovery code) is a fraction of that. Enforced by a byte-capped streaming read, not a trusted `Content-Length` header, so an oversized/JSON-bomb-shaped body is rejected before it is ever fully buffered or parsed (`api/_lib/auth/schemas.ts`). |
| 403 | `{ "error": "origin_rejected" }` | Mutating (`POST`) request only — see CSRF above. |
| 429 | `{ "error": "rate_limited" }` | See rate limiting above. `Retry-After` header set. |
| 500 | `{ "error": "server_error" }` | Anything unexpected. Never a stack trace or internal detail in the body; logged server-side with only the error's `name`, never a secret. |

## `POST /api/auth/signup`

Request: `{ "email": string, "password": string }` (password 8–256 chars; no
composition rule — see `api/_lib/auth/schemas.ts` for why length-only is the current
NIST-aligned guidance).

201 response, cookie set:

```jsonc
{
  "user": { "id": "uuid", "email": "user@example.com", "emailVerified": false, "createdAt": "2026-07-31T12:00:00.000Z" },
  "recoveryCode": "ABCD-EFGH-JKMN-PQRS" // shown ONCE — never retrievable again
}
```

Additional error: `409 { "error": "email_taken" }`.

## `POST /api/auth/login`

Request: `{ "email": string, "password": string }`.

200 response, cookie set: `{ "user": { ...same shape as signup } }`.

Additional error: `401 { "error": "invalid_credentials" }` — see "No user enumeration"
above; identical for a wrong password and a non-existent email.

## `POST /api/auth/logout`

No body. Always `200 { "ok": true }` with the cookie cleared
(`Max-Age=0`), whether or not a session existed — idempotent by design, since there is
nothing a client could usefully retry differently. Revokes exactly the calling device's
session; a replayed copy of the old cookie fails afterward (`401` from `/me` or any
authenticated route).

## `POST /api/auth/logout-all`

Requires a valid session cookie. No body. `200 { "ok": true }`, cookie cleared. Revokes
**every** live session for the account — "log out everywhere" — including the one that
made the request.

Error: `401 { "error": "unauthorized" }` with no/invalid session.

## `POST /api/auth/change-password`

Requires a valid session cookie. Request:
`{ "currentPassword": string, "newPassword": string }`.

200 response, **new** cookie set (rotation): `{ "user": { ... } }`. Every previously live
session for the account (including the one making this call) is revoked; a fresh one
replaces it.

Errors: `401 { "error": "unauthorized" }` (no session) or
`401 { "error": "invalid_credentials" }` (wrong `currentPassword`). Rate-limited under
the `password_change` action.

## `POST /api/auth/delete-account`

Requires a valid session cookie **and** the current password — a stolen-but-live session
alone is not enough to destroy the account. Request: `{ "password": string }`.

200 response: `{ "ok": true }`, cookie cleared. Real deletion — a single
`DELETE FROM users WHERE id = $1`, which cascades to every row the account owns in one
statement (`docs/DB.md` §5): sessions, profile, entries, weights, custom foods,
favourites, settings. `auth_attempts` for that email deliberately survives (documented
exception, same doc).

Errors: `401 { "error": "unauthorized" }` (no session) or
`401 { "error": "invalid_credentials" }` (wrong password). **Rate-limited under the same
`password_change` action/bucket as change-password** — a deliberate reuse rather than
adding a new `auth_attempts.action` enum value (a real migration) for a second
password-verification flow with the same abuse shape; recorded here and in
`api/auth/delete-account.ts`.

## `POST /api/auth/recovery-redeem`

No prior session needed — this *is* the recovery path. Request:
`{ "email": string, "recoveryCode": string, "newPassword": string }`. The code is
accepted case-insensitively and with or without its display dashes (normalized before
hashing/verifying — `api/_lib/auth/recovery.ts`).

200 response, cookie set (the caller is now logged in):

```jsonc
{
  "user": { ... },
  "recoveryCode": "NEW1-CODE-SHOWN-ONCE" // the OLD code no longer works after this call
}
```

Additional error: `401 { "error": "recovery_invalid" }` — identical for a wrong code and
a non-existent email (see "No user enumeration" above).

## `GET /api/auth/me`

Requires a valid session cookie. No `Origin` check (read-only). `200 { "user": { ... } }`
on success, refreshing the sliding expiry and re-issuing the cookie with the new
`Max-Age`. `401 { "error": "unauthorized" }` with no/invalid/expired/revoked session.

## What every `user` object contains — and never contains

```jsonc
{ "id": "uuid", "email": "user@example.com", "emailVerified": false, "createdAt": "ISO-8601" }
```

`password_hash` and `recovery_code_hash` are never selected into any response body and
never logged — enforced structurally by `api/_lib/auth/users.ts`'s `toPublicUser()`,
which is the **only** place a `users` row is turned into a client-facing shape anywhere
in this codebase; there is no other code path that spreads a raw row into JSON.

## Known limitations — recorded honestly

- **No true multi-statement transactions.** `@neondatabase/serverless`'s HTTP driver
  (`neon-http`) does not support Drizzle's `db.transaction()` at all (it throws "No
  transactions support in neon-http driver" — checked directly against
  `node_modules/drizzle-orm/neon-http/session.js`). Every multi-step write above (e.g.
  "update the password, then revoke sessions, then create a new one") is a sequence of
  independently-awaited statements, not one atomic unit. A failure between steps is a
  narrow, real gap — e.g. a crash between "password updated" and "new session created"
  leaves the account with its new password but that request's device logged out (the
  user can just log in again; no data is corrupted or lost, but the operation is not
  atomic). `P2.3`'s sync push batches are explicitly called out as needing to solve this
  properly for multi-row writes; auth's writes are simple enough that this is an accepted,
  documented trade-off rather than a blocker.
- **No frontend UI yet.** This entire section is server-only; `P4.1` builds against it.
- **No password-reset-via-email.** By design — see "Account recovery" above.
- **Session list / "your devices" UI** is not built, though `sessions.user_agent` is
  captured and ready for it (`docs/DB.md` §4.2).

---

# Sync API (`api/sync/*`) — `P2.3`

Delta pull/push of the six synced tables (`docs/DB.md` §2.6): `profiles`, `entries`,
`weights`, `custom_foods`, `favourites`, `user_settings`. Client-generated UUIDs
(`entries`/`weights`/`custom_foods`), soft deletes, last-write-wins per row
(`docs/PLAN.md` §2). Both routes require a valid session — sync has no meaning for a
guest — and both return `503 { "error": "sync_unconfigured" }` before touching anything
else if `DATABASE_URL` or `SESSION_PEPPER` is unset, identically to `api/auth/*`.

## How this was verified

Exactly the same rigor and the same disclosed gap as `api/auth/*`: every route is
exercised in `api/sync/*.test.ts` (53 tests across `push.test.ts`, `pull.test.ts` and
`api/_lib/sync/schemas.test.ts`) against a real embedded Postgres (PGlite), running the
committed migrations, calling the exact handler that ships. **Not yet verified**:
Neon-specific behaviour (same gap as `docs/DB.md` §1), and there is no client sync engine
or merge UI yet (`P4.2` builds against this contract).

## The non-negotiable: every query is scoped to the session's own `user_id`

**There is no `userId` field anywhere in any sync request schema.** Every push-body
object schema is `.strict()` (`api/_lib/sync/schemas.ts`) — a client attempting to
smuggle one gets `400 invalid_input`, not a silently-dropped key. Ownership comes
exclusively from the session the cookie resolves to, and every SQL statement in
`api/sync/pull.ts` / `api/sync/push.ts` filters on it:

- **Pull** never has an ownership *forgery* surface in the first place — a pull request
  carries no ids at all, only an opaque cursor object this same account already received
  from its own previous pull. `api/sync/pull.test.ts`'s "IDOR" case still asserts
  directly that one account's pull never surfaces a row belonging to another.
- **Push**, for the three id-addressable tables (`entries`, `weights`, `custom_foods`),
  *does* have a real forgery surface: ids are client-generated UUIDs, globally unique
  across every account, not per-user — so a malicious client can construct a request
  whose `id` happens to match a row that already belongs to someone else. This is
  blocked at the SQL layer, not just checked in application code: the upsert's
  `ON CONFLICT ... DO UPDATE` carries a `setWhere` clause requiring the **existing**
  row's `user_id` to equal the caller's session `user_id`. If it doesn't, the `UPDATE`
  is skipped — and because the id collided, the `INSERT` is skipped too — so the whole
  operation is a **silent no-op**: the victim's row is not read, not returned, and not
  modified in any way. `profiles`/`user_settings` need no such guard (their primary key
  *is* `user_id`, sourced only from the session). `favourites` needs none either (its
  primary key is `(user_id, food_id)`, so a client cannot even address another
  account's row). `api/sync/push.test.ts`'s "IDOR" suite proves all of this directly
  with two real accounts: an attacker's push targeting a victim's entry id returns
  `200` with that id in `rejected` (reason `owner_conflict`, deliberately vague), and
  the victim's row is asserted byte-for-byte unchanged afterward.

## Numeric fields are decimal strings, not numbers — on the wire, both ways

Every macro/weight/height field (`grams`, `kcal`, `protein`, `carbs`, `fat`, `weightKg`,
`heightCm`) is a Postgres `numeric` column (`docs/DB.md` §2.2) so it never drifts like a
float. **On pull**, these come back as exact decimal strings (e.g. `"248.00"`), not JS
numbers — `Number(x)` them client-side. **On push**, the client sends plain JSON
numbers (matching `src/types.ts`'s `LogEntry`/`WeightEntry`/`CustomFood` shapes exactly)
and the server converts to a fixed-decimal string at the column's own scale before
writing (`api/_lib/sync/rows.ts`'s `toNumeric()`) — so the client never has to know or
match Postgres's column scale itself.

## Server assigns every timestamp that governs sync ordering — always

**A push body carries no `updatedAt` or `deletedAt` timestamp field, on any table, at
all.** Instead every row-level operation carries one boolean, `deleted`, which is the
client's *intent*, not a clock reading:

- `{ ..., deleted: false, <full content fields> }` — "here is the live state of this
  row." The server writes the content, sets `deleted_at = NULL`, and `updated_at` is
  then unconditionally overwritten to `now()` by the `fitmacro_set_updated_at()` trigger
  (`docs/DB.md` §3) regardless of anything the application code does.
- `{ id, deleted: true }` — "tombstone this id." No content fields are needed or
  accepted; the server sets `deleted_at = now()` directly.

This is stricter than "the trigger would win anyway": there is no client-supplied
timestamp anywhere in the schema for sync-ordering fields to even be tempted to trust,
which is what `api/sync/push.test.ts`'s "never trusts a client-supplied
updatedAt/deletedAt" test asserts directly (the request literally cannot express one).

The one deliberate exception, carried over unchanged from `docs/DB.md` §2.1:
`entries.day` / `weights.day` (backdating) and `entries.loggedAt` ("when I ate this")
are domain data the user controls on purpose, sent by the client and stored as given —
never used for sync ordering, only `updated_at` is.

## `GET /api/sync/pull?cursor=<url-encoded JSON>`

Read-only — no `Origin`/`Sec-Fetch-Site` check, same reasoning as `GET /api/auth/me`.
Requires a valid session cookie; slides its expiry the same way every authenticated
route does.

### Cursor semantics

`cursor` is a JSON object with one entry per synced table, URL-encoded into the query
string. **Omit it (or send an empty string) for a full pull** — everything this account
has, live or tombstoned, bounded by `hasMore` below. Every subsequent pull should echo
back exactly the `cursor` object **the previous pull** returned.

> ### ⚠️ Only a pull response may advance a pull cursor
>
> A pull cursor means **"every row up to here has been delivered to me."** The only
> endpoint that can truthfully say that is `GET /api/sync/pull`, because delivery is
> what it does. **Never build a pull cursor from any other source** — in particular
> never from `POST /api/sync/push`'s `serverState` (see that route's "200 response"),
> which is a watermark over rows this client may never have received. Adopting it skips
> those rows *permanently*: the internal security audit **F-03** has the two-device walkthrough.
> If you find yourself writing `cursor = <anything that is not a pull response>`, stop.

```jsonc
{
  "profile": "2026-07-01T00:00:00.000Z" | null,     // singleton — no id tiebreaker needed
  "settings": "2026-07-01T00:00:00.000Z" | null,
  "entries": { "updatedAt": "2026-07-01T00:00:00.000Z", "id": "018f..." } | null,
  "weights": { "updatedAt": "...", "id": "018f..." } | null,
  "customFoods": { "updatedAt": "...", "id": "018f..." } | null,
  "favourites": { "updatedAt": "...", "id": "chicken-breast" } | null   // id = foodId here
}
```

**Why `{ updatedAt, id }`, not just `updatedAt`, for the four id-addressable tables:**
Postgres's `now()` is constant for the whole duration of one transaction/statement, so a
single push that touches several rows in one table commonly gives them *all* the exact
same `updated_at`. A cursor of `updated_at` alone can then split that group across two
pull pages and silently skip the rows on the far side of the split (`WHERE updated_at >
cursor` excludes anything with the *same* timestamp). The compound `(updated_at, id)`
cursor with `ORDER BY updated_at, id` and `WHERE (updated_at, id) > (cursor.updatedAt,
cursor.id)` eliminates that tie entirely, correctly, regardless of batch size. This is
made airtight in practice by keeping `PULL_PAGE_LIMIT` (1000) comfortably above push's
own per-table cap (`MAX_ROWS_PER_TABLE`, 500) — see `api/_lib/sync/schemas.ts` — so no
single push's same-timestamp group can even span two pull pages to begin with. Singleton
tables (`profile`, `settings`) need no tiebreaker: there is only ever one row.

### 200 response

```jsonc
{
  "cursor": { /* same shape as the request — echo this back next time */ },
  "hasMore": { "entries": false, "weights": false, "customFoods": false, "favourites": false },
  "profile": { "sex": "male", "age": 30, "heightCm": "180.0", "weightKg": "82.0", "activity": "moderate", "goal": "cut", "updatedAt": "...", "deletedAt": null } | null,
  "settings": { "locale": "en", "reducedMotion": false, "updatedAt": "...", "deletedAt": null } | null,
  "entries": [ { "id", "day", "name", "grams", "kcal", "protein", "carbs", "fat", "meal", "source", "foodId", "loggedAt", "updatedAt", "deletedAt" }, ... ],
  "weights": [ { "id", "day", "weightKg", "updatedAt", "deletedAt" }, ... ],
  "customFoods": [ { "id", "name", "category", "kcal", "protein", "carbs", "fat", "commonPortions", "updatedAt", "deletedAt" }, ... ],
  "favourites": [ { "foodId", "updatedAt", "deletedAt" }, ... ],
  "counts": {
    "entries": { "total": 318, "days": 41, "firstDay": "2026-02-12", "lastDay": "2026-03-12" },
    "weights": { "total": 22 },
    "customFoods": { "total": 6 },
    "favourites": { "total": 4 },
    "lastChangeAt": "2026-03-12T14:02:00.000Z" | null
  }
}
```

- `profile`/`settings` are `null` when nothing changed since your cursor (or there is no
  row at all yet) — a real, present object otherwise, with its own `deletedAt` if it was
  tombstoned.
- Every array element for `entries`/`weights`/`customFoods`/`favourites` is included
  **whether it's live or tombstoned** — the delta query is `WHERE user_id = $1 AND
  (updated_at, id) > (cursor...)` with **no `deleted_at IS NULL` filter**, on purpose:
  a tombstone is exactly the kind of "change since your cursor" a delta pull exists to
  report. Filtering tombstones out here is precisely the bug that would make a delete
  fail to propagate.
- `hasMore[table]` is `true` only if this table had more than `PULL_PAGE_LIMIT` (1000)
  changed rows since your cursor — call pull again immediately with the returned cursor
  to get the next page. For a personal-scale account this is expected to always be
  `false`; it exists so a very large first sync degrades to pagination instead of one
  unbounded response.

### `counts` — real numbers for the merge/adoption screen (`docs/DESIGN.md` §7.11, §14)

`docs/DESIGN.md` §14 hands this endpoint an explicit dependency: the adoption/merge
screen must show **real, pre-commit counts** before a user picks a destructive merge
option, and offered two acceptable ways to satisfy it — the server computes counts and
a `conflicts[]` preview itself, *or* the client computes both from a full pull. This
implementation deliberately takes the second path, and here is why: **the server cannot
compute a conflict at all.** A "conflict" in the merge sense (§7.11: "3 entries were
changed in both places") is by definition a comparison between the **server's** rows
and the device's **local, never-yet-pushed** rows — and the entire point of the merge
screen is that those local rows have *not* been synced yet, so the server has never
seen them and structurally cannot know what they are. Only the client, holding both
sides, can build `conflicts[]`.

What this endpoint *does* provide, and provides honestly and exactly:

- **`counts`** is computed by real `COUNT`/`COUNT(DISTINCT day)`/`MIN(day)`/`MAX(day)`
  aggregate queries against the live rows (`deleted_at IS NULL`) for this account —
  never derived from the length of a possibly-paginated array, so it is correct even
  when `hasMore` is true. This alone is enough for the left/right comparison cards in
  §7.11 ("41 days logged … 318 entries … Last change: today 14:02").
- A **full pull** (cursor omitted) returns the **complete** live-and-tombstoned row set
  for every table (bounded by `hasMore`, as above) — everything the client needs to
  build `conflicts[]` itself by comparing ids against its own local store: any id that
  exists in both, with different content, is a conflict; an id that exists only
  locally is an addition; an id that exists only on the server is a download.
- `lastChangeAt` is the maximum `updated_at` across every synced table *for this same
  response* — profile, settings, and the last row of each returned page — with **no
  extra query**: on a full pull (the case §7.11 actually needs it for) `hasMore` is
  false in the overwhelming common case, so the last row of an ascending-ordered page
  genuinely is the account's most recent change. On a delta pull where nothing changed,
  it is correctly `null` — there is nothing newer than what the caller already has.

## `POST /api/sync/push`

Requires a valid session cookie **and** the `Origin`/`Sec-Fetch-Site` check (mutating —
same CSRF defence as every `api/auth/*` POST route). Body is JSON, byte-capped at 2 MB
via the same streaming reader `api/_lib/auth/schemas.ts` uses for auth bodies
(`parseJsonBody`), just with a larger explicit limit — a real batch of user data is not
a handful of short auth fields, but the "abort the read the instant the cap is crossed,
never buffer past it" guarantee is identical. Each table's array is additionally capped
at 500 rows (`MAX_ROWS_PER_TABLE`); a caller that sends more gets `400 invalid_input`,
not a huge-but-processed request.

### Request

Every table is optional; an empty body (`{}`) is a valid no-op push, not an error. Each
row is one of two shapes — see "Server assigns every timestamp" above for why there is
no timestamp field on either:

```jsonc
{
  "profile": { "deleted": false, "sex": "male", "age": 30, "heightCm": 180, "weightKg": 82, "activity": "moderate", "goal": "cut" } | { "deleted": true } | null,
  "settings": { "deleted": false, "locale": "en", "reducedMotion": false } | { "deleted": true } | null,
  "entries": [
    { "id": "<uuid>", "deleted": false, "day": "2026-03-12", "name": "Chicken breast", "grams": 150, "kcal": 248, "protein": 46, "carbs": 0, "fat": 5, "meal": "lunch", "source": "manual", "foodId": null, "loggedAt": 1773316800000 },
    { "id": "<uuid>", "deleted": true }
  ],
  "weights": [ { "id": "<uuid>", "deleted": false, "day": "2026-03-12", "weightKg": 81.5 } ],
  "customFoods": [ { "id": "<uuid>", "deleted": false, "name": "Homemade granola", "category": "grains", "kcal": 450, "protein": 10, "carbs": 60, "fat": 15, "commonPortions": [{ "label": "cup", "grams": 40 }] } ],
  "favourites": [ { "foodId": "chicken-breast", "deleted": false } ]
}
```

Every numeric field is bounded to match its `CHECK` constraint in `api/_lib/db/schema.ts`
exactly (`api/_lib/sync/schemas.ts`) — e.g. `0 <= grams < 100000` — as defense in depth,
so a request that would fail the database's own constraint fails here first as a clean
`400 invalid_input` instead of a raw Postgres error. `loggedAt` is epoch milliseconds,
matching `src/types.ts`'s `LogEntry.loggedAt` exactly, bounded to roughly year 2000–2100
(catches an obviously-wrong unit, e.g. seconds instead of milliseconds).

### 200 response

```jsonc
{
  "serverState": { /* same SHAPE as pull's cursor — but NOT a cursor. Never adopt it as one. */ },
  "applied": {
    "profile": { "updatedAt": "...", "deletedAt": null } | null,
    "settings": { "updatedAt": "...", "deletedAt": null } | null,
    "entries": [ { "id", "updatedAt", "deletedAt" }, ... ],
    "weights": [ { "id", "updatedAt", "deletedAt" }, ... ],
    "customFoods": [ { "id", "updatedAt", "deletedAt" }, ... ],
    "favourites": [ { "foodId", "updatedAt", "deletedAt" }, ... ]
  },
  "rejected": {
    "entries": [ { "id", "reason": "owner_conflict" }, ... ],
    "weights": [ { "id", "reason": "owner_conflict" | "duplicate_day" }, ... ],
    "customFoods": [ { "id", "reason": "owner_conflict" }, ... ],
    "favourites": []   // structurally cannot conflict — see "every query is scoped" above
  }
}
```

`profile`/`settings` in `applied` are `null` only when that table's op was **absent**
from the request (nothing to report), never as a failure signal — there is no
`rejected.profile`/`rejected.settings` because there is no ownership-forgery surface for
either (see above).

### `serverState` — an informational watermark, **never** a pull cursor

> ### 🚨 DATA LOSS — read this before writing a sync client
>
> **`serverState` must never be adopted as a pull cursor, and pushing must never advance
> one.** Only a `GET /api/sync/pull` response may do that. This is the internal security audit
> **F-03 (HIGH)**; earlier revisions of this document instructed the opposite, and any
> client built on that instruction silently and permanently loses other devices' rows.

`serverState` has the same *shape* as pull's `cursor` — `{ profile, settings, entries,
weights, customFoods, favourites }`, each the newest `(updatedAt, id)` for that table —
and that shape similarity is exactly the trap. It is **not** an echo of what this push
touched; it is freshly queried after the write as "the newest row this account owns,
across every device." That is precisely what makes it unsafe:

- A **pull cursor** means *"every row up to here has been **delivered to me**."*
- **`serverState`** means *"the account's newest row is at least this new"* — including
  rows written by other devices that this client **has never received**.

Concretely (no attacker, ordinary two-device use): device A's `entries` cursor is `T0`.
Device B logs breakfast at `T1`. A, which has not pulled since, pushes lunch at `T2`.
`serverState.entries` comes back as `T2`. If A adopts that, its next pull asks for rows
after `T2` — and **B's breakfast at `T1` is never delivered to A, on this or any future
pull.** It is gone from that device forever. The full walkthrough is the internal security audit
F-03; the guard rail is the block comment above `buildServerState()` in
`api/sync/push.ts`.

**What it is actually for.** Compare it against your own last *pull* cursor to answer
one question cheaply: *"is the server ahead of me?"* If any table's `serverState` is
newer than your pull cursor for that table, there are changes you haven't seen — so
schedule a pull. That is the entire contract. It saves you a speculative round trip; it
does not replace one.

**How to advance your cursor correctly after a push:**

```
POST /api/sync/push   ->  { serverState, applied, rejected }
  1. mark the ids in `applied` as acknowledged in your outbox (use `applied[].updatedAt`
     for your local row's synced-at bookkeeping — that IS authoritative per row)
  2. handle `rejected` (owner_conflict / duplicate_day)
  3. if `serverState` is ahead of your saved PULL cursor, call GET /api/sync/pull with
     that saved pull cursor — unchanged — and adopt the `cursor` IT returns
```

Step 3 costs one extra round trip and is the only correct way to learn about the other
device's rows. **`applied[].updatedAt` is authoritative for the rows in that response**
(the server did just write them, and it is per-row, not a watermark) — it is only the
account-wide `serverState` that must never become a cursor.

### Idempotency — re-pushing an identical batch is a no-op, not a duplicate

Every write is an `INSERT ... ON CONFLICT (id) DO UPDATE` (or, for `favourites`, `ON
CONFLICT (user_id, food_id)`) keyed on the client-generated id — never a bare `INSERT`.
Re-sending the exact same op twice converges to the same row, not a second row:
`api/sync/push.test.ts`'s idempotency suite pushes an identical entry twice and asserts
directly (by querying the table, not just the response) that exactly one row exists
afterward. The one honestly-disclosed side effect: because `updated_at` is *always*
re-stamped by the trigger on every successful `UPDATE` (see "Server assigns every
timestamp" above), a byte-for-byte-identical re-push still advances that row's
`updated_at` to a new "now" — harmless (the content genuinely hasn't changed, so no
other device sees anything different), just not perfectly silent at the timestamp level.

**Duplicate ids *within a single batch* are collapsed, not rejected** (`dedupeOps()` —
the internal security audit F-02, where sending two ops for one id used to `500` the entire push).
If one array contains several ops addressing the same row — same `id`, or same `foodId`
for `favourites` — only the **last** one in the array is applied. That is the same
last-write-wins rule the server already applies *across* pushes, resolved here by array
order because array order is the client's own stated sequence of intent. It also makes
"a live op and a tombstone for one id in one batch" deterministic: the last one wins,
rather than deletes winning by accident of being applied second.

Two consequences for a client:

- **Array order is meaningful.** Build each table's array in the order the edits actually
  happened; do not reorder an outbox before pushing.
- **`applied` is keyed by row, not by op.** Three ops for one id yield **one** entry in
  `applied`, not three. Acknowledge your outbox by id, not by counting the response.

### Tombstones — delete propagates, and does not resurrect on its own

- A tombstone (`{ id, deleted: true }`) for a row the server already has sets
  `deleted_at = now()`; a delta pull with an older cursor will then include that row
  with `deletedAt` set (see "no `deleted_at IS NULL` filter" above) — that is the
  propagation. Re-pushing the identical tombstone is idempotent: the row stays deleted,
  it does not "un-delete" from being pushed again (`api/sync/push.test.ts`).
- A tombstone for an id the server has **never** created (e.g. an entry created and
  deleted fully offline before the device was ever online) is a **harmless no-op** —
  not an error, not reported in `rejected`. There is nothing to delete because the
  intended end state (this id does not exist / is not visible to any other device) is
  already true.
- **What "does not resurrect" does *not* mean**: it does not mean a delete is
  permanently sticky regardless of any later action. Pushing a genuine, later live
  write (`{ id, deleted: false, ...content }`) for a previously-tombstoned id
  legitimately clears `deleted_at` back to `null` — this is last-write-wins doing
  exactly what it's supposed to (a device re-creating/restoring something it itself
  had deleted is a normal, intended action), not a bug. `api/sync/push.test.ts` calls
  this out explicitly by name so the distinction is not lost on a future reader.

### Weights — the one table with a second real conflict shape

`weights` carries `weights_user_day_live_key` (`docs/DB.md` §4.6): at most one **live**
weigh-in per user per day. Two different client-generated ids both claiming to be live
for the same day (e.g. logged independently on two offline devices) is a real,
detectable conflict distinct from the id-based upsert above. The handler always
attempts the fast path first — one batched `INSERT ... ON CONFLICT (id) DO UPDATE` for
the whole `weights` array in the push — and only if Postgres raises `23505` on that
statement does it fall back to applying the same array **one row at a time**, so a
single colliding row cannot take an otherwise-good batch down with it. Whichever row
loses the day comes back in `rejected` with `reason: "duplicate_day"`; the row that won
is applied normally. There is currently no automatic reconciliation UI for this beyond
reporting it — a later device/edit choosing a different day is the resolution path,
same as any other LWW conflict.

## Errors common to every route below

| Status | Body | When |
| --- | --- | --- |
| 503 | `{ "error": "sync_unconfigured" }` | `DATABASE_URL` or `SESSION_PEPPER` unset. Checked first. |
| 405 | `{ "error": "method_not_allowed" }` | Wrong HTTP method (`GET` for pull, `POST` for push). `Allow` header set. |
| 401 | `{ "error": "unauthorized" }` | No/invalid/expired/revoked session. |
| 400 | `{ "error": "invalid_input" }` | Malformed JSON, a schema violation, an unrecognised key (`.strict()`), a cursor value that fails validation, or a per-table array over 500 rows. |

Two of those are worth stating explicitly, because both used to be `500`s
(the internal security audit F-04, F-08) and a client written against the old behaviour would have
learned to treat them as server faults:

- **A cursor `id` must match its table's key type.** `entries`, `weights` and `customFoods`
  key on `uuid` — a non-UUID `id` in the cursor is `400 invalid_input`. `favourites` keys on
  `food_id`, a plain text column, so a bare food id (`"chicken-breast"`) is correct and
  accepted there. Echoing back a cursor a previous **pull** returned always satisfies this.
- **`day` must be between `1900-01-01` and `2100-12-31`.** Calendar-validity alone is not
  enough: `0000-01-01` parses as a date but Postgres has no year zero, and it used to take
  the whole push down. This is a "Postgres will store it" bound, not a business rule.
| 413 | `{ "error": "too_large" }` | Push body over 2 MB, or the `cursor` query string over 4000 characters, both rejected before being fully read/parsed. |
| 403 | `{ "error": "origin_rejected" }` | `POST /api/sync/push` only — cross-site `Origin`. |
| 500 | `{ "error": "server_error" }` | Anything unexpected. Never a stack trace; logged server-side with only the error's `name`.  |

`GET /api/sync/pull` has no dedicated rate limit and no `Origin` check (read-only, same
as `GET /api/auth/me`); `POST /api/sync/push` has the `Origin` check but, unlike
`api/auth/*`, **no Postgres-backed rate limit of its own** — see "Known limitations"
below for why, and what actually bounds abuse today.

## Atomicity — what this endpoint actually guarantees, stated precisely

**There is no `db.transaction()` wrapping a push batch, and this is a real, deliberate,
documented gap — not an oversight and not silently claimed away.**
`@neondatabase/serverless`'s HTTP driver (`neon-http`) — chosen specifically in
`docs/PLAN.md` §2 to avoid serverless connection-pool exhaustion, the classic
Postgres-on-Lambda failure mode — has **no transaction support at all**
(`db.transaction()` throws "No transactions support in neon-http driver," verified
directly against `node_modules/drizzle-orm/neon-http/session.js`, the identical gap
already disclosed for `api/auth/*` in this document). Switching this endpoint alone to a
transaction-capable driver (`@neondatabase/serverless`'s WebSocket-based `Pool`, via
`drizzle-orm/neon-serverless`) was considered and rejected: it would reintroduce, inside
one specific route, exactly the serverless connection-pooling risk the whole stack was
chosen to avoid, it would add a new runtime dependency (`ws`, for Node < 22) purely for
this one endpoint, and — under the current publish hold — it could not be verified
against a real Neon deployment any more than the current approach can be (PGlite is not
Neon either way; see "How this was verified" above). That trade was judged not worth it
for a personal-scale sync workload where every write is already idempotent.

**What is actually true instead:** every write in `applyProfile`/`applySettings`/
`applyEntries`/`applyWeights`/`applyCustomFoods`/`applyFavourites` is its own
independently-committed statement (or, for `weights`, up to two: a bulk attempt and a
row-by-row fallback). **The atomicity guarantee this endpoint provides is per-row, not
per-batch.** Concretely, if the process crashes or the connection drops between two
statements in one push call:

- Whatever already committed is **correctly and durably persisted** — not corrupted,
  not partially written (each individual `INSERT`/`UPDATE` is itself a single
  Postgres statement, which is always atomic on its own).
- Whatever had not yet been sent is simply **not applied** — from the server's point of
  view it is as if that part of the batch was never received.
- **Because every operation is an idempotent upsert-by-id (or upsert-by-natural-key for
  `favourites`) keyed on data the client already has**, the client's own outbox model
  (P4.2: an offline queue that survives a refresh) can safely retry the **exact same
  batch** after any failure — including the rows that already landed — with no
  duplication and no double-application, by construction, not by luck. A client never
  needs to reason about "which half of my last push actually succeeded"; it can always
  just resend everything it hasn't received an `applied` acknowledgment for.
- **A partially-applied batch is reported as a total failure, and the client cannot tell
  which part landed.** The six `apply*` calls run under one `Promise.all` with a single
  catch, so if one table throws, the other five tables' writes have **already committed**
  and the caller still sees `500 server_error` with no `applied` body at all
  (the internal security audit §2b). This is safe *only because* of the idempotency above: the
  correct client response to a `500` is to **retry the identical batch**, which converges,
  and never to assume nothing was written. Concretely: do not clear an outbox on `500`,
  and do not treat a `500` as "the server is unchanged" — it may be several tables ahead.

This is the identical shape of guarantee `api/auth/change-password.ts` already
documents for its own multi-step write (update password → revoke sessions → issue a new
one) — narrower than "all or nothing," honestly described instead of glossed over.

## Known limitations — recorded honestly

- **Last-write-wins per row, and that has a real, understood cost.** If the same row
  (same `id`) is edited **offline, independently, on two devices** before either syncs,
  whichever push reaches the server **later** wins outright — the earlier write is not
  merged field-by-field, and it is not kept anywhere queryable once the later one lands
  (it is gone, overwritten, the same as any other `UPDATE`). This is a deliberate,
  documented trade-off (`docs/PLAN.md` §2): per-row LWW is the honest, cheap, correct
  choice for small independent records like a single food-log entry, and the
  alternative (field-level merge, or CRDTs) is real engineering cost this project does
  not need for the shape of data involved. The place this surfaces to a real person is
  `docs/DESIGN.md` §7.11's merge screen, whose "Review" panel says exactly this in
  plain language ("FitMacro keeps the newer change") rather than hiding it — this is
  the client-facing honesty this section's contract is written to make possible, not a
  gap the design papered over.
- **No dedicated rate limit on `api/sync/*`.** Unlike `api/auth/*` (Postgres-backed,
  per-IP and per-account, `docs/DB.md` §4.3), sync requests are bounded only by
  requiring a valid session (so an attacker must already be authenticated) and the
  per-request row/byte caps above (so one request cannot be arbitrarily large). Adding
  a matching `auth_attempts.action` value for sync would be a real schema migration for
  an abuse shape (an already-authenticated account hammering its own sync endpoint)
  that is materially different from the pre-auth brute-force/enumeration threats
  `auth_attempts` exists for — deferred rather than bolted on speculatively. If this
  becomes a real problem in practice, the fix is a new rate-limit scope, not a change
  to this endpoint's core contract.
- **No per-batch transaction** — see "Atomicity" above; per-row idempotency is the
  actual guarantee, stated precisely rather than rounded up to "transactional."
- **PGlite, not Neon, was used for verification** — same disclosed gap as `docs/DB.md`
  §1 and the Auth API section above, closed in `P5.1` when a real Neon project exists.
- **No conflict auto-resolution UI.** `rejected.weights[].reason === 'duplicate_day'`
  and the LWW overwrite above are both reported/observable, but nothing server-side
  offers a merge for them beyond "the client can look at what it has now and decide" —
  that decision surface is `docs/DESIGN.md` §7.11's job, not this endpoint's.
- **No server-side pagination cursor beyond one dimension.** `hasMore` exists per table
  independently; there is no single "give me everything across all six tables in one
  paginated stream" primitive. For a personal-scale account (the only kind this app
  targets) this has never been observed to matter — `PULL_PAGE_LIMIT` (1000) exceeds
  any real account's per-table row count by a wide margin.
