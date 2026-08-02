import { eq } from 'drizzle-orm';
import { errorResponse, jsonResponse } from '../_lib/http.js';
import { clientIpFrom } from '../_lib/rate-limit.js';
import { users } from '../_lib/db/schema.js';
import { isUniqueViolationOn } from '../_lib/db/pg-errors.js';
import { type AuthHandlerDeps, resolveAuthDeps } from '../_lib/auth/deps.js';
import { hashIp } from '../_lib/auth/ip.js';
import { isTrustedOrigin } from '../_lib/auth/origin.js';
import { hashSecret } from '../_lib/auth/password.js';
import { generateRecoveryCode, normalizeRecoveryCode } from '../_lib/auth/recovery.js';
import { markAttemptPairSucceeded, RATE_LIMIT_RULES, reserveAttemptPair } from '../_lib/auth/rate-limit-db.js';
import { parseJsonBody, signupSchema } from '../_lib/auth/schemas.js';
import { createSession } from '../_lib/auth/session-store.js';
import { toPublicUser } from '../_lib/auth/users.js';

/**
 * POST /api/auth/signup — create an account, log it in immediately, and hand back the
 * one-time recovery code (docs/API.md). The code is never retrievable again after this
 * response; the server keeps only its argon2id hash.
 *
 * `DATABASE_URL`/`SESSION_PEPPER` unset → `503 { error: 'sync_unconfigured' }`, mirroring
 * `api/analyze-meal.ts`'s `ai_unconfigured` contract — an unconfigured deployment is a
 * supported state, checked before anything else that could fail.
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

      const parsed = await parseJsonBody(request, signupSchema);
      if (!parsed.ok) return errorResponse(parsed.reason, parsed.reason === 'too_large' ? 413 : 400);
      const { email, password } = parsed.value;

      const ip = clientIpFrom(request.headers);
      const ipHash = hashIp(ip, pepper);

      // The attempt is RESERVED (recorded) before any work happens. Checking a count
      // first and inserting only after the argon2 verify let every concurrent request
      // read the same stale count — 20 simultaneous wrong-password logins against a cap
      // of 8 all succeeded in getting through. See api/_lib/auth/rate-limit-db.ts and
      // the internal security audit F-01.
      const gate = await reserveAttemptPair(db, {
        ipKey: ipHash,
        accountKey: email,
        action: 'signup',
      });
      if (gate.limited) {
        return errorResponse('rate_limited', 429, {
          'Retry-After': String(Math.ceil(RATE_LIMIT_RULES.signup.account.windowMs / 1000)),
        });
      }

      // Signup, unlike login, is allowed to say "that email is taken" — this is
      // expected UX (docs/API.md explains why this does not conflict with the login
      // endpoint's no-enumeration requirement, which is about a *different* endpoint).
      const existing = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);
      if (existing.length > 0) {
        // No recordAttempt here: the gate above already reserved both rows as
        // provisional failures, which is exactly what a taken email should count as.
        return errorResponse('email_taken', 409);
      }

      const passwordHash = await hashSecret(password);
      const recoveryCode = generateRecoveryCode();
      const recoveryCodeHash = await hashSecret(normalizeRecoveryCode(recoveryCode));

      // SECURITY — the internal security audit F-07. The SELECT above is a courtesy check, not the
      // guarantee: with no transaction available on neon-http (docs/API.md), two
      // simultaneous signups for one email both pass it and both INSERT. The
      // `users_email_key` unique index is what actually prevents the duplicate account —
      // that part always worked — but the loser's raw 23505 used to reach the catch-all
      // and answer `500 server_error`, making a perfectly ordinary collision look like a
      // server fault and hiding it from the client's error handling. Catching the
      // violation reports the index's verdict as the `409 email_taken` the contract
      // already promises. Matched on the constraint NAME so an unrelated unique violation
      // on `users` still surfaces as a genuine 500 instead of a confidently wrong message.
      let created;
      try {
        [created] = await db
          .insert(users)
          .values({ email, passwordHash, recoveryCodeHash })
          .returning();
      } catch (cause) {
        if (isUniqueViolationOn(cause, 'users_email_key')) {
          return errorResponse('email_taken', 409);
        }
        throw cause;
      }
      if (!created) throw new Error('signup: insert returned no row');

      const { cookieHeader } = await createSession(db, {
        userId: created.id,
        pepper,
        ip,
        userAgent: request.headers.get('user-agent'),
      });

      await markAttemptPairSucceeded(db, gate);

      return jsonResponse({ user: toPublicUser(created), recoveryCode }, 201, {
        'Set-Cookie': cookieHeader,
      });
    } catch (cause) {
      console.error('auth/signup: unhandled error', {
        name: cause instanceof Error ? cause.name : typeof cause,
      });
      return errorResponse('server_error', 500);
    }
  };
}

const handler = createHandler();
export default { fetch: handler };
