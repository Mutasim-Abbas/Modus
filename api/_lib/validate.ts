/**
 * Request validation. This is the security boundary — the client's checks in
 * `src/lib/api.ts` are a courtesy to save the user a round trip, nothing more.
 * Everything here treats the body as hostile input.
 */

export const SUPPORTED_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type SupportedMediaType = (typeof SUPPORTED_MEDIA_TYPES)[number];

/** Matches the client's MAX_IMAGE_BYTES. Decoded bytes, not base64 length. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * Hard ceiling on the JSON body we will even read, in base64 characters.
 * base64 inflates by 4/3, so 5 MB of image is ~6.8 MB of text; we allow a little
 * slack for the JSON envelope and reject anything beyond it without decoding.
 */
const MAX_BASE64_CHARS = Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 1024;

export interface ValidatedRequest {
  imageBytes: Buffer;
  imageBase64: string;
  mediaType: SupportedMediaType;
}

export type ValidationFailure = { ok: false; reason: 'invalid_input' | 'too_large' };
export type ValidationResult = { ok: true; value: ValidatedRequest } | ValidationFailure;

const fail = (reason: ValidationFailure['reason']): ValidationFailure => ({ ok: false, reason });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSupportedMediaType(value: unknown): value is SupportedMediaType {
  return (
    typeof value === 'string' && (SUPPORTED_MEDIA_TYPES as readonly string[]).includes(value)
  );
}

/**
 * Node's Buffer.from(s, 'base64') silently discards characters it does not recognise,
 * so it can "succeed" on data that is not base64 at all. We validate the alphabet
 * ourselves first; otherwise garbage would sail through to a paid API call.
 */
function isStrictBase64(value: string): boolean {
  if (value.length === 0 || value.length % 4 !== 0) return false;
  return /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}

/** Decoded size of a base64 string, computed from its length — no allocation. */
export function base64ByteLength(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.max(0, (base64.length / 4) * 3 - padding);
}

/**
 * Confirms the bytes really are the image type the caller declared.
 *
 * The declared media type is forwarded to the Anthropic API, so letting a caller
 * label arbitrary bytes as `image/jpeg` would mean shipping unvalidated content
 * upstream. Sniffing the magic numbers fails that fast, at our edge, for free.
 */
export function sniffMediaType(bytes: Buffer): SupportedMediaType | null {
  // JPEG: FF D8 FF
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= 8 && PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) {
    return 'image/png';
  }
  // WebP: "RIFF" .... "WEBP"
  if (
    bytes.length >= 12 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

/**
 * Validates a parsed JSON body against the `POST /api/analyze-meal` contract.
 *
 * Size is checked twice: once from the base64 length (cheap, before allocating) and
 * once on the decoded buffer (authoritative).
 */
export function validateAnalyzeRequest(body: unknown): ValidationResult {
  if (!isRecord(body)) return fail('invalid_input');

  const { imageBase64, mediaType } = body;

  if (typeof imageBase64 !== 'string' || imageBase64.length === 0) return fail('invalid_input');
  if (!isSupportedMediaType(mediaType)) return fail('invalid_input');

  // Reject oversize before decoding, so a huge payload costs us no memory.
  if (imageBase64.length > MAX_BASE64_CHARS) return fail('too_large');
  if (base64ByteLength(imageBase64) > MAX_IMAGE_BYTES) return fail('too_large');

  if (!isStrictBase64(imageBase64)) return fail('invalid_input');

  const imageBytes = Buffer.from(imageBase64, 'base64');
  if (imageBytes.byteLength === 0) return fail('invalid_input');
  if (imageBytes.byteLength > MAX_IMAGE_BYTES) return fail('too_large');

  // The declared type must match the actual bytes.
  if (sniffMediaType(imageBytes) !== mediaType) return fail('invalid_input');

  return { ok: true, value: { imageBytes, imageBase64, mediaType } };
}
