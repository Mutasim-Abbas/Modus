# FitMacro

A nutrition tracker that works the moment you open it, with no account: calculate your
calorie and macro targets from a real formula, log real foods from a curated database,
and — **only if you choose to** — create an account so the same log follows you to your
other devices.

Built by **Mutasim Abbas** — BSc Software Engineering, Istanbul Atlas University.

> ### Status: live at **[fitmacro.vercel.app](https://fitmacro.vercel.app)**
> Running on Vercel with a Neon Postgres database, so guest mode, accounts and cross-device
> sync all work. Everything described below has also been exercised against a local
> production build (`npm run build` + `npm run preview`).
>
> The automated backend test suite still runs against an **in-process Postgres (PGlite)**
> rather than the hosted database, so behaviour that depends on the differences between the
> two is verified in production by hand, not by the suite. See
> [Known limitations](#known-limitations).

---

## What it is

| | |
| --- | --- |
| **Local-first by default** | Open it, answer six questions, start logging. No account, no sign-up wall, no network required. Your log is stored in this browser's `localStorage`. |
| **Accounts are optional and additive** | Create one and your data also syncs to a server so another device can pick it up. Never create one and nothing changes. Signing in never deletes local data; signing out never deletes local data. |
| **AI meal scan** | Photo → estimate → **you edit every number** → logged. If the AI key isn't configured, the feature disables itself and says so. |

### Screens

| Screen | What it actually does |
| --- | --- |
| **Onboarding** | Sex, age, height, weight, activity, goal → targets from Mifflin-St Jeor. |
| **Today** | Today's calorie ring and macro bars, and what's remaining. |
| **Log** | Search 184 foods (plus your own), pick a portion, add it. Backdate to any past day, copy yesterday, edit or delete any entry. **The headline feature.** |
| **Scan** | Photo → AI estimate → editable review → logged. |
| **Progress** | Weight and macro trends drawn from your own logged data — real charts, real empty states. |
| **Plan** | A rule-based (not AI) day of meals built from the food database. |
| **History** | Every day you've logged. |
| **Profile / Weight log** | Edit details, see how targets are computed, record weigh-ins, export or reset your data. |
| **Account & sync** | Sign up, sign in, recovery code, change password, sign out everywhere, delete account. Hidden entirely when the deployment has no database configured. |

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173
```

That is the whole setup for guest mode. No environment variables, no database, no API key
— the app is fully usable with all three backend features switched off, which is exactly
what happens locally.

To run the production build the tests target:

```bash
npm run build
npm run preview      # http://localhost:4173
```

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run build` | Typecheck + production build to `dist/` |
| `npm run preview` | Serve the built app |
| `npm run typecheck` | `tsc -b` — strict, no `any` escapes |
| `npm run lint` | ESLint (type-aware) |
| `npm test` | Vitest, single run |
| `npm run test:watch` | Vitest, watch mode |
| `npm run test:coverage` | Coverage |
| `npm run test:e2e` | Playwright end-to-end specs against a local preview |
| `npm run db:generate` / `db:migrate` / `db:studio` | Drizzle migrations (needs `DATABASE_URL`) |

Icons and the OG image are generated from the design tokens:
`node scripts/generate-icons.mjs`.

### Optional: enabling the backend features

Copy [`.env.example`](./.env.example) and fill in only what you want. Each feature
degrades to an honest "not available here" when its variables are missing — none of them
breaks the app.

| Variable | Enables | Missing → |
| --- | --- | --- |
| `GROQ_API_KEY` | the AI meal scan | `503 ai_unconfigured`; Scan disables itself |
| `DATABASE_URL` + `SESSION_PEPPER` | accounts and cloud sync | `503 sync_unconfigured`; accounts UI is hidden entirely |

`.env` is gitignored; only `.env.example` is committed. No key is ever read by the browser
bundle — the serverless functions in `api/` hold them.

## Screenshots

None are committed. Every previous screenshot in this project's history was of a screen
that had since changed, so rather than ship a stale picture: run `npm run dev`, or run
`npm run test:e2e` — the Playwright specs drive the real app at 390 px and 1440 px and
write a browsable HTML report (with traces on failure) to `playwright-report/`.

## Your data — read this before you sign up

FitMacro tries never to claim more than it does.

**As a guest (the default):** everything you log is stored in this browser's
`localStorage`, on this device only. It is not uploaded anywhere, and no one else can see
it. Clearing your browser data deletes it. Export it any time from Profile.

**With an account:** your entries, weights, custom foods, favourites, profile and settings
are uploaded to the server so another device signed into the same account can download
them. That is the entire point of the account, and it means the "it never leaves your
device" promise no longer applies once you sign in. You choose when that happens; nothing
syncs until you create an account and sign in.

Signing in never overwrites your local data silently — if both your device and your
account already have data, FitMacro stops and asks you which to keep, showing real counts
and the exact number of rows a destructive choice would remove.

### Three things you should know before creating an account

These are deliberate trade-offs, documented in
the internal security audit §5. They are written here because a
trade-off nobody tells you about is just a hidden defect.

1. **Someone who knows your email can lock you out for up to 15 minutes.** FitMacro limits
   failed sign-in attempts per account (8 wrong passwords in 15 minutes, 5 wrong recovery
   codes in an hour). That limit is what stops someone guessing your password — but it
   also means anyone who knows your email address can deliberately trip it, and you will
   get "too many attempts" for a while even with the correct password. **Waiting is the
   fix**; the window is 15 minutes, not permanent, and nobody needs to intervene. No data
   is at risk and this cannot be used to *gain* access to your account — only to
   temporarily deny you yours. (Finding F-05.2.)

2. **Sign-up reveals whether an email address already has a FitMacro account.** If you try
   to create an account with an email that is already registered, the app tells you so
   ("That email already has an account") instead of a vague error, because the vague
   version is genuinely worse for real people. Signing in and recovery deliberately do
   *not* leak this — but sign-up does, and for a nutrition and body-weight app "does this
   person have an account here" is itself personal information. So: it is disclosed, on
   purpose, and FitMacro does not claim to have "no user enumeration". (Finding F-12.)

3. **The per-IP request limit assumes FitMacro is running behind Vercel's proxy.** The
   rate limiter reads Vercel's `x-vercel-forwarded-for` / `x-real-ip` headers to identify
   a caller's IP address. On Vercel that is trustworthy. **On any other host, or behind a
   different proxy, those headers can be forged**, and the per-IP limit stops being a real
   control — the per-account limit (keyed on the submitted email, which no header can
   forge) is what still holds. Anyone deploying FitMacro somewhere other than Vercel must
   revisit `clientIpFrom` in `api/_lib/rate-limit.ts` first. This is also stated as a
   platform prerequisite in the internal project notes. (Finding F-14.)

### There is no password-reset email

FitMacro sends no email at all — every free email service needs a paid domain, so rather
than pretend, there isn't one. Your account's only recovery path is the **recovery code**
shown once, immediately after sign-up. Save it. If you lose both your password and that
code, the account cannot be recovered; your local data on each device is untouched either
way.

### Other honesty notes

- **The food database is approximate.** 184 common foods at **reference values per 100 g**,
  based on widely published composition data for generic foods. Real foods vary by cut,
  brand, ripeness and preparation. Macros may not multiply out to the listed calories
  exactly — whole foods contain fibre, water and (for drinks) alcohol that the 4/4/9
  shorthand doesn't model. **Estimates for tracking, not clinical data.**
- **AI numbers are always estimates you edit.** Every scanned item goes through a review
  step with its confidence shown. Nothing is logged until you confirm. If the endpoint
  isn't configured, the app says so — it never fabricates a result.
- **The planner is not AI.** It's arithmetic over a hand-picked shortlist of real foods.
  The UI calls it what it is.
- **None of this is medical advice.** The formulas are population-level estimates.

## How targets are calculated

All of it is in [`src/lib/macros.ts`](./src/lib/macros.ts) — pure, and unit-tested.

1. **BMR — Mifflin-St Jeor** (Mifflin MD, St Jeor ST, et al., 1990):
   - male: `10·kg + 6.25·cm − 5·age + 5`
   - female: `10·kg + 6.25·cm − 5·age − 161`
2. **TDEE** = BMR × activity factor — 1.2 / 1.375 / 1.55 / 1.725 / 1.9.
3. **Goal**: cut −20%, maintain 0%, bulk +15%. Floored at 1200 kcal as a safety bound.
4. **Macros**: protein 1.8 g/kg (2.2 g/kg on a cut), fat 25% of calories, carbs take the
   remainder. Atwater factors: 4 / 4 / 9 kcal per g.

No coefficient in that file is invented. Inputs are clamped, and the engine cannot return
NaN or a negative target.

## Stack

Vite · React 18 · TypeScript (strict) · Tailwind · Framer Motion (restrained) ·
lucide-react · react-router · Vitest + React Testing Library · Playwright ·
vite-plugin-pwa · Drizzle ORM + Postgres (Neon) · argon2id · Anthropic SDK ·
targeted at Vercel.

## Architecture

```
src/
  app/          AppShell (nav for phone/tablet/desktop), routing
  components/   Button, Card, Field, Segmented, MacroRing, Sheet, charts, ...
  features/
    onboarding/ dashboard/ log/ scan/ plan/ history/ profile/ progress/ more/
    auth/       sign-up, sign-in, recovery code, recover  (+ AuthContext)
    account/    account & sync, change password, delete account
    sync/       SyncChip, banners, the adoption/merge screen
  lib/
    macros.ts   BMR/TDEE/macro split — pure, unit-tested
    store.ts    versioned localStorage persistence + migration (v2 → v3)
    search.ts   food search & ranking — pure, unit-tested
    plan.ts     rule-based day planner — pure, unit-tested
    api.ts      typed client for /api/analyze-meal
    authApi.ts  typed client for /api/auth/*
    sync/       React-free sync engine: wire parsing, client, outbox diff,
                LWW merge, adoption, background loop
  data/
    foods.ts    184 foods, reference values per 100 g
api/
  analyze-meal.ts       AI scan handler; 503 ai_unconfigured without the key
  auth/*.ts             signup, login, logout, logout-all, me,
                        change-password, delete-account, recovery-redeem
  sync/pull.ts push.ts  delta sync; 503 sync_unconfigured without a database
  _lib/                 validation, rate limiting, sessions, row serialisation
drizzle/                committed SQL migrations
e2e/                    Playwright specs (see Tests)
docs/                   DESIGN, API, DB
```

## Security posture

- The session is a **`__Host-fm_session` cookie** — `Path=/; HttpOnly; Secure;
  SameSite=Lax`, plus an Origin check on every mutating request. No
  token is ever written to `localStorage` or `sessionStorage` — verified in a real
  browser, not just in tests.
- Passwords are hashed with **argon2id**; the recovery code is hashed too, single-use, and
  shown exactly once (a page refresh cannot bring it back).
- Every request is validated at the boundary with `zod`; every database query is
  parameterised through Drizzle. Every sync query filters on the session's own user id.
- No `dangerouslySetInnerHTML`, no `innerHTML`, no `eval` anywhere in application code.
- The service worker never caches `/api/`, so an authenticated response cannot be served
  from cache to the next person using the browser.
- The built `dist/` contains no `GROQ_API_KEY`, `DATABASE_URL` or `SESSION_PEPPER` —
  checked, not assumed.

Three security passes are written up in full, including what was tried and *failed* to
break, in the internal security audit.

## PWA & offline

Installable. Logging, the food database, the planner, history and your charts all work
offline, because they are local. Only the **AI scan** and **sync** need the network, and a
sync failure degrades to local-only — it never blocks you from logging. Anything you log
offline is still there after a refresh and goes out on the next successful sync.

## Tests

```bash
npm test            # unit + component (Vitest + React Testing Library)
npm run test:e2e    # end-to-end in a real Chromium, against a local preview build
```

The unit suite stood at **796 tests across 66 files** at the end of the last full run
(Task 7). The pure modules are tested for known values and hostile input; the screens are
tested as real user journeys.

The Playwright suite is **44 tests** — 22 tests run twice, once at **390 px** and once at
**1440 px** — covering:

| Spec | Journey |
| --- | --- |
| `e2e/guest-core.spec.ts` | onboard → log → refresh → the entry survives; every route renders for a guest with no auth wall; no horizontal overflow; a food logged with the keyboard alone; nothing auth-related in storage |
| `e2e/v2-migration.spec.ts` | a captured **real v2 `localStorage` payload** loads into v3 with nothing lost |
| `e2e/log-edit-backdate.spec.ts` | edit an entry (macros re-derive, persists); backdate to yesterday; the future is not loggable; delete confirms first |
| `e2e/scan.spec.ts` | the AI scan happy path, and the `503 ai_unconfigured` path |
| `e2e/progress-charts.spec.ts` | empty states with no data, real charts once there is data |
| `e2e/auth-sync-mocked.spec.ts` | sign-up, the one-time recovery code, two devices sharing one dataset, offline → reconnect, and "signing in never deletes local data" |

**`e2e/auth-sync-mocked.spec.ts` is mock-backed and says so in its title.** There is no
database on a development machine, so `api/auth/*` and `api/sync/*` are answered by
`e2e/support/fakeSync.ts` using the response shapes in `docs/API.md`. It genuinely
exercises the whole client across two real browser contexts; it proves nothing about the
deployed backend.

## Known limitations

Stated here rather than discovered later:

- **The automated backend suite never touches the hosted database.** Every `api/` result in
  the test suite comes from PGlite (in-process Postgres), not Neon. The deployed stack was
  verified by hand — sign up, read the session back, pull sync state, delete the account —
  but the internal security audit F-15 concerns a PGlite/Neon difference the suite structurally
  cannot cover.
- **F-18 is open** (MEDIUM): the two whole-dataset adoption paths don't record the rows
  they adopt as synced, so those rows can be re-pushed on later cycles. No data loss, but
  it is not fixed. See the internal security audit.
- **A rejected `duplicate_day` row retries forever.** It no longer *claims* to be synced
  (F-17), but nothing clears it. Deferred, deliberately.
- **`loggedAt` is lost on a synced entry.** The server sends it as an ISO string; the
  client parses it as a number and falls back to `0`, so an entry that arrives by sync
  shows "logged 1 Jan 1970". Reproduced by an e2e test that is marked as an expected
  failure so it cannot be quietly forgotten.
- **No Arabic / RTL.** Cut from v3's scope by the owner. The codebase uses logical CSS
  properties throughout so it stays possible.
- **No email, of any kind.** See above.

## Licence

MIT — see [`LICENSE`](./LICENSE). © 2026 Mutasim Abbas.
