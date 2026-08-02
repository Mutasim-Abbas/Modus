import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AuthError,
  authErrorMessage,
  changePassword,
  deleteAccount,
  login,
  logout,
  logoutAll,
  me,
  recoveryRedeem,
  signup,
} from '@/lib/authApi';

function mockFetch(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
  ok = status >= 200 && status < 300,
): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok,
      status,
      headers: new Headers(headers),
      json: () => Promise.resolve(body),
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('every auth call sends credentials: same-origin and never touches storage', () => {
  it('signup sends credentials: same-origin, JSON body, and never writes to localStorage/sessionStorage', async () => {
    const localSetItem = vi.spyOn(Storage.prototype, 'setItem');
    mockFetch(201, {
      user: { id: 'u1', email: 'a@b.com', emailVerified: false, createdAt: '2026-01-01T00:00:00.000Z' },
      recoveryCode: 'ABCD-EFGH-JKMN-PQRS',
    });

    await signup('a@b.com', 'password123');

    const [url, init] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(url).toBe('/api/auth/signup');
    expect(init?.credentials).toBe('same-origin');
    expect(JSON.parse(init?.body as string)).toEqual({ email: 'a@b.com', password: 'password123' });

    // The session lives only in the HttpOnly cookie — this module has no reason to ever
    // call setItem on either storage, for any key.
    expect(localSetItem).not.toHaveBeenCalled();
  });

  it('every endpoint sends credentials: same-origin', async () => {
    const user = { id: 'u1', email: 'a@b.com', emailVerified: false, createdAt: '2026-01-01T00:00:00.000Z' };

    mockFetch(200, { user });
    await login('a@b.com', 'password123');
    expect(vi.mocked(fetch).mock.calls[0]?.[1]?.credentials).toBe('same-origin');

    mockFetch(200, { ok: true });
    await logout();
    expect(vi.mocked(fetch).mock.calls[0]?.[1]?.credentials).toBe('same-origin');

    mockFetch(200, { ok: true });
    await logoutAll();
    expect(vi.mocked(fetch).mock.calls[0]?.[1]?.credentials).toBe('same-origin');

    mockFetch(200, { user });
    await changePassword('old12345', 'new12345');
    expect(vi.mocked(fetch).mock.calls[0]?.[1]?.credentials).toBe('same-origin');

    mockFetch(200, { ok: true });
    await deleteAccount('password123');
    expect(vi.mocked(fetch).mock.calls[0]?.[1]?.credentials).toBe('same-origin');

    mockFetch(200, { user, recoveryCode: 'NEW1-CODE-SHOW-NCE1' });
    await recoveryRedeem('a@b.com', 'OLD1-CODE', 'new12345');
    expect(vi.mocked(fetch).mock.calls[0]?.[1]?.credentials).toBe('same-origin');

    mockFetch(200, { user });
    await me();
    expect(vi.mocked(fetch).mock.calls[0]?.[1]?.credentials).toBe('same-origin');
  });
});

describe('signup', () => {
  it('returns the user and the one-time recovery code on 201', async () => {
    mockFetch(201, {
      user: { id: 'u1', email: 'a@b.com', emailVerified: false, createdAt: '2026-01-01T00:00:00.000Z' },
      recoveryCode: 'ABCD-EFGH-JKMN-PQRS',
    });
    const result = await signup('a@b.com', 'password123');
    expect(result.user.email).toBe('a@b.com');
    expect(result.recoveryCode).toBe('ABCD-EFGH-JKMN-PQRS');
  });

  it('maps 409 email_taken', async () => {
    mockFetch(409, { error: 'email_taken' });
    await expect(signup('a@b.com', 'password123')).rejects.toMatchObject({ kind: 'email_taken' });
  });

  it('throws malformed_response if the recovery code is missing', async () => {
    mockFetch(201, { user: { id: 'u1', email: 'a@b.com', emailVerified: false, createdAt: '' } });
    await expect(signup('a@b.com', 'password123')).rejects.toMatchObject({ kind: 'malformed_response' });
  });
});

describe('login — error branches', () => {
  it('maps 401 invalid_credentials identically for a bad password or a non-existent email', async () => {
    mockFetch(401, { error: 'invalid_credentials' });
    await expect(login('nobody@example.com', 'wrong')).rejects.toMatchObject({ kind: 'invalid_credentials' });
  });

  it('maps 429 rate_limited and carries Retry-After as seconds', async () => {
    mockFetch(429, { error: 'rate_limited' }, { 'Retry-After': '272' });
    const error = await login('a@b.com', 'x').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AuthError);
    expect((error as AuthError).kind).toBe('rate_limited');
    expect((error as AuthError).retryAfterSeconds).toBe(272);
  });

  it('treats a network failure as network, not as a result', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(login('a@b.com', 'x')).rejects.toMatchObject({ kind: 'network' });
  });

  it('maps 503 to sync_unconfigured, flagged as isUnconfigured', async () => {
    mockFetch(503, { error: 'sync_unconfigured' });
    const error = await login('a@b.com', 'x').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AuthError);
    expect((error as AuthError).isUnconfigured).toBe(true);
  });

  it('maps 403 origin_rejected and 400 invalid_input', async () => {
    mockFetch(403, { error: 'origin_rejected' });
    await expect(login('a@b.com', 'x')).rejects.toMatchObject({ kind: 'origin_rejected' });

    mockFetch(400, { error: 'invalid_input' });
    await expect(login('a@b.com', 'x')).rejects.toMatchObject({ kind: 'invalid_input' });
  });

  it('never fabricates a user when the body is not JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.reject(new SyntaxError('Unexpected token')),
      }),
    );
    await expect(login('a@b.com', 'x')).rejects.toMatchObject({ kind: 'malformed_response' });
  });
});

