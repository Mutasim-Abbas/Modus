import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHandler } from './analyze-meal.js';
import { RateLimiter } from './_lib/rate-limit.js';
import { AnalyzeFailure, createGroqClient } from './_lib/analyze.js';
import { GIF_BASE64, PNG_BASE64 } from './_lib/fixtures.js';

/**
 * Handler tests. `createHandler` takes its dependencies by injection, so the upstream
 * `fetch` is always a fake and no request ever leaves the process.
 */

const VALID_BODY = { imageBase64: PNG_BASE64, mediaType: 'image/png' };

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('https://fitmacro.test/api/analyze-meal', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

/** An OpenAI-compatible chat completion carrying `text` as the assistant message. */
function completion(text: string, finishReason = 'stop'): Response {
  return {
    ok: true,
    status: 200,
    json: () =>
      Promise.resolve({
        choices: [{ finish_reason: finishReason, message: { content: text } }],
      }),
  } as Response;
}

/** Deps whose upstream returns a fixed model payload. `create` is the fake fetch. */
function depsReturning(payload: unknown) {
  const create = vi.fn().mockResolvedValue(completion(JSON.stringify(payload)));
  return {
    deps: {
      createClient: (apiKey: string) => createGroqClient(apiKey, create as unknown as typeof fetch),
      limiter: new RateLimiter(),
    },
    create,
  };
}

/** Deps whose upstream returns a given HTTP status, for failure-mapping tests. */
function depsFailingWith(status: number) {
  const create = vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: () => Promise.resolve({ error: { message: 'nope' } }),
  } as Response);
  return {
    createClient: (apiKey: string) => createGroqClient(apiKey, create as unknown as typeof fetch),
    limiter: new RateLimiter(),
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the 503 contract — the app must ship before the key exists', () => {
  it('returns 503 ai_unconfigured when the key is unset', async () => {
    vi.stubEnv('GROQ_API_KEY', '');
    const { deps, create } = depsReturning({ items: [], note: '' });

    const response = await createHandler(deps)(post(VALID_BODY));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: 'ai_unconfigured' });
    // It must not reach the model — an unconfigured deploy costs nothing.
    expect(create).not.toHaveBeenCalled();
  });

  it('treats a whitespace-only key as unset rather than calling with junk', async () => {
    vi.stubEnv('GROQ_API_KEY', '   ');
    const { deps, create } = depsReturning({ items: [], note: '' });

    const response = await createHandler(deps)(post(VALID_BODY));

    expect(response.status).toBe(503);
    expect(create).not.toHaveBeenCalled();
  });

  it('answers 503 without reading the body, so a bad body cannot mask it', async () => {
    vi.stubEnv('GROQ_API_KEY', '');
    const { deps } = depsReturning({ items: [], note: '' });

    // Unparseable body + no key: the key check wins, because it runs first.
    const response = await createHandler(deps)(post('not json at all'));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: 'ai_unconfigured' });
  });

  it('never fabricates a result when unconfigured', async () => {
    vi.stubEnv('GROQ_API_KEY', '');
    const { deps } = depsReturning({ items: [], note: '' });

    const body = (await createHandler(deps)(post(VALID_BODY)).then((r) => r.json())) as unknown;
    expect(body).not.toHaveProperty('items');
    expect(body).not.toHaveProperty('totals');
  });
});

