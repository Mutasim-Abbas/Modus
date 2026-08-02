/**
 * Session lifecycle against the `sessions` table: create (signup/login/rotation),
 * authenticate + slide (every authenticated request), and revoke (logout /
 * logout-everywhere / password-change rotation).
 */

import { and, eq, gt, isNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { sessions } from '../db/schema.js';
import { hashIp } from './ip.js';
import {
  ABSOLUTE_WINDOW_MS,
  clearSessionCookieHeader,
  generateSessionToken,
  hashSessionToken,
  readSessionCookie,
  setSessionCookieHeader,
  SLIDING_WINDOW_MS,
} from './session.js';

export interface CreateSessionParams {
  userId: string;
  pepper: string;
  ip: string;
  userAgent: string | null;
  now?: Date;
}

export interface CreatedSession {
  cookieHeader: string;
}

/** Inserts a new session row and returns the `Set-Cookie` header value for it. */
export async function createSession(db: Db, params: CreateSessionParams): Promise<CreatedSession> {
  const now = params.now ?? new Date();
  const token = generateSessionToken();
  const expiresAt = new Date(now.getTime() + SLIDING_WINDOW_MS);
  const absoluteExpiresAt = new Date(now.getTime() + ABSOLUTE_WINDOW_MS);

  await db.insert(sessions).values({
    userId: params.userId,
    tokenHash: hashSessionToken(token, params.pepper),
    createdAt: now,
    lastSeenAt: now,
    expiresAt,
    absoluteExpiresAt,
    userAgent: params.userAgent,
    ipHash: hashIp(params.ip, params.pepper),
  });

  return { cookieHeader: setSessionCookieHeader(token, SLIDING_WINDOW_MS / 1000) };
}

export type AuthenticateResult =
  | { ok: true; session: typeof sessions.$inferSelect; cookieHeader: string }
  | { ok: false };

/**
 * Resolves the session cookie on a request to a live, non-revoked, non-expired session
 * row, and slides its expiry forward (capped at `absolute_expires_at`) — this is what
 * "sliding 30-day / hard 90-day expiry" means in practice. Returns a refreshed
 * `Set-Cookie` header the caller should attach to its response so the cookie's own
 * `Max-Age` stays in sync with the row's new `expires_at`.
 */
export async function authenticateSession(
  db: Db,
  pepper: string,
  request: Request,
  now: Date = new Date(),
): Promise<AuthenticateResult> {
  const token = readSessionCookie(request);
  if (!token) return { ok: false };

  const tokenHash = hashSessionToken(token, pepper);
  const rows = await db
    .select()
    .from(sessions)
    .where(
      and(
        eq(sessions.tokenHash, tokenHash),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, now),
        gt(sessions.absoluteExpiresAt, now),
      ),
    )
    .limit(1);

  const session = rows[0];
  if (!session) return { ok: false };

  const newExpiresAt = new Date(
    Math.min(now.getTime() + SLIDING_WINDOW_MS, session.absoluteExpiresAt.getTime()),
  );
  await db
    .update(sessions)
    .set({ lastSeenAt: now, expiresAt: newExpiresAt })
    .where(eq(sessions.id, session.id));

  const maxAgeSeconds = Math.max(0, (newExpiresAt.getTime() - now.getTime()) / 1000);
  return {
    ok: true,
    session: { ...session, lastSeenAt: now, expiresAt: newExpiresAt },
    cookieHeader: setSessionCookieHeader(token, maxAgeSeconds),
  };
}

/** Logout: revokes exactly the session the caller's cookie names. Idempotent. */
export async function revokeSessionByToken(db: Db, pepper: string, token: string): Promise<void> {
  const tokenHash = hashSessionToken(token, pepper);
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.tokenHash, tokenHash), isNull(sessions.revokedAt)));
}

/**
 * Logout-everywhere / password-change rotation: revokes every live session for a user.
 * Used standalone for "logout everywhere" and as the first half of password-change
 * rotation (docs/TODO.md P2.2: "rotation on password change").
 */
export async function revokeAllSessions(db: Db, userId: string): Promise<void> {
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
}

export { clearSessionCookieHeader, readSessionCookie };
