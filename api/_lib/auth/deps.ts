/**
 * The "is this deployment configured at all" check every `api/auth/*` route starts
 * with — mirrors `api/analyze-meal.ts`'s `readApiKey()`/`ai_unconfigured` pattern
 * exactly, for the same reason: read the env fresh per request (so tests can
 * `vi.stubEnv` it and the real handler picks that up), and never throw.
 *
 * Both `DATABASE_URL` and `SESSION_PEPPER` are required for auth to run at all — a
 * database with no pepper to key session/IP hashes with is just as unusable as no
 * database, so either being absent yields the identical `503 sync_unconfigured`.
 */

import { createDb, type Db } from '../db/client.js';

export interface AuthHandlerDeps {
  /** Injected in tests (a real PGlite instance) instead of reading `DATABASE_URL`. */
  db?: Db;
  /** Injected in tests instead of reading `SESSION_PEPPER`. */
  pepper?: string;
}

export interface ResolvedAuthDeps {
  db: Db;
  pepper: string;
}

/**
 * SECURITY — the internal security audit F-11. `SESSION_PEPPER` HMAC-keys the stored hash of every
 * session token (`docs/DB.md` §4.2) and every stored IP. A deployment that sets
 * `SESSION_PEPPER=x` used to be accepted silently, giving a 1-byte key with no signal
 * anywhere — a misconfiguration that looks completely healthy and quietly removes most of
 * the value of hashing the tokens at all.
 *
 * 32 characters is a floor, not a recommendation. the project plan §2 tells the operator
 * to generate 32 random BYTES (`randomBytes(32).toString('hex')` = 64 hex chars), and any
 * sane encoding of a real 32-byte secret clears this bound comfortably — hex is 64 chars,
 * base64 is 44. The check is deliberately on length alone: entropy cannot be measured
 * from a string, so this catches the failure that actually happens in practice (a
 * placeholder, a truncated paste, a hand-typed word) without pretending to certify a
 * secret is strong.
 *
 * A too-short pepper is treated exactly like an absent one — `503 sync_unconfigured`,
 * the "this deployment is not configured" answer that already exists — rather than
 * throwing. Auth being unavailable is a supported state the whole app degrades to; a
 * crash-loop is not, and would take the guest-mode app down with it for a problem only
 * the operator can fix.
 */
const MIN_SESSION_PEPPER_CHARS = 32;

function readSessionPepper(): string | null {
  const pepper = process.env.SESSION_PEPPER?.trim();
  if (!pepper) return null;
  if (pepper.length < MIN_SESSION_PEPPER_CHARS) {
    // Length only — never the value, not even a prefix; this is a secret and this line
    // lands in a shared platform log.
    console.error('auth: SESSION_PEPPER is too short; refusing to use it', {
      length: pepper.length,
      required: MIN_SESSION_PEPPER_CHARS,
    });
    return null;
  }
  return pepper;
}

export function resolveAuthDeps(overrides: AuthHandlerDeps): ResolvedAuthDeps | null {
  const db = overrides.db ?? createDb();
  const pepper = overrides.pepper ?? readSessionPepper();
  if (!db || !pepper) return null;
  return { db, pepper };
}
