/**
 * Typed client for `api/auth/*` (docs/API.md).
 *
 * Mirrors the shape of `src/lib/api.ts`: every failure mode is a typed `AuthError` with
 * a `kind`, the server response is treated as untrusted input and validated field by
 * field, and nothing here ever invents a user or a result.
 *
 * Security-relevant contract this file exists to uphold:
 * - The session lives ONLY in the `__Host-fm_session` HttpOnly cookie. This module never
 *   reads, writes or references `localStorage`/`sessionStorage` for any credential or
 *   token — there is nothing here TO store, because the browser never exposes the
 *   cookie's value to script in the first place.
 * - Every request sends `credentials: 'same-origin'` so the cookie is attached on
 *   same-origin calls and never sent cross-origin.
 */

export interface AuthUser {
  id: string;
  email: string;
  emailVerified: boolean;
  createdAt: string;
}

export type AuthErrorKind =
  /** `DATABASE_URL`/`SESSION_PEPPER` unset on this deployment (503) — the whole feature is off. */
  | 'sync_unconfigured'
  | 'invalid_input'
  | 'too_large'
  | 'origin_rejected'
  | 'method_not_allowed'
  | 'rate_limited'
  | 'invalid_credentials'
  | 'email_taken'
  | 'unauthorized'
  | 'recovery_invalid'
  | 'network'
  | 'server'
  | 'malformed_response';

export class AuthError extends Error {
  readonly kind: AuthErrorKind;
  /** Seconds until a retry may succeed, from the server's `Retry-After` header. Only ever set for `rate_limited`. */
  readonly retryAfterSeconds: number | null;

  constructor(kind: AuthErrorKind, message: string, retryAfterSeconds: number | null = null) {
    super(message);
    this.name = 'AuthError';
    this.kind = kind;
    this.retryAfterSeconds = retryAfterSeconds;
  }

  /** True when the whole feature is off on this deployment, not just this one attempt. */
  get isUnconfigured(): boolean {
    return this.kind === 'sync_unconfigured';
  }
}

/** Shared fallback copy. Screens override the identity-proving kinds with the exact,
 *  enumeration-safe wording docs/DESIGN.md §7.9 specifies for that particular form. */
export function authErrorMessage(error: AuthError): string {
  switch (error.kind) {
    case 'sync_unconfigured':
      return "Accounts aren't set up on this deployment. Everything still works and stays on this device.";
    case 'invalid_input':
      return 'Check the fields and try again.';
    case 'too_large':
      return 'That request was too large.';
    case 'origin_rejected':
      return "This request couldn't be verified. Reload the page and try again.";
    case 'method_not_allowed':
      return 'Something went wrong contacting the server.';
    case 'rate_limited':
      return 'Too many attempts. Please wait and try again.';
    case 'invalid_credentials':
      return "That email and password don't match.";
    case 'email_taken':
      return 'That email already has an account.';
    case 'unauthorized':
      return "You've been signed out. Please sign in again.";
    case 'recovery_invalid':
      return "That email and recovery code don't match.";
    case 'network':
      return "Couldn't reach the server. Check your connection and try again.";
    case 'malformed_response':
      return 'The server sent back something unexpected.';
    case 'server':
      return 'Something went wrong on the server. Nothing was changed.';
  }
}

/* ------------------------------------------------------------------ *
 * Response validation — every server response is untrusted input      *
 * ------------------------------------------------------------------ */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseUser(value: unknown): AuthUser {
  if (!isRecord(value)) {
    throw new AuthError('malformed_response', 'Response was missing a user.');
  }
  const id = typeof value.id === 'string' ? value.id : '';
  const email = typeof value.email === 'string' ? value.email : '';
  if (!id || !email) {
    throw new AuthError('malformed_response', 'Response carried a malformed user.');
  }
  return {
    id,
    email,
    emailVerified: value.emailVerified === true,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : '',
  };
}

