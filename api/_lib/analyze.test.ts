import { describe, expect, it, vi } from 'vitest';
import {
  AnalyzeFailure,
  analyzeMeal,
  createGroqClient,
  failureForStatus,
  normalizeModelOutput,
  stripCodeFence,
  toAnalyzeFailure,
} from './analyze.js';
import { PNG_BASE64 } from './fixtures.js';

/**
 * Provider: Groq's OpenAI-compatible endpoint, called with plain `fetch`. Every test
 * injects a fake `fetch`, so the real network is never touched and no key exists.
 *
 * The `normalizeModelOutput` block below is unchanged from the Anthropic implementation
 * on purpose: it is provider-agnostic, it is the layer that makes an untrusted model
 * response safe, and a provider swap is exactly when you want that coverage untouched.
 */

/** A response shaped like an OpenAI-compatible chat completion. */
function chatResponse(payload: unknown, finishReason = 'stop'): Response {
  return jsonOk({
    choices: [{ finish_reason: finishReason, message: { content: JSON.stringify(payload) } }],
  });
}

/** A completion whose text content is supplied verbatim (for fence/garbage cases). */
function rawResponse(text: string, finishReason = 'stop'): Response {
  return jsonOk({ choices: [{ finish_reason: finishReason, message: { content: text } }] });
}

function jsonOk(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  } as Response;
}

function jsonStatus(status: number): Response {
  return {
    ok: false,
    status,
    json: () => Promise.resolve({ error: { message: 'upstream said no' } }),
  } as Response;
}

function clientWith(fetchImpl: ReturnType<typeof vi.fn>) {
  return createGroqClient('test-key-never-real', fetchImpl as unknown as typeof fetch);
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

describe('stripCodeFence', () => {
  it('unwraps a ```json fence a model added despite being told not to', () => {
    expect(stripCodeFence('```json\n{"items":[]}\n```')).toBe('{"items":[]}');
    expect(stripCodeFence('```\n{"items":[]}\n```')).toBe('{"items":[]}');
  });

  it('leaves bare JSON untouched', () => {
    expect(stripCodeFence('  {"items":[]}  ')).toBe('{"items":[]}');
  });
});

describe('analyzeMeal', () => {
  it('sends the request shape Groq requires', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(chatResponse({ items: [], note: '' }));
    await analyzeMeal(clientWith(fetchImpl), input);

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(init.method).toBe('POST');

    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.model).toBe('qwen/qwen3.6-27b');
    // Must stay well under Groq's free-tier 8000 TPM ceiling, which counts prompt and
    // max_tokens together. Raising this breaks every scan with a 413.
    expect(body.max_tokens).toBe(2_000);
    expect(body.max_tokens as number).toBeLessThan(5_000);
    // json_object, not a provider-specific json_schema mode: see the note in analyze.ts.
    expect(body.response_format).toEqual({ type: 'json_object' });
  });

  it('sends the key as a bearer token and nowhere else', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(chatResponse({ items: [], note: '' }));
    await analyzeMeal(clientWith(fetchImpl), input);

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer test-key-never-real');
    // The key must never leak into the URL, where it would land in logs and referrers.
    expect(url).not.toContain('test-key-never-real');
    expect(String(init.body)).not.toContain('test-key-never-real');
  });

  it('puts the image before the text, as a data URL', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(chatResponse({ items: [], note: '' }));
    await analyzeMeal(clientWith(fetchImpl), input);

    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(init.body)) as {
      messages: { role: string; content: unknown }[];
    };

    expect(body.messages[0]?.role).toBe('system');
    const content = body.messages[1]?.content as {
      type: string;
      image_url?: { url: string };
    }[];
    expect(content[0]?.type).toBe('image_url');
    expect(content[0]?.image_url?.url).toBe(`data:image/png;base64,${PNG_BASE64}`);
    expect(content[1]?.type).toBe('text');
  });

  it('returns clamped macros on the happy path', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      chatResponse({
        items: [
          { name: 'Simit', grams: 100, kcal: 310, protein: 9, carbs: 60, fat: 3, confidence: 0.7 },
        ],
        note: '',
      }),
    );

    const result = await analyzeMeal(clientWith(fetchImpl), input);
    expect(result.items[0]?.name).toBe('Simit');
    expect(result.totals.kcal).toBe(310);
  });

  it('parses a fenced response rather than failing the whole scan over punctuation', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(rawResponse('```json\n{"items":[],"note":"none"}\n```'));
    const result = await analyzeMeal(clientWith(fetchImpl), input);
    expect(result.note).toBe('none');
  });

  it('treats truncated output as unusable rather than salvaging it', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(rawResponse('{"items":[', 'length'));
    await expect(analyzeMeal(clientWith(fetchImpl), input)).rejects.toMatchObject({
      reason: 'invalid_output',
    });
  });

  it('rejects non-JSON and empty model text', async () => {
    const bad = vi.fn().mockResolvedValue(rawResponse('sorry, no JSON here'));
    await expect(analyzeMeal(clientWith(bad), input)).rejects.toMatchObject({
      reason: 'invalid_output',
    });

    const empty = vi.fn().mockResolvedValue(rawResponse('   '));
    await expect(analyzeMeal(clientWith(empty), input)).rejects.toMatchObject({
      reason: 'invalid_output',
    });

    const noChoices = vi.fn().mockResolvedValue(jsonOk({ choices: [] }));
    await expect(analyzeMeal(clientWith(noChoices), input)).rejects.toMatchObject({
      reason: 'invalid_output',
    });
  });

  it.each([
    [429, 'rate_limited'],
    // Groq returns 413 when a request would blow the per-minute token budget. It is a
    // rate limit, not a malformed request, and must not read as a generic failure.
    [413, 'rate_limited'],
    [401, 'unconfigured'],
    [403, 'unconfigured'],
    [500, 'upstream'],
    [400, 'upstream'],
  ])('maps upstream status %i onto reason %s', async (status, reason) => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonStatus(status));
    await expect(analyzeMeal(clientWith(fetchImpl), input)).rejects.toMatchObject({ reason });
  });

  it('treats a network throw as upstream, never as success', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    await expect(analyzeMeal(clientWith(fetchImpl), input)).rejects.toMatchObject({
      reason: 'upstream',
    });
  });

  it('lets an abort propagate instead of reporting it as an upstream fault', async () => {
    const abort = new DOMException('aborted', 'AbortError');
    const fetchImpl = vi.fn().mockRejectedValue(abort);
    await expect(analyzeMeal(clientWith(fetchImpl), input)).rejects.toBe(abort);
  });

  it('forwards the abort signal to fetch so a hung call can be cancelled', async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn().mockResolvedValue(chatResponse({ items: [], note: '' }));
    await analyzeMeal(clientWith(fetchImpl), { ...input, signal: controller.signal });

    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect(init.signal).toBe(controller.signal);
  });
});

describe('failureForStatus / toAnalyzeFailure', () => {
  it('maps rate limits, rejected keys and generic errors distinctly', () => {
    expect(failureForStatus(429).reason).toBe('rate_limited');
    // A present-but-rejected key is a misconfiguration, not a transient blip.
    expect(failureForStatus(401).reason).toBe('unconfigured');
    expect(failureForStatus(403).reason).toBe('unconfigured');
    expect(failureForStatus(502).reason).toBe('upstream');
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
