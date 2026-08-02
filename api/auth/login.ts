import { eq } from 'drizzle-orm';
import { errorResponse, jsonResponse } from '../_lib/http.js';
import { clientIpFrom } from '../_lib/rate-limit.js';
import { users } from '../_lib/db/schema.js';
import { type AuthHandlerDeps, resolveAuthDeps } from '../_lib/auth/deps.js';
import { hashIp } from '../_lib/auth/ip.js';
import { isTrustedOrigin } from '../_lib/auth/origin.js';
import { getDummyHash, verifySecret } from '../_lib/auth/password.js';
import { markAttemptPairSucceeded, RATE_LIMIT_RULES, reserveAttemptPair } from '../_lib/auth/rate-limit-db.js';
import { loginSchema, parseJsonBody } from '../_lib/auth/schemas.js';
import { createSession } from '../_lib/auth/session-store.js';
import { toPublicUser } from '../_lib/auth/users.js';

/**
 * POST /api/auth/login.
 *
 * The security-critical property of this handler: a wrong email and a wrong password
 * produce the exact same response — same status (401), same body
 * (`{ error: 'invalid_credentials' }`), and the same *shape of work* on every request,
 * so they cost the same wall-clock time too. That is enforced structurally, not by
 * convention: `hashToVerify` is always a real argon2id/scrypt hash — the user's own row
 * when the account exists, a fixed dummy hash of identical cost otherwise — and exactly
 * one `verifySecret()` call always runs, on the same code path, before the response is
 * built either way. See api/auth/login.test.ts for the timing/enumeration assertions.
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

      const parsed = await parseJsonBody(request, loginSchema);
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
        action: 'login',
      });
      if (gate.limited) {
        return errorResponse('rate_limited', 429, {
          'Retry-After': String(Math.ceil(RATE_LIMIT_RULES.login.account.windowMs / 1000)),
        });
      }

      const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
      const user = rows[0] ?? null;

      const hashToVerify = user ? user.passwordHash : await getDummyHash();
      const passwordOk = await verifySecret(hashToVerify, password);
      const success = user !== null && passwordOk;

      // Only a genuine success flips the reserved rows; the account bucket counts
      // failures only, so a user's own repeated sign-ins can never lock them out
      // (the internal security audit F-05).
      if (success) await markAttemptPairSucceeded(db, gate);

      if (!success || !user) {
        return errorResponse('invalid_credentials', 401);
      }

      const { cookieHeader } = await createSession(db, {
        userId: user.id,
        pepper,
        ip,
        userAgent: request.headers.get('user-agent'),
      });

      return jsonResponse({ user: toPublicUser(user) }, 200, { 'Set-Cookie': cookieHeader });
    } catch (cause) {
      console.error('auth/login: unhandled error', {
        name: cause instanceof Error ? cause.name : typeof cause,
      });
      return errorResponse('server_error', 500);
    }
  };
}

const handler = createHandler();
export default { fetch: handler };
