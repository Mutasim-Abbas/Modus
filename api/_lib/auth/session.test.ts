import {
  clearSessionCookieHeader,
  generateSessionToken,
  hashSessionToken,
  readSessionCookie,
  SESSION_COOKIE_NAME,
  setSessionCookieHeader,
} from './session.js';

describe('generateSessionToken', () => {
  it('produces 256 bits (32 bytes) of randomness, base64url-encoded', () => {
    const token = generateSessionToken();
    // 32 raw bytes -> 43 base64url characters (no padding).
    expect(token).toHaveLength(43);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('never repeats across calls', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => generateSessionToken()));
    expect(tokens.size).toBe(200);
  });
});

describe('hashSessionToken', () => {
  it('is a 64-char lowercase hex digest, matching sessions.token_hash\'s DB check', () => {
    const hash = hashSessionToken('some-token', 'a-pepper');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic for the same token+pepper', () => {
    expect(hashSessionToken('tok', 'pepper')).toBe(hashSessionToken('tok', 'pepper'));
  });

  it('differs when the pepper differs — a leaked token hash alone is not enough', () => {
    expect(hashSessionToken('tok', 'pepper-a')).not.toBe(hashSessionToken('tok', 'pepper-b'));
  });

  it('never contains the raw token as a substring', () => {
    const token = generateSessionToken();
    expect(hashSessionToken(token, 'pepper')).not.toContain(token);
  });
});

describe('cookie serialization — __Host- prefix requirements', () => {
  it('sets HttpOnly, Secure, SameSite=Lax, Path=/, and no Domain attribute', () => {
    const header = setSessionCookieHeader('tok123', 3600);
    expect(header.startsWith(`${SESSION_COOKIE_NAME}=`)).toBe(true);
    expect(header).toContain('HttpOnly');
    expect(header).toContain('Secure');
    expect(header).toContain('SameSite=Lax');
    expect(header).toContain('Path=/');
    expect(header).not.toContain('Domain=');
    expect(header).toContain('Max-Age=3600');
  });

  it('clamps a negative Max-Age to 0 rather than emitting a negative value', () => {
    const header = setSessionCookieHeader('tok', -50);
    expect(header).toContain('Max-Age=0');
  });

  it('clearSessionCookieHeader expires immediately with the same security flags', () => {
    const header = clearSessionCookieHeader();
    expect(header).toContain('Max-Age=0');
    expect(header).toContain('HttpOnly');
    expect(header).toContain('Secure');
    expect(header).toContain('SameSite=Lax');
  });
});

describe('readSessionCookie', () => {
  function requestWithCookie(cookie: string | null): Request {
    const headers = new Headers();
    if (cookie !== null) headers.set('cookie', cookie);
    return new Request('https://fitmacro.test/api/auth/me', { headers });
  }

  it('reads the token back out of a Set-Cookie-shaped header', () => {
    const token = generateSessionToken();
    const request = requestWithCookie(`${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`);
    expect(readSessionCookie(request)).toBe(token);
  });

  it('finds the cookie among several others', () => {
    const token = 'the-real-token';
    const request = requestWithCookie(`foo=bar; ${SESSION_COOKIE_NAME}=${token}; baz=qux`);
    expect(readSessionCookie(request)).toBe(token);
  });

  it('returns null when there is no cookie header at all', () => {
    expect(readSessionCookie(requestWithCookie(null))).toBeNull();
  });

  it('returns null when the cookie header does not contain our cookie', () => {
    expect(readSessionCookie(requestWithCookie('other=value'))).toBeNull();
  });

  it('returns null for an empty cookie value rather than an empty-string token', () => {
    expect(readSessionCookie(requestWithCookie(`${SESSION_COOKIE_NAME}=`))).toBeNull();
  });

  it('never throws on a garbage cookie header', () => {
    expect(() => readSessionCookie(requestWithCookie('%%%not-valid-encoding%%%'))).not.toThrow();
    expect(readSessionCookie(requestWithCookie(`${SESSION_COOKIE_NAME}=%`))).toBeNull();
  });
});
