/**
 * HTTP boundary helpers.
 *
 * Files under `api/_lib/` are shared code, not routes: Vercel's api builder skips any
 * path containing `/_`. See docs/API.md for the contract these helpers serve.
 */

/**
 * Error codes returned to the client. `docs/API.md` pins the first four — the client
 * (`src/lib/api.ts`) branches on the status code and, for 503, also on this string.
 */
export type ErrorCode =
  | 'invalid_input'
  | 'too_large'
  | 'rate_limited'
  | 'ai_unconfigured'
  | 'method_not_allowed'
  | 'analysis_refused'
  | 'upstream_error'
  | 'server_error'
  // Auth (api/auth/*, docs/API.md) — added in P2.2.
  | 'sync_unconfigured'
  | 'unauthorized'
  | 'invalid_credentials'
  | 'origin_rejected'
  | 'email_taken'
  | 'recovery_invalid';

/**
 * Headers applied to every response.
 *
 * - `no-store`: an estimate must never be replayed from a cache. The service worker
 *   already refuses to cache `/api/` (vite.config.ts); this is the server-side half.
 * - `nosniff`: the body is always JSON; never let a browser re-interpret it.
 * - No `Access-Control-Allow-Origin`: the app is served from the same deployment, so
 *   same-origin requests need no CORS grant. Omitting it means other origins cannot
 *   read the response — the lock is the absence of the header, not a header value.
 */
const BASE_HEADERS: Readonly<Record<string, string>> = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

export function jsonResponse(body: unknown, status: number, extraHeaders?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...BASE_HEADERS, ...extraHeaders },
  });
}

/**
 * The only way this codebase emits an error body. Keeps the shape `{ error: code }`
 * uniform and guarantees no exception detail ever reaches the client.
 */
export function errorResponse(
  code: ErrorCode,
  status: number,
  extraHeaders?: Record<string, string>,
): Response {
  return jsonResponse({ error: code }, status, extraHeaders);
}