function parseRetryAfter(headers: Headers): number | null {
  const raw = headers.get('Retry-After');
  if (!raw) return null;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

const CODE_TO_KIND: Partial<Record<string, AuthErrorKind>> = {
  sync_unconfigured: 'sync_unconfigured',
  invalid_input: 'invalid_input',
  too_large: 'too_large',
  origin_rejected: 'origin_rejected',
  method_not_allowed: 'method_not_allowed',
  rate_limited: 'rate_limited',
  invalid_credentials: 'invalid_credentials',
  email_taken: 'email_taken',
  unauthorized: 'unauthorized',
  recovery_invalid: 'recovery_invalid',
  server_error: 'server',
};

function errorForResponse(status: number, body: unknown, headers: Headers): AuthError {
  const code = isRecord(body) && typeof body.error === 'string' ? body.error : '';
  const retryAfterSeconds = parseRetryAfter(headers);

  const known = CODE_TO_KIND[code];
  if (known) {
    return new AuthError(known, `Server returned ${code}.`, known === 'rate_limited' ? retryAfterSeconds : null);
  }

  // The server always sends a recognised `error` code (docs/API.md, "Errors common to
  // every route"); this is a defensive fallback keyed on status alone in case it doesn't.
  if (status === 503) return new AuthError('sync_unconfigured', 'Auth is not configured on this deployment.');
  if (status === 429) return new AuthError('rate_limited', 'Rate limited by the server.', retryAfterSeconds);
  if (status === 401) return new AuthError('unauthorized', 'No valid session.');
  if (status === 403) return new AuthError('origin_rejected', 'Cross-site request rejected.');
  if (status === 413) return new AuthError('too_large', 'Request exceeded the size limit.');
  if (status === 405) return new AuthError('method_not_allowed', 'Wrong HTTP method.');
  if (status === 409) return new AuthError('email_taken', 'Email already registered.');
  if (status === 400) return new AuthError('invalid_input', 'The server rejected the request.');
  return new AuthError('server', `Server returned ${status}.`);
}

/* ------------------------------------------------------------------ *
 * Transport                                                           *
 * ------------------------------------------------------------------ */

async function finish(response: Response): Promise<unknown> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    if (response.ok) throw new AuthError('malformed_response', 'Response was not valid JSON.');
  }
  if (!response.ok) throw errorForResponse(response.status, body, response.headers);
  return body;
}

async function doFetch(path: string, init: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    // credentials: 'same-origin' — the session cookie rides along on same-origin
    // requests only; it is never read or duplicated into JS-accessible storage here.
    response = await fetch(path, { ...init, credentials: 'same-origin' });
  } catch {
    throw new AuthError('network', 'Network request failed.');
  }
  return finish(response);
}

function postJson(path: string, body?: unknown): Promise<unknown> {
  // Built conditionally, rather than as an object literal with possibly-`undefined`
  // values, so this compiles under `exactOptionalPropertyTypes` against `RequestInit`
  // (a lib type we cannot annotate with an explicit `| undefined` ourselves).
  const init: RequestInit = { method: 'POST' };
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  return doFetch(path, init);
}

function getJson(path: string): Promise<unknown> {
  return doFetch(path, { method: 'GET' });
}

/**
 * Exposed so `src/lib/syncApi.ts` can reuse this exact same authenticated-fetch/error
 * taxonomy for `GET /api/sync/pull` (identical `503`/`401`/`429`/network error shapes,
 * per docs/API.md) without duplicating the transport and validation logic here.
 */
export function authFetchJson(path: string, init: RequestInit = {}): Promise<unknown> {
  return doFetch(path, init);
}

/* ------------------------------------------------------------------ *
 * Endpoints                                                            *
 * ------------------------------------------------------------------ */

export interface SignupResult {
  user: AuthUser;
  /** Shown to the user exactly once — never retrievable again. */
  recoveryCode: string;
}

export async function signup(email: string, password: string): Promise<SignupResult> {
  const body = await postJson('/api/auth/signup', { email, password });
  if (!isRecord(body) || typeof body.recoveryCode !== 'string' || !body.recoveryCode) {
    throw new AuthError('malformed_response', 'Signup response was missing a recovery code.');
  }
  return { user: parseUser(body.user), recoveryCode: body.recoveryCode };
}

export async function login(email: string, password: string): Promise<AuthUser> {
  const body = await postJson('/api/auth/login', { email, password });
  return parseUser(isRecord(body) ? body.user : null);
}

export async function logout(): Promise<void> {
  await postJson('/api/auth/logout');
}

export async function logoutAll(): Promise<void> {
  await postJson('/api/auth/logout-all');
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<AuthUser> {
  const body = await postJson('/api/auth/change-password', { currentPassword, newPassword });
  return parseUser(isRecord(body) ? body.user : null);
}

export async function deleteAccount(password: string): Promise<void> {
  await postJson('/api/auth/delete-account', { password });
}

export interface RecoveryRedeemResult {
  user: AuthUser;
  /** The old code stops working the instant this call succeeds — this is its replacement, shown once. */
  recoveryCode: string;
}

export async function recoveryRedeem(
  email: string,
  recoveryCode: string,
  newPassword: string,
): Promise<RecoveryRedeemResult> {
  const body = await postJson('/api/auth/recovery-redeem', { email, recoveryCode, newPassword });
  if (!isRecord(body) || typeof body.recoveryCode !== 'string' || !body.recoveryCode) {
    throw new AuthError('malformed_response', 'Recovery response was missing a new recovery code.');
  }
  return { user: parseUser(body.user), recoveryCode: body.recoveryCode };
}

/** "Am I signed in?" Throws `AuthError('unauthorized', ...)` when not, never a guess. */
export async function me(): Promise<AuthUser> {
  const body = await getJson('/api/auth/me');
  return parseUser(isRecord(body) ? body.user : null);
}
