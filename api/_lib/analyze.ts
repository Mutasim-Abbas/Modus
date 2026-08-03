import type { SupportedMediaType } from './validate.js';

/**
 * The vision call: prompt, output shape, and the clamping that turns an untrusted model
 * response into the shape docs/API.md promises.
 *
 * Nothing here ever invents a number. If the model does not give us a usable answer
 * we surface a failure; we never substitute a guess.
 *
 * Provider: Groq, via its OpenAI-compatible `/chat/completions` endpoint, called with
 * plain `fetch`. No SDK: the request is a single JSON POST, and adding a dependency to
 * build one object is not worth the supply-chain surface (the client half of this app
 * ships zero new dependencies for the same reason).
 */

/** Groq's vision model. Their catalogue moves; this is pinned deliberately. */
const MODEL = 'qwen/qwen3.6-27b';
const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const MAX_TOKENS = 8_192;

/** Guards against absurd output. Not nutrition science — just sanity bounds. */
const MAX_ITEMS = 30;
const MAX_GRAMS = 5_000;
const MAX_KCAL = 20_000;
const MAX_MACRO_GRAMS = 2_000;
const MAX_NOTE_CHARS = 500;

export interface AnalyzedItem {
  name: string;
  grams: number;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  confidence: number;
}

export interface Macros {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface AnalyzeMealResult {
  items: AnalyzedItem[];
  totals: Macros;
  note: string;
}

/** Why an analysis could not be completed. Maps to a status in the handler. */
export type AnalyzeFailureReason =
  /** The model declined to answer. Never fabricate macros in its place. */
  | 'refused'
  /** The model returned something we cannot trust (truncated / unparseable). */
  | 'invalid_output'
  /** Upstream rejected or failed. */
  | 'upstream'
  /** Upstream rate limited us. */
  | 'rate_limited'
  /** The configured key is not usable (401/403) — the feature is not truly configured. */
  | 'unconfigured';

export class AnalyzeFailure extends Error {
  readonly reason: AnalyzeFailureReason;

  constructor(reason: AnalyzeFailureReason, message: string) {
    super(message);
    this.name = 'AnalyzeFailure';
    this.reason = reason;
  }
}

/**
 * The JSON shape we ask for.
 *
 * Requested via `response_format: { type: 'json_object' }` plus this shape spelled out in
 * the system prompt, rather than a provider-specific `json_schema` mode: the model is
 * untrusted input either way, and `normalizeModelOutput` below already validates and
 * clamps every field. Relying on the weaker, universally-supported mode means a model
 * swap cannot silently break the contract.
 *
 * `totals` is not requested: it is derivable, and deriving it ourselves removes a whole
 * class of model arithmetic error.
 */
const OUTPUT_SHAPE = `{
  "items": [
    {
      "name": "string, short human name, e.g. \\"Grilled chicken breast\\"",
      "grams": number,
      "kcal": number,
      "protein": number,
      "carbs": number,
      "fat": number,
      "confidence": number between 0 and 1
    }
  ],
  "note": "string"
}`;

const SYSTEM_PROMPT = `You estimate the nutritional content of food from photographs.

Your estimates are shown to the user as EDITABLE ESTIMATES which they confirm or correct before anything is saved. They are never presented as fact. Being honestly uncertain is more useful than being confidently wrong.

Rules:
- Identify each distinct food in the photo. Give one item per food, not one per ingredient of a mixed dish (a sandwich is one item unless the components are clearly separable).
- Estimate the edible portion in grams, using visible reference objects (plate, cutlery, hands) for scale.
- Give kcal, protein, carbs and fat for THAT portion — not per 100 g.
- Keep macros roughly consistent with the calories (protein 4 kcal/g, carbs 4 kcal/g, fat 9 kcal/g). Small deviations are fine; large ones mean you should re-check.
- Set "confidence" honestly per item, from 0 to 1. Use below 0.5 when the food or its portion is genuinely unclear. Do not inflate it. A low confidence is a useful, correct answer.
- Prefer saying you are unsure over inventing precision. Round numbers are fine — do not imply accuracy you do not have.
- Use "note" to state plainly what you could not tell: cooking oil or butter you cannot see, portions hidden behind other food, sauces of unknown composition, packaging you cannot read.
- If the image contains NO food, return an empty items array and say so in the note. That is a correct, successful answer — do not invent a meal.
- Never describe or comment on people in the photo. Only the food.

Reply with JSON only, matching exactly this shape, with no commentary outside the JSON:
${OUTPUT_SHAPE}`;

const USER_PROMPT = `Estimate the macros in this meal photo. Identify each food, estimate its portion in grams, and give per-item kcal/protein/carbs/fat plus your honest confidence. Use the note to say what you could not tell. If there is no food in the image, return an empty items array.`;

/* ------------------------------------------------------------------ *
 * Normalisation — the model response is untrusted input               *
 * ------------------------------------------------------------------ */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Finite, non-negative, bounded, rounded to `decimals`. Anything else becomes 0. */
function clampNumber(value: unknown, max: number, decimals = 0): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  const bounded = Math.min(max, Math.max(0, value));
  const factor = 10 ** decimals;
  return Math.round(bounded * factor) / factor;
}

