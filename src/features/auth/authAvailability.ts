import type { AuthError } from '@/lib/authApi';

/**
 * Remembers, for this session, whether accounts/sync exist on this deployment.
 *
 * Mirrors `src/features/scan/availability.ts` exactly: there is no health-check
 * endpoint, and we won't invent one, so availability is discovered from the first real
 * auth attempt (in practice, the `GET /api/auth/me` probe `AuthContext` fires on boot).
 * Once a `503 sync_unconfigured` tells us the feature isn't there, auth UI hides itself
 * entirely (docs/DESIGN.md §7.10) instead of offering a sign-in button that can only 503.
 *
 * Deliberately in memory only — a redeploy that adds `DATABASE_URL`/`SESSION_PEPPER`
 * should not have to fight a stale flag in the user's localStorage, and (separately)
 * nothing about auth is ever allowed to touch localStorage/sessionStorage at all.
 */
export type AuthAvailability = 'unknown' | 'available' | 'unavailable';

let availability: AuthAvailability = 'unknown';

export function getAuthAvailability(): AuthAvailability {
  return availability;
}

export function markAuthAvailable(): void {
  availability = 'available';
}

export function markAuthUnavailable(error: AuthError): void {
  if (!error.isUnconfigured) return;
  availability = 'unavailable';
}

/** Test-only reset; module state would otherwise leak between cases. */
export function resetAuthAvailability(): void {
  availability = 'unknown';
}
