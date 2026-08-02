import Anthropic from '@anthropic-ai/sdk';
import type { SupportedMediaType } from './validate.js';

/**
 * The Anthropic call: prompt, structured-output schema, and the clamping that turns
 * an untrusted model response into the shape docs/API.md promises.
 *
 * Nothing here ever invents a number. If the model does not give us a usable answer
 * we surface a failure; we never substitute a guess.
 */

/** Exact model string — no date suffix. Pinned in the project brief. */
const MODEL = 'claude-opus-4-8';
const MAX_TOKENS = 16_000;

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
 * Structured-output schema.
 *
 * Constraints deliberately absent: `minimum`/`maximum` are NOT supported by structured
 * outputs, so ranges are enforced by clampItem() below instead. Every object carries
 * `additionalProperties: false` and a complete `required` list, as the format demands.
 *
 * `totals` is not requested: it is derivable, and deriving it ourselves removes a whole
 * class of model arithmetic error.
 */
const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['items', 'note'],
  properties: {
    items: {
      type: 'array',
      description: 'One entry per distinct food you can see. Empty if no food is visible.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'grams', 'kcal', 'protein', 'carbs', 'fat', 'confidence'],
        properties: {
          name: { type: 'string', description: 'Short human name, e.g. "Grilled chicken breast".' },
          grams: { type: 'number', description: 'Estimated edible portion weight in grams.' },
          kcal: { type: 'number', description: 'Estimated calories for that portion.' },
          protein: { type: 'number', description: 'Grams of protein for that portion.' },
          carbs: { type: 'number', description: 'Grams of carbohydrate for that portion.' },
          fat: { type: 'number', description: 'Grams of fat for that portion.' },
          confidence: {
            type: 'number',
            description:
              'Your honest confidence from 0 to 1 for THIS item. Use low values freely when the food or portion is unclear.',
          },
        },
      },
    },
    note: {
      type: 'string',
      description:
        'What you could not tell: hidden oil or butter, unclear portion size, obscured food, ambiguous ingredients. Empty string if nothing notable.',
    },
  },
} as const;

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
- Never describe or comment on people in the photo. Only the food.`;

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

/** Pulls the JSON text out of the message. Structured output arrives as a text block. */
function extractJsonText(message: Anthropic.Message): string {
  return message.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim();
}

export interface AnalyzeMealInput {
  imageBase64: string;
  mediaType: SupportedMediaType;
  signal?: AbortSignal;
}

/**
 * Sends the photo to Claude and returns clamped, contract-shaped macros.
 *
 * The caller must have already confirmed the API key exists — this function assumes a
 * usable client and does not decide policy about missing configuration.
 *
 * @throws {AnalyzeFailure} on refusal, unusable output, or upstream error.
 */
export async function analyzeMeal(
  client: Anthropic,
  { imageBase64, mediaType, signal }: AnalyzeMealInput,
): Promise<AnalyzeMealResult> {
  let message: Anthropic.Message;

  try {
    message = await client.messages.create(
      {
        model: MODEL,
        max_tokens: MAX_TOKENS,
        // Adaptive is the only "on" mode for this model; budget_tokens 400s here.
        // temperature / top_p / top_k are omitted deliberately — they 400 on Opus 4.8.
        thinking: { type: 'adaptive' },
        output_config: {
          format: { type: 'json_schema', schema: OUTPUT_SCHEMA },
        },
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: [
              // Image first, then the instruction — vision prompts work better this way.
              {
                type: 'image',
                source: { type: 'base64', media_type: mediaType, data: imageBase64 },
              },
              { type: 'text', text: USER_PROMPT },
            ],
          },
        ],
      },
      signal ? { signal } : undefined,
    );
  } catch (cause) {
    throw toAnalyzeFailure(cause);
  }

  // The model declined. Report it; do not manufacture macros to fill the gap.
  if (message.stop_reason === 'refusal') {
    throw new AnalyzeFailure('refused', 'The model declined to analyse this image.');
  }

  // Truncated output is unparseable JSON; treat it as unusable rather than salvage it.
  if (message.stop_reason === 'max_tokens') {
    throw new AnalyzeFailure('invalid_output', 'Model output was truncated.');
  }

  const jsonText = extractJsonText(message);
  if (!jsonText) {
    throw new AnalyzeFailure('invalid_output', 'Model returned no text content.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new AnalyzeFailure('invalid_output', 'Model output was not valid JSON.');
  }

  return normalizeModelOutput(parsed);
}

/**
 * Maps a thrown value to a typed failure using the SDK's error classes.
 * Deliberately no string matching on messages — that breaks silently when copy changes.
 */
export function toAnalyzeFailure(cause: unknown): AnalyzeFailure {
  if (cause instanceof AnalyzeFailure) return cause;

  if (cause instanceof Anthropic.RateLimitError) {
    return new AnalyzeFailure('rate_limited', 'Upstream rate limit reached.');
  }

  // A present-but-rejected key means the deployment is not correctly configured.
  // Reporting it as "unconfigured" tells the user the truth (this will not work here)
  // instead of inviting them to retry something that can never succeed.
  if (
    cause instanceof Anthropic.AuthenticationError ||
    cause instanceof Anthropic.PermissionDeniedError
  ) {
    return new AnalyzeFailure('unconfigured', 'The configured API key was rejected.');
  }

  if (cause instanceof Anthropic.APIError) {
    return new AnalyzeFailure('upstream', `Upstream error (status ${String(cause.status)}).`);
  }

  return new AnalyzeFailure('upstream', 'Upstream request failed.');
}
