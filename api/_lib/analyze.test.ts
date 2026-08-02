import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import { AnalyzeFailure, analyzeMeal, normalizeModelOutput, toAnalyzeFailure } from './analyze.js';
import { PNG_BASE64 } from './fixtures.js';

/**
 * A stand-in for the SDK client. No network, no key — the real client is never
 * constructed in tests.
 */
function fakeClient(create: ReturnType<typeof vi.fn>): Anthropic {
  return { messages: { create } } as unknown as Anthropic;
}

/** A message shaped like the SDK returns for a structured-output call. */
function modelMessage(payload: unknown, stopReason = 'end_turn'): unknown {
  return {
    stop_reason: stopReason,
    content: [{ type: 'text', text: JSON.stringify(payload) }],
  };
}

/** An error that passes `instanceof` for an SDK class without its constructor args. */
function sdkError<T>(ctor: new (...args: never[]) => T): T {
  return Object.create(ctor.prototype) as T;
}

const input = { imageBase64: PNG_BASE64, mediaType: 'image/png' } as const;

describe('normalizeModelOutput', () => {
  it('passes through a well-formed response and derives totals', () => {
    const result = normalizeModelOutput({
      items: [
        { name: 'Chicken', grams: 150, kcal: 248, protein: 46, carbs: 0, fat: 5, confidence: 0.8 },
        { name: 'Rice', grams: 200, kcal: 260, protein: 5, carbs: 56, fat: 0.6, confidence: 0.6 },
      ],
      note: 'Oil not visible.',
    });

    expect(result.items).toHaveLength(2);
    // Totals are computed by us, not trusted from the model.
    expect(result.totals).toEqual({ kcal: 508, protein: 51, carbs: 56, fat: 5.6 });
    expect(result.note).toBe('Oil not visible.');
  });

  it('treats zero items as a valid answer, not an error', () => {
    const result = normalizeModelOutput({ items: [], note: 'No food in this photo.' });
    expect(result.items).toEqual([]);
    expect(result.totals).toEqual({ kcal: 0, protein: 0, carbs: 0, fat: 0 });
  });

  it('clamps negative, non-finite and absurd numbers instead of trusting them', () => {
    const result = normalizeModelOutput({
      items: [
        {
          name: 'Weird',
          grams: -50,
          kcal: Number.POSITIVE_INFINITY,
          protein: Number.NaN,
          carbs: 'lots',
          fat: 1e9,
          confidence: 7,
        },
      ],
      note: '',
    });

    const item = result.items[0];
    expect(item).toBeDefined();
    expect(item?.grams).toBe(0); // negative → 0
    // Infinity is unusable, not "very large": it becomes 0, which reads as "unknown"
    // to the user. Clamping it to MAX_KCAL would dress garbage up as a real reading.
    expect(item?.kcal).toBe(0);
    expect(item?.protein).toBe(0); // NaN → 0
    expect(item?.carbs).toBe(0); // wrong type → 0
    expect(item?.fat).toBe(2_000); // finite but absurd → clamped to MAX_MACRO_GRAMS
    expect(item?.confidence).toBe(1); // clamped into 0..1
  });

  it('clamps a large but finite number to the ceiling rather than zeroing it', () => {
    const result = normalizeModelOutput({
      items: [
        { name: 'Feast', grams: 99_999, kcal: 999_999, protein: 0, carbs: 0, fat: 0, confidence: 1 },
      ],
      note: '',
    });
    expect(result.items[0]?.grams).toBe(5_000); // MAX_GRAMS
    expect(result.items[0]?.kcal).toBe(20_000); // MAX_KCAL
  });

  it('drops unnamed items the user could never verify', () => {
    const result = normalizeModelOutput({
      items: [
        { name: '   ', grams: 10, kcal: 10, protein: 1, carbs: 1, fat: 1, confidence: 0.5 },
        { name: 'Real', grams: 10, kcal: 10, protein: 1, carbs: 1, fat: 1, confidence: 0.5 },
      ],
      note: '',
    });
    expect(result.items.map((i) => i.name)).toEqual(['Real']);
  });

  it('defaults a missing confidence to zero rather than assuming certainty', () => {
    const result = normalizeModelOutput({
      items: [{ name: 'X', grams: 1, kcal: 1, protein: 0, carbs: 0, fat: 0 }],
      note: '',
    });
    expect(result.items[0]?.confidence).toBe(0);
  });

  it('caps the item count and the note length', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({
      name: `Food ${String(i)}`,
      grams: 1,
      kcal: 1,
      protein: 0,
      carbs: 0,
      fat: 0,
      confidence: 0.5,
    }));
    const result = normalizeModelOutput({ items: many, note: 'x'.repeat(2_000) });
    expect(result.items).toHaveLength(30);
    expect(result.note).toHaveLength(500);
  });

  it.each([
    ['a non-object', 'nope'],
    ['null', null],
    ['a missing items array', { note: 'hi' }],
    ['items that is not an array', { items: 'chicken', note: '' }],
  ])('throws invalid_output for %s', (_label, raw) => {
    expect(() => normalizeModelOutput(raw)).toThrow(AnalyzeFailure);
  });
});

