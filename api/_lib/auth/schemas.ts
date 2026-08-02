/**
 * Zod schemas for every `api/auth/*` request body. This is the security boundary for
 * shape and type — the same rule `api/_lib/validate.ts` states for the scan endpoint:
 * the body is hostile input until proven otherwise.
 *
 * Every object schema is `.strict()`: an unrecognised key is a validation failure, not
 * silently dropped — this is the mass-assignment guard. A caller cannot smuggle e.g.
 * `{ email, password, isAdmin: true }` and have it silently ignored-but-logged or,
 * worse, someday accidentally wired up; it is rejected outright as `invalid_input`.
 */

import { z } from 'zod';

/** Trimmed, lowercased, bounded, and shape-checked — the exact form `users.email` stores. */
const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());

/**
 * Deliberately only a length bound, not a composition rule (uppercase/digit/symbol
 * requirements). Composition rules push users toward predictable patterns and are no
 * longer recommended (NIST 800-63B); length is what actually resists brute force, and
 * argon2id's cost parameters do the rest. 8 is NIST's own minimum; 256 bounds the input
 * before it ever reaches the hashing function, so an absurdly long string cannot be used
 * to inflate hashing cost into a DoS.
 */
const passwordSchema = z.string().min(8).max(256);

const recoveryCodeSchema = z.string().trim().min(4).max(64);

export const signupSchema = z
  .object({ email: emailSchema, password: passwordSchema })
  .strict();

export const loginSchema = z
  .object({ email: emailSchema, password: passwordSchema })
  .strict();

export const changePasswordSchema = z
  .object({ currentPassword: passwordSchema, newPassword: passwordSchema })
  .strict();

export const recoveryRedeemSchema = z
  .object({ email: emailSchema, recoveryCode: recoveryCodeSchema, newPassword: passwordSchema })
  .strict();

export const deleteAccountSchema = z.object({ password: passwordSchema }).strict();

export type SignupBody = z.infer<typeof signupSchema>;
export type LoginBody = z.infer<typeof loginSchema>;
export type ChangePasswordBody = z.infer<typeof changePasswordSchema>;
export type RecoveryRedeemBody = z.infer<typeof recoveryRedeemSchema>;
export type DeleteAccountBody = z.infer<typeof deleteAccountSchema>;

/**
 * Parses a JSON request body against a schema, returning a discriminated result instead
 * of throwing — every route uses this the same way so a malformed body always becomes
 * exactly `400 { error: 'invalid_input' }`, never a stack trace.
 *
 * Every field an auth body can legitimately carry is a short string (email, password,
 * recovery code) — nowhere near this cap. The body is read through a byte-capped
 * streaming reader rather than the trusting `Content-Length` header (which a client can
 * omit or lie about) or calling `request.json()` directly (which buffers an arbitrarily
 * large body into memory before we ever get a chance to reject it) — this is the
 * JSON-bomb / oversized-payload guard `api/_lib/validate.ts` already applies to the scan
 * endpoint, adapted for a JSON body instead of a base64 image.
 *
 * `api/_lib/sync/schemas.ts` (`P2.3`) reuses `parseJsonBody` with a larger, explicit
 * `maxBytes` — a sync push batch legitimately carries far more than an auth body ever
 * does, but the same "abort the stream the instant the cap is crossed" guarantee applies
 * either way. The default below is unchanged so every existing auth call site (which
 * omits the parameter) keeps its original 8 KB cap exactly.
 */
const MAX_AUTH_BODY_BYTES = 8 * 1024;

export type ParseJsonBodyFailure = { ok: false; reason: 'invalid_input' | 'too_large' };
export type ParseJsonBodyResult<T> = { ok: true; value: T } | ParseJsonBodyFailure;

/**
 * Reads a request body up to `maxBytes`. Returns `null` the moment the cap is exceeded
 * — the read is aborted immediately rather than continuing to buffer, so an attacker
 * cannot force this process to hold an arbitrarily large payload in memory even
 * momentarily.
 */
async function readBodyWithLimit(request: Request, maxBytes: number): Promise<string | null> {
  if (!request.body) return request.text();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf-8');
}

export async function parseJsonBody<T>(
  request: Request,
  schema: z.ZodType<T>,
  maxBytes: number = MAX_AUTH_BODY_BYTES,
): Promise<ParseJsonBodyResult<T>> {
  let text: string | null;
  try {
    text = await readBodyWithLimit(request, maxBytes);
  } catch {
    return { ok: false, reason: 'invalid_input' };
  }
  if (text === null) return { ok: false, reason: 'too_large' };

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'invalid_input' };
  }

  const result = schema.safeParse(raw);
  if (!result.success) return { ok: false, reason: 'invalid_input' };
  return { ok: true, value: result.data };
}
