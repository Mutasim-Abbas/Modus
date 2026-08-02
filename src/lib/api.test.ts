import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AnalyzeError,
  MAX_IMAGE_BYTES,
  analyzeErrorMessage,
  analyzeMeal,
  estimateBase64Bytes,
  parseAnalyzeResponse,
  parseDataUrl,
} from '@/lib/api';

const VALID_BODY = {
  items: [
    { name: 'Grilled chicken', grams: 150, kcal: 248, protein: 46, carbs: 0, fat: 5, confidence: 0.8 },
  ],
  totals: { kcal: 248, protein: 46, carbs: 0, fat: 5 },
  note: 'Portion size estimated from the plate.',
};

function mockFetch(status: number, body: unknown, ok = status >= 200 && status < 300): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok,
      status,
      json: () => Promise.resolve(body),
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('analyzeMeal — request', () => {
  it('POSTs JSON to /api/analyze-meal per the contract', async () => {
    mockFetch(200, VALID_BODY);
    await analyzeMeal({ imageBase64: 'abc123', mediaType: 'image/jpeg' });

    const fetchMock = vi.mocked(fetch);
    const [url, init] = fetchMock.mock.calls[0] ?? [];

    expect(url).toBe('/api/analyze-meal');
    expect(init?.method).toBe('POST');

    const body = init?.body;
    expect(typeof body).toBe('string');
    expect(JSON.parse(body as string)).toEqual({
      imageBase64: 'abc123',
      mediaType: 'image/jpeg',
    });
  });

  it('returns the parsed items and totals on 200', async () => {
    mockFetch(200, VALID_BODY);
    const result = await analyzeMeal({ imageBase64: 'abc', mediaType: 'image/png' });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.name).toBe('Grilled chicken');
    expect(result.totals.kcal).toBe(248);
    expect(result.note).toBe('Portion size estimated from the plate.');
  });

  it('rejects an unsupported media type before hitting the network', async () => {
    vi.stubGlobal('fetch', vi.fn());
    await expect(
      analyzeMeal({ imageBase64: 'abc', mediaType: 'image/gif' as 'image/png' }),
    ).rejects.toMatchObject({ kind: 'invalid_input' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects empty image data before hitting the network', async () => {
    vi.stubGlobal('fetch', vi.fn());
    await expect(analyzeMeal({ imageBase64: '', mediaType: 'image/jpeg' })).rejects.toMatchObject({
      kind: 'invalid_input',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects an oversized image locally rather than making the user wait for a 413', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const huge = 'a'.repeat(MAX_IMAGE_BYTES * 2);

    await expect(analyzeMeal({ imageBase64: huge, mediaType: 'image/jpeg' })).rejects.toMatchObject({
      kind: 'too_large',
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('analyzeMeal — error mapping', () => {
  it('maps 503 to ai_unconfigured', async () => {
    mockFetch(503, { error: 'ai_unconfigured' });
    await expect(analyzeMeal({ imageBase64: 'a', mediaType: 'image/jpeg' })).rejects.toMatchObject({
      kind: 'ai_unconfigured',
    });
  });

  it('maps 404 (endpoint not deployed) to not_deployed', async () => {
    mockFetch(404, {});
    await expect(analyzeMeal({ imageBase64: 'a', mediaType: 'image/jpeg' })).rejects.toMatchObject({
      kind: 'not_deployed',
    });
  });

  it('maps 400 / 413 / 429 / 500 to their kinds', async () => {
    const cases = [
      [400, 'invalid_input'],
      [413, 'too_large'],
      [429, 'rate_limited'],
      [500, 'server'],
    ] as const;

    for (const [status, kind] of cases) {
      mockFetch(status, {});
      await expect(analyzeMeal({ imageBase64: 'a', mediaType: 'image/jpeg' })).rejects.toMatchObject(
        { kind },
      );
    }
  });

  it('treats a network failure as network, not as a result', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(analyzeMeal({ imageBase64: 'a', mediaType: 'image/jpeg' })).rejects.toMatchObject({
      kind: 'network',
    });
  });

  it('re-throws an AbortError so callers can distinguish cancellation', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new DOMException('The user aborted a request.', 'AbortError')),
    );
    await expect(analyzeMeal({ imageBase64: 'a', mediaType: 'image/jpeg' })).rejects.toThrow(
      DOMException,
    );
  });

  it('honours an ai_unconfigured code even on an unusual status', async () => {
    mockFetch(500, { error: 'ai_unconfigured' });
    await expect(analyzeMeal({ imageBase64: 'a', mediaType: 'image/jpeg' })).rejects.toMatchObject({
      kind: 'ai_unconfigured',
    });
  });

  it('never fabricates a result when the body is not JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.reject(new SyntaxError('Unexpected token')),
      }),
    );
    await expect(analyzeMeal({ imageBase64: 'a', mediaType: 'image/jpeg' })).rejects.toMatchObject({
      kind: 'malformed_response',
    });
  });
});

describe('AnalyzeError', () => {
  it('flags unconfigured and undeployed as feature-level unavailability', () => {
    expect(new AnalyzeError('ai_unconfigured', '').isFeatureUnavailable).toBe(true);
    expect(new AnalyzeError('not_deployed', '').isFeatureUnavailable).toBe(true);
  });

  it('does not flag transient failures as feature-level', () => {
    for (const kind of ['network', 'server', 'rate_limited', 'too_large', 'invalid_input'] as const) {
      expect(new AnalyzeError(kind, '').isFeatureUnavailable).toBe(false);
    }
  });

  it('has an honest message for every kind, none of which implies a result', () => {
    const kinds = [
      'ai_unconfigured',
      'not_deployed',
      'invalid_input',
      'too_large',
      'rate_limited',
      'network',
      'server',
      'malformed_response',
    ] as const;

    for (const kind of kinds) {
      const message = analyzeErrorMessage(new AnalyzeError(kind, ''));
      expect(message.length, kind).toBeGreaterThan(10);
    }
  });

  it('tells the user plainly that scanning is unconfigured, and points elsewhere', () => {
    const message = analyzeErrorMessage(new AnalyzeError('ai_unconfigured', ''));
    expect(message).toContain('isn’t configured');
    expect(message.toLowerCase()).toContain('food database');
  });
});

describe('parseAnalyzeResponse — the server is untrusted', () => {
  it('throws on a payload with no items array', () => {
    for (const bad of [null, {}, { items: 'nope' }, 42]) {
      expect(() => parseAnalyzeResponse(bad)).toThrow(AnalyzeError);
    }
  });

  it('drops items with no name', () => {
    const parsed = parseAnalyzeResponse({
      items: [{ name: '', kcal: 100 }, { name: 'Rice', kcal: 200 }],
    });
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0]?.name).toBe('Rice');
  });

  it('coerces negative and non-numeric macros to zero', () => {
    const parsed = parseAnalyzeResponse({
      items: [{ name: 'Odd', kcal: -50, protein: 'lots', carbs: null, fat: 3 }],
    });
    const item = parsed.items[0];
    expect(item?.kcal).toBe(0);
    expect(item?.protein).toBe(0);
    expect(item?.carbs).toBe(0);
    expect(item?.fat).toBe(3);
  });

  it('clamps confidence into 0..1 and defaults it to 0', () => {
    const parsed = parseAnalyzeResponse({
      items: [
        { name: 'A', confidence: 5 },
        { name: 'B', confidence: -1 },
        { name: 'C' },
      ],
    });
    expect(parsed.items.map((i) => i.confidence)).toEqual([1, 0, 0]);
  });

  it('recomputes totals when the server omits them', () => {
    const parsed = parseAnalyzeResponse({
      items: [
        { name: 'A', kcal: 100, protein: 10, carbs: 5, fat: 2 },
        { name: 'B', kcal: 200, protein: 20, carbs: 10, fat: 4 },
      ],
    });
    expect(parsed.totals).toEqual({ kcal: 300, protein: 30, carbs: 15, fat: 6 });
  });

  it('defaults the note to an empty string rather than inventing one', () => {
    expect(parseAnalyzeResponse({ items: [] }).note).toBe('');
  });

  it('accepts an empty items list without throwing', () => {
    expect(parseAnalyzeResponse({ items: [] }).items).toEqual([]);
  });
});

describe('estimateBase64Bytes', () => {
  it('estimates decoded size', () => {
    expect(estimateBase64Bytes('AAAA')).toBe(3);
    expect(estimateBase64Bytes('AAA=')).toBe(2);
    expect(estimateBase64Bytes('AA==')).toBe(1);
  });

  it('returns 0 for an empty string', () => {
    expect(estimateBase64Bytes('')).toBe(0);
  });
});

describe('parseDataUrl', () => {
  it('splits a supported data URL', () => {
    expect(parseDataUrl('data:image/jpeg;base64,abc123')).toEqual({
      base64: 'abc123',
      mediaType: 'image/jpeg',
    });
  });

  it('accepts png and webp', () => {
    expect(parseDataUrl('data:image/png;base64,x')?.mediaType).toBe('image/png');
    expect(parseDataUrl('data:image/webp;base64,x')?.mediaType).toBe('image/webp');
  });

  it('rejects unsupported types and malformed URLs', () => {
    for (const bad of [
      'data:image/gif;base64,abc',
      'data:application/pdf;base64,abc',
      'data:image/jpeg,notbase64',
      'https://example.com/photo.jpg',
      '',
    ]) {
      expect(parseDataUrl(bad), bad).toBeNull();
    }
  });
});