function clampItem(value: unknown): AnalyzedItem | null {
  if (!isRecord(value)) return null;

  const name = typeof value.name === 'string' ? value.name.trim().slice(0, 120) : '';
  // An unnamed item is not something we can show or let the user verify.
  if (!name) return null;

  const confidence =
    typeof value.confidence === 'number' && Number.isFinite(value.confidence)
      ? Math.min(1, Math.max(0, Math.round(value.confidence * 100) / 100))
      : 0;

  return {
    name,
    grams: clampNumber(value.grams, MAX_GRAMS),
    kcal: clampNumber(value.kcal, MAX_KCAL),
    protein: clampNumber(value.protein, MAX_MACRO_GRAMS, 1),
    carbs: clampNumber(value.carbs, MAX_MACRO_GRAMS, 1),
    fat: clampNumber(value.fat, MAX_MACRO_GRAMS, 1),
    confidence,
  };
}

function sumTotals(items: readonly AnalyzedItem[]): Macros {
  const totals = items.reduce<Macros>(
    (total, item) => ({
      kcal: total.kcal + item.kcal,
      protein: total.protein + item.protein,
      carbs: total.carbs + item.carbs,
      fat: total.fat + item.fat,
    }),
    { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  );

  return {
    kcal: Math.round(totals.kcal),
    protein: Math.round(totals.protein * 10) / 10,
    carbs: Math.round(totals.carbs * 10) / 10,
    fat: Math.round(totals.fat * 10) / 10,
  };
}

/** Turns raw model JSON into the response contract. Throws if it is unusable. */
export function normalizeModelOutput(raw: unknown): AnalyzeMealResult {
  if (!isRecord(raw) || !Array.isArray(raw.items)) {
    throw new AnalyzeFailure('invalid_output', 'Model output had no items array.');
  }

  const items = raw.items
    .slice(0, MAX_ITEMS)
    .map(clampItem)
    .filter((item): item is AnalyzedItem => item !== null);

  const note = typeof raw.note === 'string' ? raw.note.trim().slice(0, MAX_NOTE_CHARS) : '';

  return { items, totals: sumTotals(items), note };
}

/**
 * Some models wrap JSON in a ```json fence despite being asked not to. Stripping it is
 * cheap and deterministic; failing the whole scan over punctuation would not be.
 */
export function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  return trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();
}

/* ------------------------------------------------------------------ *
 * The client                                                          *
 * ------------------------------------------------------------------ */

/**
 * A deliberately tiny client. `fetchImpl` is injectable so every test drives real handler
 * code against a fake transport instead of the network.
 */
export interface GroqClient {
  readonly apiKey: string;
  readonly fetchImpl: typeof fetch;
}

