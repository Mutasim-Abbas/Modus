import type { AnalyzedItem, AnalyzeMealResponse, Macros } from '@/types';

/**
 * Typed client for POST /api/analyze-meal.
 *
 * The endpoint is implemented separately as a Vercel serverless function; the API key
 * lives only in its process.env and never reaches this bundle. This module knows the
 * contract in docs/API.md and nothing else.
 *
 * Every failure mode is represented explicitly. The client never invents a result:
 * if the server cannot analyse the photo, the caller gets an error to show, not a guess.
 */

export const SUPPORTED_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type SupportedMediaType = (typeof SUPPORTED_MEDIA_TYPES)[number];

/** Server rejects above ~5 MB; we check first so the user is not made to wait for a 413. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export type AnalyzeErrorKind =
  /** No API key configured on this deployment (503). Scanning is genuinely unavailable. */
  | 'ai_unconfigured'
  /** Endpoint not deployed at all (404) — treated the same as unconfigured in the UI. */
  | 'not_deployed'
  | 'invalid_input'
  | 'too_large'
  | 'rate_limited'
  | 'network'
  | 'server'
  | 'malformed_response';

export class AnalyzeError extends Error {
  readonly kind: AnalyzeErrorKind;

  constructor(kind: AnalyzeErrorKind, message: string) {
    super(message);
    this.name = 'AnalyzeError';
    this.kind = kind;
  }

  /** True when the feature itself is unavailable, rather than this one attempt failing. */
  get isFeatureUnavailable(): boolean {
    return this.kind === 'ai_unconfigured' || this.kind === 'not_deployed';
  }
}

/** User-facing copy. Honest about what happened; never implies a result exists. */
export function analyzeErrorMessage(error: AnalyzeError): string {
  switch (error.kind) {
    case 'ai_unconfigured':
    case 'not_deployed':
      return 'AI scanning isn’t configured on this deployment. Everything else works — log your meal from the food database instead.';
    case 'invalid_input':
      return 'That image couldn’t be read. Try a JPEG, PNG or WebP photo.';
    case 'too_large':
      return 'That photo is too large. Please use an image under 5 MB.';
    case 'rate_limited':
      return 'Too many scans right now. Wait a moment and try again.';
    case 'network':
      return 'Couldn’t reach the server. Check your connection — scanning needs to be online.';
    case 'malformed_response':
      return 'The server sent back something unexpected. Nothing was logged.';
    case 'server':
      return 'The scan failed on the server. Nothing was logged — you can add the meal manually.';
  }
}

/* ------------------------------------------------------------------ *
 * Response validation — the server response is untrusted input        *
 * ------------------------------------------------------------------ */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
}

function parseItem(value: unknown): AnalyzedItem | null {
  if (!isRecord(value)) return null;
  const name = typeof value.name === 'string' ? value.name.trim() : '';
  if (!name) return null;

  const confidence =
    typeof value.confidence === 'number' && Number.isFinite(value.confidence)
      ? Math.min(1, Math.max(0, value.confidence))
      : 0;

  return {
    name,
    grams: toNumber(value.grams),
    kcal: toNumber(value.kcal),
    protein: toNumber(value.protein),
    carbs: toNumber(value.carbs),
    fat: toNumber(value.fat),
    confidence,
  };
}

function parseTotals(value: unknown, items: readonly AnalyzedItem[]): Macros {
  if (isRecord(value)) {
    return {
      kcal: toNumber(value.kcal),
      protein: toNumber(value.protein),
      carbs: toNumber(value.carbs),
      fat: toNumber(value.fat),
    };
  }
  // Totals are derivable from the items; recompute rather than fail the whole scan.
  return items.reduce<Macros>(
    (total, item) => ({
      kcal: total.kcal + item.kcal,
      protein: total.protein + item.protein,
      carbs: total.carbs + item.carbs,
      fat: total.fat + item.fat,
    }),
    { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  );
}

export function parseAnalyzeResponse(payload: unknown): AnalyzeMealResponse {
  if (!isRecord(payload) || !Array.isArray(payload.items)) {
    throw new AnalyzeError('malformed_response', 'Response did not contain an items array.');
  }

  const items = payload.items
    .map(parseItem)
    .filter((item): item is AnalyzedItem => item !== null);

  return {
    items,
    totals: parseTotals(payload.totals, items),
    note: typeof payload.note === 'string' ? payload.note : '',
  };
}

function errorForStatus(status: number, body: unknown): AnalyzeError {
  const code = isRecord(body) && typeof body.error === 'string' ? body.error : '';

  if (status === 503 || code === 'ai_unconfigured') {
    return new AnalyzeError('ai_unconfigured', 'AI scanning is not configured on this deployment.');
  }
  if (status === 404) {
    return new AnalyzeError('not_deployed', 'The analyze-meal endpoint is not deployed.');
  }
  if (status === 413) return new AnalyzeError('too_large', 'Image exceeds the size limit.');
  if (status === 429) return new AnalyzeError('rate_limited', 'Rate limited by the server.');
  if (status === 400) return new AnalyzeError('invalid_input', 'The server rejected the image.');
  return new AnalyzeError('server', `Server returned ${status}.`);
}

export interface AnalyzeMealRequest {
  /** Raw base64, no `data:` prefix — see docs/API.md. */
  imageBase64: string;
  mediaType: SupportedMediaType;
  signal?: AbortSignal;
}

/**
 * POSTs an image for macro estimation.
 * @throws {AnalyzeError} for every failure path — callers should catch and branch on `kind`.
 */
export async function analyzeMeal({
  imageBase64,
  mediaType,
  signal,
}: AnalyzeMealRequest): Promise<AnalyzeMealResponse> {
  if (!imageBase64) {
    throw new AnalyzeError('invalid_input', 'No image data provided.');
  }
  if (!SUPPORTED_MEDIA_TYPES.includes(mediaType)) {
    throw new AnalyzeError('invalid_input', `Unsupported media type: ${mediaType}`);
  }
  if (estimateBase64Bytes(imageBase64) > MAX_IMAGE_BYTES) {
    throw new AnalyzeError('too_large', 'Image exceeds the 5 MB limit.');
  }

  let response: Response;
  try {
    response = await fetch('/api/analyze-meal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64, mediaType }),
      ...(signal ? { signal } : {}),
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new AnalyzeError('network', 'Network request failed.');
  }

  let body: unknown = null;
  try {
    body = (await response.json()) as unknown;
  } catch {
    if (response.ok) {
      throw new AnalyzeError('malformed_response', 'Response was not valid JSON.');
    }
  }

  if (!response.ok) throw errorForStatus(response.status, body);

  return parseAnalyzeResponse(body);
}

/** Byte length of a base64 payload, without decoding it. */
export function estimateBase64Bytes(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

/** Splits a data URL into the parts the API expects. Returns null if it isn't a supported image. */
export function parseDataUrl(
  dataUrl: string,
): { base64: string; mediaType: SupportedMediaType } | null {
  const match = /^data:([^;,]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;

  const [, mediaType, base64] = match;
  if (!mediaType || !base64) return null;
  if (!SUPPORTED_MEDIA_TYPES.includes(mediaType as SupportedMediaType)) return null;

  return { base64, mediaType: mediaType as SupportedMediaType };
}

/** Reads a File into a data URL. Rejects with AnalyzeError so callers have one error type. */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new AnalyzeError('invalid_input', 'Could not read that file.'));
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new AnalyzeError('invalid_input', 'Could not read that file.'));
      }
    };
    reader.readAsDataURL(file);
  });
}
