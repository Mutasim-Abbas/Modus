import { analyzeMeal, AnalyzeFailure, createGroqClient, type GroqClient } from './_lib/analyze.js';
import { errorResponse, jsonResponse } from './_lib/http.js';
import { clientIpFrom, RateLimiter } from './_lib/rate-limit.js';
import { validateAnalyzeRequest } from './_lib/validate.js';

/**
 * POST /api/analyze-meal — photo in, estimated macros out.
 *
 * The contract lives in docs/API.md and the client (src/lib/api.ts) is already built
 * against it; this function serves that contract exactly.
 *
 * The single most important behaviour: when GROQ_API_KEY is unset this returns
 * 503 { error: "ai_unconfigured" }. It never throws, never 500s and never fabricates
 * a result — the app ships before the key exists and stays fully usable without it.
 */

/**
 * Give the model room to think and respond without the platform killing us mid-flight.
 * vercel.json allows 60s; we bail at 50s so the failure is ours to shape.
 */
const REQUEST_TIMEOUT_MS = 50_000;

export interface Handlerdeps {
  /** Injectable so tests never construct a real client or touch the network. */
  createClient: (apiKey: string) => GroqClient;
  limiter: RateLimiter;
}

const defaultDeps: Handlerdeps = {
  createClient: (apiKey) => createGroqClient(apiKey),
  // Module scope: survives across invocations that reuse this instance. See rate-limit.ts
  // for the honest limits of that.
  limiter: new RateLimiter(),
};

/** Reads the key without ever logging or returning it. Empty/whitespace counts as unset. */
function readApiKey(): string | null {
  const key = process.env.GROQ_API_KEY?.trim();
  return key ? key : null;
}

/**
 * A signal that aborts on timeout, or when the caller disconnects.
 *
 * Built from AbortController rather than `AbortSignal.timeout`/`AbortSignal.any`: those
 * are missing in some runtimes (jsdom, where this file's tests run), and a helper that
 * throws on construction would surface as an opaque 500 instead of the timeout it is.
 *
 * `cancel()` must run on every path, or a pending timer keeps the invocation alive.
 */
function timeoutSignal(
  requestSignal: AbortSignal | null,
  ms: number,
): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new DOMException('Upstream timed out.', 'TimeoutError'));
  }, ms);

  const onAbort = (): void => {
    controller.abort(requestSignal?.reason as unknown);
  };

  if (requestSignal) {
    if (requestSignal.aborted) onAbort();
    else requestSignal.addEventListener('abort', onAbort, { once: true });
  }

  return {
    signal: controller.signal,
    cancel: () => {
      clearTimeout(timer);
      requestSignal?.removeEventListener('abort', onAbort);
    },
  };
}

/** Maps a typed analysis failure onto the contract's status codes. */
function responseForFailure(failure: AnalyzeFailure): Response {
  switch (failure.reason) {
    case 'rate_limited':
      return errorResponse('rate_limited', 429);
    case 'unconfigured':
      // A rejected key is a misconfigured deployment, not a transient blip: tell the
      // user the feature is unavailable rather than inviting a pointless retry.
      return errorResponse('ai_unconfigured', 503);
    case 'refused':
      // Honest failure. The client shows "the scan failed, nothing was logged".
      return errorResponse('analysis_refused', 422);
    case 'invalid_output':
    case 'upstream':
      // Never 503 here: that would tell the client the feature does not exist and
      // disable scanning for the whole session over a transient upstream error.
      return errorResponse('upstream_error', 502);
  }
}

export function createHandler(deps: Handlerdeps = defaultDeps) {
  return async function handler(request: Request): Promise<Response> {
    try {
      if (request.method !== 'POST') {
        return errorResponse('method_not_allowed', 405, { Allow: 'POST' });
      }

      // Before anything else that could fail. An unconfigured deployment answers
      // honestly and cheaply, without reading the body or calling anything.
      const apiKey = readApiKey();
      if (!apiKey) {
        return errorResponse('ai_unconfigured', 503);
      }

      const decision = deps.limiter.check(clientIpFrom(request.headers));
      if (!decision.allowed) {
        return errorResponse('rate_limited', 429, {
          'Retry-After': String(decision.retryAfterSeconds),
        });
      }

      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return errorResponse('invalid_input', 400);
      }

      const validation = validateAnalyzeRequest(body);
      if (!validation.ok) {
        return errorResponse(validation.reason, validation.reason === 'too_large' ? 413 : 400);
      }

      const { imageBase64, mediaType } = validation.value;
      const client = deps.createClient(apiKey);

      // The SDK used to own this timeout; with a plain fetch it has to be explicit, or a
      // hung upstream would burn the whole platform budget and return a generic gateway
      // error we do not control. Combined with the request's own signal so a client that
      // disconnects still aborts the upstream call.
      const { signal, cancel } = timeoutSignal(request.signal ?? null, REQUEST_TIMEOUT_MS);

      let result;
      try {
        result = await analyzeMeal(client, { imageBase64, mediaType, signal });
      } finally {
        cancel();
      }

      // Note: the image is never echoed back.
      return jsonResponse(result, 200);
    } catch (cause) {
      if (cause instanceof AnalyzeFailure) {
        return responseForFailure(cause);
      }

      // Last line of defence. Log for ourselves; the client gets a bare code, never a
      // stack trace or an upstream message.
      console.error('analyze-meal: unhandled error', {
        name: cause instanceof Error ? cause.name : typeof cause,
      });
      return errorResponse('server_error', 500);
    }
  };
}

const handler = createHandler();

/**
 * Vercel's Web Standard `fetch` export (Node runtime). One entry point for every
 * method, so non-POST gets our own 405 body instead of a platform-generated page.
 */
export default { fetch: handler };
