import { eq } from 'drizzle-orm';
import { errorResponse, jsonResponse } from '../_lib/http.js';
import { clientIpFrom } from '../_lib/rate-limit.js';
import { users } from '../_lib/db/schema.js';
import { type AuthHandlerDeps, resolveAuthDeps } from '../_lib/auth/deps.js';
import { hashIp } from '../_lib/auth/ip.js';
import { isTrustedOrigin } from '../_lib/auth/origin.js';
import { verifySecret } from '../_lib/auth/password.js';
import { markAttemptPairSucceeded, RATE_LIMIT_RULES, reserveAttemptPair } from '../_lib/auth/rate-limit-db.js';
import { deleteAccountSchema, parseJsonBody } from '../_lib/auth/schemas.js';
import { authenticateSession, clearSessionCookieHeader } from '../_lib/auth/session-store.js';

/**
 * POST /api/auth/delete-account — real deletion, not a flag (docs/PLAN.md §4.1).
 * Requires the current password, same defense-in-depth reasoning as change-password: a
 * live session alone must not be enough to destroy the account.
 *
 * The delete itself is a single `DELETE FROM users WHERE id = $1`; every row the user
 * owns across all seven tables in docs/DB.md §5 is removed by the database's own
 * `ON DELETE CASCADE` in that one statement — not a sequence of application-level
 * deletes a bug could leave incomplete.
 *
 * Reuses the `password_change` rate-limit bucket rather than adding a new
 * `auth_attempts.action` enum value for a second password-verification flow — both are
 * "prove you still know your password" checks with the same abuse shape. Adding a new
 * enum value is a real migration (docs/DB.md §2.5); this is a deliberate, documented
 * reuse rather than scope creep into P2.1's committed schema.
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

      const auth = await authenticateSession(db, pepper, request);
      if (!auth.ok) return errorResponse('unauthorized', 401);

      const parsed = await parseJsonBody(request, deleteAccountSchema);
      if (!parsed.ok) return errorResponse(parsed.reason, parsed.reason === 'too_large' ? 413 : 400);
      const { password } = parsed.value;

      const rows = await db.select().from(users).where(eq(users.id, auth.session.userId)).limit(1);
      const user = rows[0];
      if (!user) return errorResponse('unauthorized', 401);

      const ip = clientIpFrom(request.headers);
      const ipHash = hashIp(ip, pepper);

      // The attempt is RESERVED (recorded) before any work happens. Checking a count
      // first and inserting only after the argon2 verify let every concurrent request
      // read the same stale count — 20 simultaneous wrong-password logins against a cap
      // of 8 all succeeded in getting through. See api/_lib/auth/rate-limit-db.ts and
      // the internal security audit F-01.
      const gate = await reserveAttemptPair(db, {
        ipKey: ipHash,
        accountKey: user.email,
        action: 'password_change',
      });
      if (gate.limited) {
        return errorResponse('rate_limited', 429, {
          'Retry-After': String(Math.ceil(RATE_LIMIT_RULES.password_change.account.windowMs / 1000)),
        });
      }

      const passwordOk = await verifySecret(user.passwordHash, password);
      if (passwordOk) await markAttemptPairSucceeded(db, gate);
      if (!passwordOk) return errorResponse('invalid_credentials', 401);

      // Cascades to sessions, profile, entries, weights, custom_foods, favourites and
      // user_settings in this one statement (docs/DB.md §5). auth_attempts for this
      // email deliberately survive — see docs/DB.md §4.3.
      await db.delete(users).where(eq(users.id, user.id));

      return jsonResponse({ ok: true }, 200, { 'Set-Cookie': clearSessionCookieHeader() });
    } catch (cause) {
      console.error('auth/delete-account: unhandled error', {
        name: cause instanceof Error ? cause.name : typeof cause,
      });
      return errorResponse('server_error', 500);
    }
  };
}

const handler = createHandler();
export default { fetch: handler };
