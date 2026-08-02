/**
 * CSRF defence for mutating auth requests (docs/PLAN.md §2: "`SameSite=Lax` plus a
 * server-side `Origin`/`Sec-Fetch-Site` check on every mutating request. Reject on
 * mismatch.").
 *
 * `SameSite=Lax` already blocks the cookie from riding along on a cross-site POST from
 * another page's `<form>` or `fetch`. This is the belt to that braces: it also blocks
 * the cases `Lax` does not (a cross-site GET-turned-navigation is `Lax`-exempt, and
 * `Lax` itself gives no protection to a network position that can forge headers but not
 * read/set cookies). It is applied only to state-changing requests — `GET /api/auth/me`
 * does not call this.
 */

/**
 * `Sec-Fetch-Site` is a browser-set, non-spoofable-by-script request header (Fetch
 * Metadata). `same-origin` is our own frontend calling our own API. `none` is a
 * user-initiated top-level navigation with no initiating document (typed URL, bookmark)
 * — there is no cross-site actor to defend against in that case either. `same-site` and
 * `cross-site` are rejected: nothing in this app legitimately calls the API from a
 * sibling subdomain or another site.
 */
function secFetchSiteAllows(value: string | null): boolean | null {
  if (value === null) return null;
  return value === 'same-origin' || value === 'none';
}

/**
 * Returns true only when the request can be confidently attributed to this app's own
 * origin. Older browsers/HTTP clients that send neither header are treated as
 * untrusted rather than assumed same-origin — `docs/API.md` documents this for anyone
 * scripting against the API directly (tests set both headers explicitly).
 */
export function isTrustedOrigin(request: Request): boolean {
  const secFetchSite = secFetchSiteAllows(request.headers.get('sec-fetch-site'));
  if (secFetchSite === false) return false;

  const origin = request.headers.get('origin');
  if (origin !== null) {
    const expectedOrigin = new URL(request.url).origin;
    if (origin !== expectedOrigin) return false;
    // Origin matches: sufficient on its own even if Sec-Fetch-Site was absent.
    return true;
  }

  // No Origin header: only trust it if Sec-Fetch-Site explicitly vouched for us.
  return secFetchSite === true;
}
