import { errorResponse, jsonResponse } from '../_lib/http.js';
import { type AuthHandlerDeps, resolveAuthDeps } from '../_lib/auth/deps.js';
import { isTrustedOrigin } from '../_lib/auth/origin.js';
import {
  clearSessionCookieHeader,
  readSessionCookie,
  revokeSessionByToken,
} from '../_lib/auth/session-store.js';

/**
 * POST /api/auth/logout — revokes exactly the calling device's session and clears its
 * cookie. Idempotent and always `200`: logging out with no session, an already-revoked
 * session, or a garbage cookie all just result in "you are logged out", never an error
 * — there is nothing a client can meaningfully retry differently.
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

      const token = readSessionCookie(request);
      if (token) {
        await revokeSessionByToken(db, pepper, token);
      }

      return jsonResponse({ ok: true }, 200, { 'Set-Cookie': clearSessionCookieHeader() });
    } catch (cause) {
      console.error('auth/logout: unhandled error', {
        name: cause instanceof Error ? cause.name : typeof cause,
      });
      return errorResponse('server_error', 500);
    }
  };
}

const handler = createHandler();
export default { fetch: handler };