describe('request handling', () => {
  it('rejects a non-POST method with 405 and an Allow header', async () => {
    vi.stubEnv('GROQ_API_KEY', 'sk-test');
    const { deps } = depsReturning({ items: [], note: '' });

    const response = await createHandler(deps)(
      new Request('https://fitmacro.test/api/analyze-meal', { method: 'GET' }),
    );

    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('POST');
  });

  it('returns 400 for an unparseable body', async () => {
    vi.stubEnv('GROQ_API_KEY', 'sk-test');
    const { deps } = depsReturning({ items: [], note: '' });

    const response = await createHandler(deps)(post('{{{'));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'invalid_input' });
  });

  it('returns 400 for an unsupported media type', async () => {
    vi.stubEnv('GROQ_API_KEY', 'sk-test');
    const { deps, create } = depsReturning({ items: [], note: '' });

    const response = await createHandler(deps)(
      post({ imageBase64: GIF_BASE64, mediaType: 'image/gif' }),
    );

    expect(response.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it('returns 400 when the bytes do not match the declared type', async () => {
    vi.stubEnv('GROQ_API_KEY', 'sk-test');
    const { deps, create } = depsReturning({ items: [], note: '' });

    // A PNG claiming to be a JPEG must never be forwarded upstream.
    const response = await createHandler(deps)(
      post({ imageBase64: PNG_BASE64, mediaType: 'image/jpeg' }),
    );

    expect(response.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it('returns 413 for an oversize image', async () => {
    vi.stubEnv('GROQ_API_KEY', 'sk-test');
    const { deps, create } = depsReturning({ items: [], note: '' });

    const response = await createHandler(deps)(
      post({ imageBase64: 'A'.repeat(12_000_000), mediaType: 'image/png' }),
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({ error: 'too_large' });
    expect(create).not.toHaveBeenCalled();
  });

  it('returns 429 with Retry-After once the per-IP budget is spent', async () => {
    vi.stubEnv('GROQ_API_KEY', 'sk-test');
    const create = vi.fn().mockResolvedValue(completion(JSON.stringify({ items: [], note: '' })));
    const handler = createHandler({
      createClient: (apiKey: string) => createGroqClient(apiKey, create as unknown as typeof fetch),
      limiter: new RateLimiter(2, 60_000),
    });
    const headers = { 'x-vercel-forwarded-for': '9.9.9.9' };

    expect((await handler(post(VALID_BODY, headers))).status).toBe(200);
    expect((await handler(post(VALID_BODY, headers))).status).toBe(200);

    const blocked = await handler(post(VALID_BODY, headers));
    expect(blocked.status).toBe(429);
    await expect(blocked.json()).resolves.toEqual({ error: 'rate_limited' });
    expect(blocked.headers.get('Retry-After')).toBeTruthy();
    // The blocked request must not have cost an API call.
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('rate-limits per IP, not globally', async () => {
    vi.stubEnv('GROQ_API_KEY', 'sk-test');
    const { deps } = depsReturning({ items: [], note: '' });
    const handler = createHandler({ ...deps, limiter: new RateLimiter(1, 60_000) });

    expect((await handler(post(VALID_BODY, { 'x-real-ip': '1.1.1.1' }))).status).toBe(200);
    expect((await handler(post(VALID_BODY, { 'x-real-ip': '1.1.1.1' }))).status).toBe(429);
    // A different caller still gets through.
    expect((await handler(post(VALID_BODY, { 'x-real-ip': '2.2.2.2' }))).status).toBe(200);
  });
});

describe('success and failure mapping', () => {
  it('returns 200 with contract-shaped macros and never echoes the image', async () => {
    vi.stubEnv('GROQ_API_KEY', 'sk-test');
    const { deps } = depsReturning({
      items: [
        { name: 'Ayran', grams: 200, kcal: 74, protein: 4, carbs: 6, fat: 3, confidence: 0.9 },
      ],
      note: 'Portion estimated from the glass.',
    });

    const response = await createHandler(deps)(post(VALID_BODY));
    expect(response.status).toBe(200);

    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toEqual({
      items: [
        { name: 'Ayran', grams: 200, kcal: 74, protein: 4, carbs: 6, fat: 3, confidence: 0.9 },
      ],
      totals: { kcal: 74, protein: 4, carbs: 6, fat: 3 },
      note: 'Portion estimated from the glass.',
    });
    // The uploaded image is never reflected back to the caller.
    expect(JSON.stringify(body)).not.toContain(PNG_BASE64);
  });

  it('returns 200 with zero items when there is no food — not an error', async () => {
    vi.stubEnv('GROQ_API_KEY', 'sk-test');
    const { deps } = depsReturning({ items: [], note: 'No food visible.' });

    const response = await createHandler(deps)(post(VALID_BODY));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ items: [], note: 'No food visible.' });
  });

  it('maps a refusal to 422, not to a fabricated meal', async () => {
    vi.stubEnv('GROQ_API_KEY', 'sk-test');
    // Groq has no distinct "refusal" stop reason the way the previous provider did, so
    // the failure is raised directly here. The mapping under test is the handler's
    // (refused -> 422 analysis_refused), which is unchanged and still reachable.
    const create = vi.fn().mockImplementation(() => {
      throw new AnalyzeFailure('refused', 'declined');
    });

    const response = await createHandler({
      createClient: (apiKey: string) => createGroqClient(apiKey, create as unknown as typeof fetch),
      limiter: new RateLimiter(),
    })(post(VALID_BODY));

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({ error: 'analysis_refused' });
  });

  it('maps unusable model output to 502 — never 503, which would disable the feature', async () => {
    vi.stubEnv('GROQ_API_KEY', 'sk-test');
    const create = vi.fn().mockResolvedValue(completion('garbage, not json'));

    const response = await createHandler({
      createClient: (apiKey: string) => createGroqClient(apiKey, create as unknown as typeof fetch),
      limiter: new RateLimiter(),
    })(post(VALID_BODY));

    // A transient upstream problem must not tell the client "this feature does not exist".
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: 'upstream_error' });
  });

  it('maps a rejected key to 503, so the client stops offering a scan that cannot work', async () => {
    vi.stubEnv('GROQ_API_KEY', 'gsk-wrong');

    const response = await createHandler(depsFailingWith(401))(post(VALID_BODY));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: 'ai_unconfigured' });
  });

  it('maps an upstream rate limit to 429, not to a fabricated meal', async () => {
    vi.stubEnv('GROQ_API_KEY', 'gsk-test');

    const response = await createHandler(depsFailingWith(429))(post(VALID_BODY));

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({ error: 'rate_limited' });
  });

  it('never leaks the API key or a stack trace to the client', async () => {
    vi.stubEnv('GROQ_API_KEY', 'sk-secret-do-not-leak');
    const create = vi.fn().mockRejectedValue(new Error('boom at /internal/path.js:42'));

    const response = await createHandler({
      createClient: (apiKey: string) => createGroqClient(apiKey, create as unknown as typeof fetch),
      limiter: new RateLimiter(),
    })(post(VALID_BODY));

    const text = await response.text();
    expect(text).not.toContain('sk-secret-do-not-leak');
    expect(text).not.toContain('/internal/path.js');
  });
});