export function createGroqClient(apiKey: string, fetchImpl: typeof fetch = fetch): GroqClient {
  return { apiKey, fetchImpl };
}

export interface AnalyzeMealInput {
  imageBase64: string;
  mediaType: SupportedMediaType;
  signal?: AbortSignal;
}

/** Pulls the assistant's text out of an OpenAI-shaped chat completion. */
function extractContent(payload: unknown): { text: string; truncated: boolean } {
  if (!isRecord(payload) || !Array.isArray(payload.choices) || payload.choices.length === 0) {
    return { text: '', truncated: false };
  }
  const choice: unknown = payload.choices[0];
  if (!isRecord(choice)) return { text: '', truncated: false };

  const truncated = choice.finish_reason === 'length';
  const message = isRecord(choice.message) ? choice.message : null;
  const content = message && typeof message.content === 'string' ? message.content : '';

  return { text: content, truncated };
}

/**
 * Sends the photo to Groq and returns clamped, contract-shaped macros.
 *
 * The caller must have already confirmed the API key exists — this function assumes a
 * usable client and does not decide policy about missing configuration.
 *
 * @throws {AnalyzeFailure} on refusal, unusable output, or upstream error.
 */
export async function analyzeMeal(
  client: GroqClient,
  { imageBase64, mediaType, signal }: AnalyzeMealInput,
): Promise<AnalyzeMealResult> {
  const body = {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    // Low but not zero: estimation benefits from a little flexibility, and a fully
    // greedy decode makes the model repeat one confident wrong answer.
    temperature: 0.2,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          // Image first, then the instruction — vision prompts work better this way.
          {
            type: 'image_url',
            image_url: { url: `data:${mediaType};base64,${imageBase64}` },
          },
          { type: 'text', text: USER_PROMPT },
        ],
      },
    ],
  };

  let response: Response;
  try {
    response = await client.fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${client.apiKey}`,
      },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });
  } catch (cause) {
    // An abort is the caller giving up, not an upstream fault — let it propagate.
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    // An already-typed failure keeps its reason: re-wrapping it as `upstream` would
    // downgrade a precise diagnosis into a generic one.
    if (cause instanceof AnalyzeFailure) throw cause;
    throw new AnalyzeFailure('upstream', 'Upstream request failed.');
  }

  if (!response.ok) throw failureForStatus(response.status);

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new AnalyzeFailure('invalid_output', 'Upstream response was not valid JSON.');
  }

  const { text, truncated } = extractContent(payload);

  // Truncated output is unparseable JSON; treat it as unusable rather than salvage it.
  if (truncated) {
    throw new AnalyzeFailure('invalid_output', 'Model output was truncated.');
  }
  if (!text.trim()) {
    throw new AnalyzeFailure('invalid_output', 'Model returned no text content.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(text));
  } catch {
    throw new AnalyzeFailure('invalid_output', 'Model output was not valid JSON.');
  }

  return normalizeModelOutput(parsed);
}

/**
 * Maps an upstream HTTP status onto a typed failure.
 *
 * Status-based, never string matching on messages — that breaks silently when the
 * provider changes its copy.
 */
export function failureForStatus(status: number): AnalyzeFailure {
  if (status === 429) {
    return new AnalyzeFailure('rate_limited', 'Upstream rate limit reached.');
  }

  // A present-but-rejected key means the deployment is not correctly configured.
  // Reporting it as "unconfigured" tells the user the truth (this will not work here)
  // instead of inviting them to retry something that can never succeed.
  if (status === 401 || status === 403) {
    return new AnalyzeFailure('unconfigured', 'The configured API key was rejected.');
  }

  return new AnalyzeFailure('upstream', `Upstream error (status ${String(status)}).`);
}

/** Maps a thrown value to a typed failure. */
export function toAnalyzeFailure(cause: unknown): AnalyzeFailure {
  if (cause instanceof AnalyzeFailure) return cause;
  return new AnalyzeFailure('upstream', 'Upstream request failed.');
}
