import { errorResponse, jsonResponse } from '../_lib/http.js';
import { type AuthHandlerDeps, resolveAuthDeps } from '../_lib/auth/deps.js';
import { isTrustedOrigin } from '../_lib/auth/origin.js';
import {
  authenticateSession,
  clearSessionCookieHeader,
  revokeAllSessions,
} from '../_lib/auth/session-store.js';

/**
 * POST /api/auth/logout-all — "log out everywhere". Revokes every live session row for
 * the authenticated user, including the one making this request, then clears this
 * device's cookie too. This is the property JWT sessions cannot give you (the project plan
 * §2) and the entire reason session state lives in Postgres: revocation is a real row
 * update, checked on every subsequent request via `authenticateSession`.
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

      await revokeAllSessions(db, auth.session.userId);

      return jsonResponse({ ok: true }, 200, { 'Set-Cookie': clearSessionCookieHeader() });
    } catch (cause) {
      console.error('auth/logout-all: unhandled error', {
        name: cause instanceof Error ? cause.name : typeof cause,
      });
      return errorResponse('server_error', 500);
    }
  };
}

const handler = createHandler();
export default { fetch: handler };
