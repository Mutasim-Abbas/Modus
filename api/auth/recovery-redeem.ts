import { and, eq } from 'drizzle-orm';
import { errorResponse, jsonResponse } from '../_lib/http.js';
import { clientIpFrom } from '../_lib/rate-limit.js';
import { users } from '../_lib/db/schema.js';
import { type AuthHandlerDeps, resolveAuthDeps } from '../_lib/auth/deps.js';
import { hashIp } from '../_lib/auth/ip.js';
import { isTrustedOrigin } from '../_lib/auth/origin.js';
import { getDummyHash, hashSecret, verifySecret } from '../_lib/auth/password.js';
import { generateRecoveryCode, normalizeRecoveryCode } from '../_lib/auth/recovery.js';
import { markAttemptPairSucceeded, RATE_LIMIT_RULES, reserveAttemptPair } from '../_lib/auth/rate-limit-db.js';
import { parseJsonBody, recoveryRedeemSchema } from '../_lib/auth/schemas.js';
import { createSession, revokeAllSessions } from '../_lib/auth/session-store.js';
import { toPublicUser } from '../_lib/auth/users.js';

/**
 * POST /api/auth/recovery-redeem — the entire account-recovery mechanism, since v3
 * sends no email (the project plan §2). Given the one-time recovery code shown at signup
 * plus a new password, this verifies the code, sets the new password, **rotates the
 * recovery code** (single-use: the old code stops working the moment this succeeds —
 * see docs/DB.md §4.1 and api/_lib/auth/recovery.ts), revokes every existing session,
 * and logs the caller in fresh.
 *
 * Wrong email and wrong recovery code are made indistinguishable — same status, body
 * and cost — using the identical dummy-hash technique as api/auth/login.ts, for the
 * same reason: this endpoint proves account ownership without a password, so it gets
 * the same no-enumeration treatment as a matter of consistent policy, even though
 * The project plan's acceptance criterion names login specifically.
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

      const parsed = await parseJsonBody(request, recoveryRedeemSchema);
      if (!parsed.ok) return errorResponse(parsed.reason, parsed.reason === 'too_large' ? 413 : 400);
      const { email, recoveryCode, newPassword } = parsed.value;

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
        action: 'recovery_redeem',
      });
      if (gate.limited) {
        return errorResponse('rate_limited', 429, {
          'Retry-After': String(Math.ceil(RATE_LIMIT_RULES.recovery_redeem.account.windowMs / 1000)),
        });
      }

      const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
      const user = rows[0] ?? null;

      const hashToVerify = user ? user.recoveryCodeHash : await getDummyHash();
      const codeOk = await verifySecret(hashToVerify, normalizeRecoveryCode(recoveryCode));
      const success = user !== null && codeOk;

      if (success) await markAttemptPairSucceeded(db, gate);

      if (!success || !user) {
        return errorResponse('recovery_invalid', 401);
      }

      const newPasswordHash = await hashSecret(newPassword);
      const newRecoveryCode = generateRecoveryCode();
      const newRecoveryCodeHash = await hashSecret(normalizeRecoveryCode(newRecoveryCode));

      // SECURITY — the internal security audit F-10. Sessions are revoked BEFORE the credential is
      // written, not after. There is no transaction on neon-http (docs/API.md), so one of
      // these two statements can be the last thing this process ever runs, and the order
      // decides which way that failure lands:
      //   revoke -> update : crash leaves sessions dead, password unchanged. The user
      //                      retries; nobody holds a live session. FAIL CLOSED.
      //   update -> revoke : crash leaves the password changed while every previously
      //                      stolen cookie is STILL LIVE — the exact attacker the person
      //                      is redeeming this code to evict. FAIL OPEN.
      // Free to fix, and strictly better under the no-transaction constraint P2.2 already
      // documented. The cost is a redemption that dies mid-flight logs the user out of
      // their other devices without changing anything, which is the harmless direction.
      await revokeAllSessions(db, user.id);

      // SECURITY — the internal security audit F-09. Compare-and-swap on the hash that was just
      // verified, not a bare `WHERE id = ?`. Single-use was only enforced *sequentially*
      // (the hash is replaced, so the old code stops verifying); under concurrency two
      // redemptions of the same still-valid code both verified and both wrote, and the
      // second silently overwrote the first. Both callers were then shown a DIFFERENT new
      // recovery code and only one of them was real — so a user who double-submits the
      // form could carefully write down a recovery code that was already dead, in the one
      // mechanism v3 has for getting back into an account. The account was never
      // compromised (both requests had to know the valid code); the failure was that the
      // only recovery path lied about its own output.
      //
      // The `recovery_code_hash` column is the CAS token: it is unique-per-redemption
      // (argon2id salts every hash) and it is exactly what the caller proved knowledge of.
      // Zero rows updated means another redemption won the race, and the honest answer is
      // that THIS redemption did not happen — same `recovery_invalid` a wrong code gets,
      // because from this caller's perspective the code it presented is indeed no longer
      // valid. The new code generated above is discarded unused; nothing is shown to the
      // loser that a later `verifySecret` would refuse.
      const redeemed = await db
        .update(users)
        .set({ passwordHash: newPasswordHash, recoveryCodeHash: newRecoveryCodeHash })
        .where(and(eq(users.id, user.id), eq(users.recoveryCodeHash, user.recoveryCodeHash)))
        .returning({ id: users.id });

      if (redeemed.length === 0) {
        return errorResponse('recovery_invalid', 401);
      }

      const { cookieHeader } = await createSession(db, {
        userId: user.id,
        pepper,
        ip,
        userAgent: request.headers.get('user-agent'),
      });

      return jsonResponse(
        { user: toPublicUser(user), recoveryCode: newRecoveryCode },
        200,
        { 'Set-Cookie': cookieHeader },
      );
    } catch (cause) {
      console.error('auth/recovery-redeem: unhandled error', {
        name: cause instanceof Error ? cause.name : typeof cause,
      });
      return errorResponse('server_error', 500);
    }
  };
}

const handler = createHandler();
export default { fetch: handler };
