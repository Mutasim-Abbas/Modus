import { eq } from 'drizzle-orm';
import { errorResponse, jsonResponse } from '../_lib/http.js';
import { users } from '../_lib/db/schema.js';
import { type AuthHandlerDeps, resolveAuthDeps } from '../_lib/auth/deps.js';
import { authenticateSession } from '../_lib/auth/session-store.js';
import { toPublicUser } from '../_lib/auth/users.js';

/**
 * GET /api/auth/me — the app's "am I signed in" check on every load. Read-only, so no
 * Origin/Sec-Fetch-Site check (that guard is for mutating requests only). Slides the
 * session's expiry forward on every call, same as any other authenticated request.
 */
export function createHandler(overrides: AuthHandlerDeps = {}) {
  return async function handler(request: Request): Promise<Response> {
    try {
      if (request.method !== 'GET') {
        return errorResponse('method_not_allowed', 405, { Allow: 'GET' });
      }

      const deps = resolveAuthDeps(overrides);
      if (!deps) return errorResponse('sync_unconfigured', 503);
      const { db, pepper } = deps;

      const auth = await authenticateSession(db, pepper, request);
      if (!auth.ok) return errorResponse('unauthorized', 401);

      const rows = await db.select().from(users).where(eq(users.id, auth.session.userId)).limit(1);
      const user = rows[0];
      if (!user) return errorResponse('unauthorized', 401);

      return jsonResponse({ user: toPublicUser(user) }, 200, { 'Set-Cookie': auth.cookieHeader });
    } catch (cause) {
      console.error('auth/me: unhandled error', {
        name: cause instanceof Error ? cause.name : typeof cause,
      });
      return errorResponse('server_error', 500);
    }
  };
}

const handler = createHandler();
export default { fetch: handler };