describe('changePassword / deleteAccount — error branches', () => {
  it('maps a wrong current password to invalid_credentials', async () => {
    mockFetch(401, { error: 'invalid_credentials' });
    await expect(changePassword('wrong', 'new12345')).rejects.toMatchObject({ kind: 'invalid_credentials' });
  });

  it('maps no/expired session to unauthorized', async () => {
    mockFetch(401, { error: 'unauthorized' });
    await expect(changePassword('a', 'b')).rejects.toMatchObject({ kind: 'unauthorized' });

    mockFetch(401, { error: 'unauthorized' });
    await expect(deleteAccount('password123')).rejects.toMatchObject({ kind: 'unauthorized' });
  });

  it('maps a wrong account password on delete to invalid_credentials', async () => {
    mockFetch(401, { error: 'invalid_credentials' });
    await expect(deleteAccount('wrong')).rejects.toMatchObject({ kind: 'invalid_credentials' });
  });

  it('deleteAccount resolves with no result on success', async () => {
    mockFetch(200, { ok: true });
    await expect(deleteAccount('password123')).resolves.toBeUndefined();
  });
});

describe('recoveryRedeem', () => {
  it('returns the user and a brand-new recovery code on success', async () => {
    mockFetch(200, {
      user: { id: 'u1', email: 'a@b.com', emailVerified: false, createdAt: '2026-01-01T00:00:00.000Z' },
      recoveryCode: 'NEW1-CODE-SHOW-NCE1',
    });
    const result = await recoveryRedeem('a@b.com', 'OLD1-CODE-HERE', 'new12345');
    expect(result.recoveryCode).toBe('NEW1-CODE-SHOW-NCE1');
  });

  it('maps 401 recovery_invalid identically for a wrong code or a non-existent email', async () => {
    mockFetch(401, { error: 'recovery_invalid' });
    await expect(recoveryRedeem('a@b.com', 'WRONG-CODE', 'new12345')).rejects.toMatchObject({
      kind: 'recovery_invalid',
    });
  });

  it('maps 429 rate_limited for recovery attempts too', async () => {
    mockFetch(429, { error: 'rate_limited' }, { 'Retry-After': '3600' });
    await expect(recoveryRedeem('a@b.com', 'x', 'new12345')).rejects.toMatchObject({
      kind: 'rate_limited',
      retryAfterSeconds: 3600,
    });
  });
});

describe('me', () => {
  it('resolves the user when signed in', async () => {
    mockFetch(200, { user: { id: 'u1', email: 'a@b.com', emailVerified: false, createdAt: '' } });
    const user = await me();
    expect(user.email).toBe('a@b.com');
  });

  it('rejects with unauthorized when signed out', async () => {
    mockFetch(401, { error: 'unauthorized' });
    await expect(me()).rejects.toMatchObject({ kind: 'unauthorized' });
  });

  it('rejects with sync_unconfigured when the deployment has no database', async () => {
    mockFetch(503, { error: 'sync_unconfigured' });
    await expect(me()).rejects.toMatchObject({ kind: 'sync_unconfigured' });
  });
});

describe('authErrorMessage', () => {
  it('has an honest, non-empty message for every kind', () => {
    const kinds = [
      'sync_unconfigured',
      'invalid_input',
      'too_large',
      'origin_rejected',
      'method_not_allowed',
      'rate_limited',
      'invalid_credentials',
      'email_taken',
      'unauthorized',
      'recovery_invalid',
      'network',
      'server',
      'malformed_response',
    ] as const;

    for (const kind of kinds) {
      const message = authErrorMessage(new AuthError(kind, ''));
      expect(message.length, kind).toBeGreaterThan(5);
    }
  });

  it('gives login/recovery the identical, enumeration-safe wording docs/DESIGN.md requires', () => {
    expect(authErrorMessage(new AuthError('invalid_credentials', ''))).toBe(
      "That email and password don't match.",
    );
    expect(authErrorMessage(new AuthError('recovery_invalid', ''))).toBe(
      "That email and recovery code don't match.",
    );
  });
});
