import type { AnalyzeError } from '@/lib/api';

/**
 * Remembers, for this session, whether AI scanning exists on this deployment.
 *
 * The API contract has no health endpoint, and we won't invent one — so availability is
 * discovered from the first real attempt. Once a 503 (`ai_unconfigured`) or a 404 tells
 * us the feature isn't there, we stop offering the uploader for the rest of the session
 * instead of inviting the user to fail again.
 *
 * Deliberately in memory only: a redeploy that adds the key should not have to fight a
 * stale flag in the user's localStorage.
 */
export type ScanAvailability = 'unknown' | 'available' | 'unavailable';

let availability: ScanAvailability = 'unknown';
let reason: string | null = null;

export function getScanAvailability(): ScanAvailability {
  return availability;
}

export function getUnavailableReason(): string | null {
  return reason;
}

export function markScanAvailable(): void {
  availability = 'available';
  reason = null;
}

export function markScanUnavailable(error: AnalyzeError, message: string): void {
  if (!error.isFeatureUnavailable) return;
  availability = 'unavailable';
  reason = message;
}

/** Test-only reset; module state would otherwise leak between cases. */
export function resetScanAvailability(): void {
  availability = 'unknown';
  reason = null;
}