describe('analyzeMeal', () => {
  it('sends the request shape Opus 4.8 requires', async () => {
    const create = vi.fn().mockResolvedValue(modelMessage({ items: [], note: '' }));
    await analyzeMeal(fakeClient(create), input);

    const body = create.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(body.model).toBe('claude-opus-4-8');
    expect(body.max_tokens).toBe(16_000);
    // Adaptive is the only "on" mode; budget_tokens would 400.
    expect(body.thinking).toEqual({ type: 'adaptive' });
    expect(body).not.toHaveProperty('budget_tokens');
    // These three 400 on Opus 4.8.
    expect(body).not.toHaveProperty('temperature');
    expect(body).not.toHaveProperty('top_p');
    expect(body).not.toHaveProperty('top_k');
    // Structured outputs live under output_config, not the deprecated output_format.
    expect(body).not.toHaveProperty('output_format');
    expect(body.output_config).toMatchObject({ format: { type: 'json_schema' } });
  });

  it('puts the image block before the text block', async () => {
    const create = vi.fn().mockResolvedValue(modelMessage({ items: [], note: '' }));
    await analyzeMeal(fakeClient(create), input);

    const body = create.mock.calls[0]?.[0] as {
      messages: { content: { type: string; source?: { data: string; media_type: string } }[] }[];
    };
    const content = body.messages[0]?.content;
    expect(content?.[0]?.type).toBe('image');
    expect(content?.[0]?.source).toEqual({
      type: 'base64',
      media_type: 'image/png',
      data: PNG_BASE64,
    });
    expect(content?.[1]?.type).toBe('text');
  });

  it('returns clamped macros on the happy path', async () => {
    const create = vi.fn().mockResolvedValue(
      modelMessage({
        items: [
          { name: 'Simit', grams: 100, kcal: 310, protein: 9, carbs: 60, fat: 3, confidence: 0.7 },
        ],
        note: '',
      }),
    );

    const result = await analyzeMeal(fakeClient(create), input);
    expect(result.items[0]?.name).toBe('Simit');
    expect(result.totals.kcal).toBe(310);
  });

  it('reports a refusal instead of inventing macros', async () => {
    const create = vi.fn().mockResolvedValue(modelMessage({ items: [], note: '' }, 'refusal'));
    await expect(analyzeMeal(fakeClient(create), input)).rejects.toMatchObject({
      reason: 'refused',
    });
  });

  it('treats truncated output as unusable rather than salvaging it', async () => {
    const create = vi.fn().mockResolvedValue({
      stop_reason: 'max_tokens',
      content: [{ type: 'text', text: '{"items":[' }],
    });
    await expect(analyzeMeal(fakeClient(create), input)).rejects.toMatchObject({
      reason: 'invalid_output',
    });
  });

  it('rejects non-JSON and empty model text', async () => {
    const bad = vi.fn().mockResolvedValue({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'sorry, no JSON here' }],
    });
    await expect(analyzeMeal(fakeClient(bad), input)).rejects.toMatchObject({
      reason: 'invalid_output',
    });

    const empty = vi.fn().mockResolvedValue({ stop_reason: 'end_turn', content: [] });
    await expect(analyzeMeal(fakeClient(empty), input)).rejects.toMatchObject({
      reason: 'invalid_output',
    });
  });

  it('maps upstream SDK failures onto typed reasons', async () => {
    const rateLimited = vi.fn().mockRejectedValue(sdkError(Anthropic.RateLimitError));
    await expect(analyzeMeal(fakeClient(rateLimited), input)).rejects.toMatchObject({
      reason: 'rate_limited',
    });
  });
});

describe('toAnalyzeFailure', () => {
  it('maps rate limits, rejected keys and generic API errors distinctly', () => {
    expect(toAnalyzeFailure(sdkError(Anthropic.RateLimitError)).reason).toBe('rate_limited');
    // A present-but-rejected key is a misconfiguration, not a transient blip.
    expect(toAnalyzeFailure(sdkError(Anthropic.AuthenticationError)).reason).toBe('unconfigured');
    expect(toAnalyzeFailure(sdkError(Anthropic.PermissionDeniedError)).reason).toBe('unconfigured');
    expect(toAnalyzeFailure(sdkError(Anthropic.APIError)).reason).toBe('upstream');
  });

  it('passes an existing failure through unchanged', () => {
    const original = new AnalyzeFailure('refused', 'nope');
    expect(toAnalyzeFailure(original)).toBe(original);
  });

  it('treats an unknown throw as an upstream failure, never as success', () => {
    expect(toAnalyzeFailure(new Error('socket hang up')).reason).toBe('upstream');
    expect(toAnalyzeFailure('a string').reason).toBe('upstream');
  });
});
