/**
 * Session tokens and the `__Host-fm_session` cookie.
 *
 * Deliberately **opaque, not JWT** (docs/PLAN.md §2): a JWT cannot be revoked short of
 * a blocklist, which defeats the point of having one. An opaque token is meaningless on
 * its own — it is looked up against `sessions.token_hash` on every request, so deleting
 * or revoking that row is real, immediate revocation, which is what makes "log out
 * everywhere" (api/auth/logout-all.ts) actually work.
 *
 * The raw token is only ever kept in the cookie, on the client. The server stores and
 * ever after only ever sees `HMAC-SHA256(token, SESSION_PEPPER)` — see docs/DB.md §4.2.
 * Keyed (HMAC), not a bare SHA-256, so a stolen `sessions` table alone (no `SESSION_PEPPER`)
 * cannot be turned into a rainbow-table / offline-crack of live tokens.
 */

import { createHmac, randomBytes } from 'node:crypto';

export const SESSION_COOKIE_NAME = '__Host-fm_session';

const TOKEN_BYTES = 32; // 256 bits, per docs/PLAN.md §2.

/** Sliding window: pushed forward on every authenticated request, capped by ABSOLUTE. */
export const SLIDING_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
/** Hard cap, set once at session creation and never extended past it. */
export const ABSOLUTE_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

export function generateSessionToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

/** Hex-encoded HMAC-SHA256(token, pepper) — matches sessions.token_hash's `^[0-9a-f]{64}$` check. */
export function hashSessionToken(token: string, pepper: string): string {
  return createHmac('sha256', pepper).update(token).digest('hex');
}

/**
 * Reads the raw session token from the request's `Cookie` header. Returns `null` if the
 * cookie is absent or empty — never throws on a malformed header, since that header is
 * entirely attacker-controlled.
 */
export function readSessionCookie(request: Request): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;

  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (name !== SESSION_COOKIE_NAME) continue;
    const value = part.slice(eq + 1).trim();
    if (value.length === 0) return null;
    try {
      return decodeURIComponent(value);
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * `__Host-` prefix requires exactly `Secure`, `Path=/`, and no `Domain` attribute — all
 * true here (docs/PLAN.md §2). `Secure` cookies work over plain `http://localhost` too:
 * browsers treat localhost as a secure context, so local dev is unaffected.
 */
export function setSessionCookieHeader(token: string, maxAgeSeconds: number): string {
  const clampedMaxAge = Math.max(0, Math.floor(maxAgeSeconds));
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${clampedMaxAge}`;
}

export function clearSessionCookieHeader(): string {
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}
