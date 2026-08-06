# Security policy

## Status

**Modus is live at [fitmacro.vercel.app](https://fitmacro.vercel.app)**, running on Vercel with a
hosted Neon Postgres database. Guest mode, accounts and cross-device sync are all active
there.

Accounts are opt-in, not required. As a guest the app works fully offline and everything
you log stays in your browser's local storage on your device — nothing is sent anywhere. On
a deployment where `DATABASE_URL` and `SESSION_PEPPER` are not configured, the entire
account surface switches itself off (`503 sync_unconfigured`) rather than half-working.

Worth knowing when triaging: the automated backend suite runs against an in-process
Postgres (PGlite), not the hosted database, so a finding that turns on the difference
between the two is exactly the kind the suite cannot catch.

## Reporting a vulnerability

Please report privately rather than opening a public issue — use GitHub's
**[private vulnerability reporting](https://github.com/Mutasim-Abbas/Modus/security/advisories/new)**
(Security tab → Report a vulnerability).

Useful things to include: what you did, what happened, what you expected, and the commit
you were on. A proof of concept is welcome but not required.

Please test locally with `npm run dev` rather than against `fitmacro.vercel.app`. The live
instance has a real database behind it and real accounts in it. If a finding genuinely
cannot be shown except in production, keep it to a single account you created yourself,
and no automated scanning, load testing or anything destructive.

## What is in scope

The application code in `src/` and `api/`, and the database schema in `drizzle/`.

Out of scope: anything requiring physical access to an unlocked device, findings that only
apply to a hosting configuration this project does not use, and dependency advisories with
no demonstrated path to exploitation here — though a note about one is still welcome.

## Known and accepted

Two behaviours are deliberate and worth stating up front, so they need not be reported:

- **Signup discloses whether an email is already registered.** A signup form has to be able
  to say "you already have an account." Login and account recovery leak nothing — a wrong
  password and an unknown email are indistinguishable in status, body and timing.
- **Repeated failed sign-ins temporarily lock an account.** Someone who knows your email can
  use this to lock you out for up to 15 minutes. This is inherent to per-account rate
  limiting; the alternative is no durable bound on password guessing. Waiting restores
  access, and it cannot be used to *gain* access.

## Internal audit

the internal security audit is a detailed internal review of this codebase, written during
development. It is a working engineering document rather than a summary for users, and it
records what has **not** been verified as carefully as what has.
