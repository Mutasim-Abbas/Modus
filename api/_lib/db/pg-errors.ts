/**
 * Postgres SQLSTATE inspection, shared by every route that has to tell a *specific*,
 * expected database conflict apart from "something unexpected broke".
 *
 * This exists as its own module because two independent findings needed the same
 * primitive and a second hand-rolled copy is exactly how the two would drift apart:
 *
 * - `api/sync/push.ts` — weights' `(user_id, day)` live-uniqueness fallback
 *   (the internal security audit F-02's neighbourhood).
 * - `api/auth/signup.ts` — the concurrent-signup race (the internal security audit **F-07**), where
 *   two simultaneous requests for one email both pass the `SELECT` existence check, both
 *   `INSERT`, and the loser's `users_email_key` violation reached the catch-all as
 *   `500 server_error` instead of the `409 email_taken` the contract promises. There is no
 *   transaction available to prevent the race (`neon-http` has none — docs/API.md), so
 *   handling the violation *is* the fix: the unique index remains the thing that actually
 *   guarantees correctness, and this just reports its verdict honestly.
 *
 * The `.cause` walk is not defensive padding. drizzle-orm's pglite and neon-http drivers
 * both wrap the raw driver error in their own `DrizzleQueryError`, which does **not**
 * forward `.code` to the top level — the original Postgres error, which does carry it, is
 * nested at `.cause`. Verified directly against a real PGlite conflict rather than assumed.
 */

/** The Postgres error code, unwrapping drizzle's error envelope. `undefined` if absent. */
export function pgErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const direct = (error as { code?: unknown }).code;
  if (typeof direct === 'string') return direct;
  const cause = (error as { cause?: unknown }).cause;
  if (typeof cause === 'object' && cause !== null) {
    const nested = (cause as { code?: unknown }).code;
    if (typeof nested === 'string') return nested;
  }
  return undefined;
}

/** SQLSTATE 23505 — unique_violation. */
export const isUniqueViolation = (error: unknown): boolean => pgErrorCode(error) === '23505';

/**
 * True when the violation is specifically the named constraint.
 *
 * Callers that map a violation onto a typed 4xx must use this, never bare
 * `isUniqueViolation`: `users` also carries other unique indexes, and answering
 * `409 email_taken` for an unrelated collision would be a confidently wrong error message
 * hiding a real bug. Anything that is not the named constraint must keep bubbling up to
 * the catch-all as a genuine `500`.
 */
export function isUniqueViolationOn(error: unknown, constraint: string): boolean {
  if (!isUniqueViolation(error)) return false;
  const detail = constraintNameFrom(error);
  return detail === constraint;
}

function constraintNameFrom(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const direct = (error as { constraint?: unknown }).constraint;
  if (typeof direct === 'string') return direct;
  const cause = (error as { cause?: unknown }).cause;
  if (typeof cause === 'object' && cause !== null) {
    const nested = (cause as { constraint?: unknown }).constraint;
    if (typeof nested === 'string') return nested;
  }
  return undefined;
}
