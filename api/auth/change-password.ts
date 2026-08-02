import { eq } from 'drizzle-orm';
import { errorResponse, jsonResponse } from '../_lib/http.js';
import { clientIpFrom } from '../_lib/rate-limit.js';
import { users } from '../_lib/db/schema.js';
import { type AuthHandlerDeps, resolveAuthDeps } from '../_lib/auth/deps.js';
import { hashIp } from '../_lib/auth/ip.js';
import { isTrustedOrigin } from '../_lib/auth/origin.js';
import { hashSecret, verifySecret } from '../_lib/auth/password.js';
import { markAttemptPairSucceeded, RATE_LIMIT_RULES, reserveAttemptPair } from '../_lib/auth/rate-limit-db.js';
import { changePasswordSchema, parseJsonBody } from '../_lib/auth/schemas.js';
import { authenticateSession, createSession, revokeAllSessions } from '../_lib/auth/session-store.js';
import { toPublicUser } from '../_lib/auth/users.js';

/**
 * POST /api/auth/change-password — requires an authenticated session AND the current
 * password (a stolen-but-live session cookie alone is not enough to take over the
 * account's credentials). On success: rotates the session — every existing session,
 * including the one making this request, is revoked, and a fresh one is issued
 * (docs/TODO.md P2.2: "rotation on password change").
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

      const parsed = await parseJsonBody(request, changePasswordSchema);
      if (!parsed.ok) return errorResponse(parsed.reason, parsed.reason === 'too_large' ? 413 : 400);
      const { currentPassword, newPassword } = parsed.value;

      const rows = await db.select().from(users).where(eq(users.id, auth.session.userId)).limit(1);
      const user = rows[0];
      // The session's own FK guarantees the user row exists (cascade delete removes
      // the session too), but a defensive check costs nothing.
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

      const currentOk = await verifySecret(user.passwordHash, currentPassword);
      if (currentOk) await markAttemptPairSucceeded(db, gate);
      if (!currentOk) return errorResponse('invalid_credentials', 401);

      const newPasswordHash = await hashSecret(newPassword);

      // SECURITY — the internal security audit F-10. Revoke BEFORE the password is written, not
      // after. There is no transaction on neon-http (docs/API.md), so the order chooses
      // the failure mode: revoke-then-update means a crash between the two leaves every
      // session dead and the password unchanged (the user retries — harmless), while
      // update-then-revoke leaves the new password in place with every previously stolen
      // cookie still live. "I think my password was leaked" is precisely why someone is
      // on this screen, so failing open here defeats the reason the feature exists.
      await revokeAllSessions(db, user.id);
      await db.update(users).set({ passwordHash: newPasswordHash }).where(eq(users.id, user.id));

      const { cookieHeader } = await createSession(db, {
        userId: user.id,
        pepper,
        ip,
        userAgent: request.headers.get('user-agent'),
      });

      return jsonResponse({ user: toPublicUser(user) }, 200, { 'Set-Cookie': cookieHeader });
    } catch (cause) {
      console.error('auth/change-password: unhandled error', {
        name: cause instanceof Error ? cause.name : typeof cause,
      });
      return errorResponse('server_error', 500);
    }
  };
}

const handler = createHandler();
export default { fetch: handler };
