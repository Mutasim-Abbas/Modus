import { isTrustedOrigin } from './origin.js';

function request(headers: Record<string, string>): Request {
  return new Request('https://fitmacro.test/api/auth/login', {
    method: 'POST',
    headers,
  });
}

describe('isTrustedOrigin', () => {
  it('trusts a matching Origin header', () => {
    expect(isTrustedOrigin(request({ origin: 'https://fitmacro.test' }))).toBe(true);
  });

  it('rejects a mismatched Origin header — the core CSRF defence', () => {
    expect(isTrustedOrigin(request({ origin: 'https://evil.example' }))).toBe(false);
  });

  it('rejects a subdomain pretending to be the same site', () => {
    expect(isTrustedOrigin(request({ origin: 'https://evil.fitmacro.test' }))).toBe(false);
  });

  it('trusts Sec-Fetch-Site: same-origin even without an Origin header', () => {
    expect(isTrustedOrigin(request({ 'sec-fetch-site': 'same-origin' }))).toBe(true);
  });

  it('trusts Sec-Fetch-Site: none (user-initiated navigation, no initiating origin)', () => {
    expect(isTrustedOrigin(request({ 'sec-fetch-site': 'none' }))).toBe(true);
  });

  it('rejects Sec-Fetch-Site: cross-site outright, even if Origin happens to match', () => {
    // Defence in depth: a network position that can set Origin but not fully impersonate
    // fetch metadata should still be rejected.
    expect(
      isTrustedOrigin(
        request({ origin: 'https://fitmacro.test', 'sec-fetch-site': 'cross-site' }),
      ),
    ).toBe(false);
  });

  it('rejects Sec-Fetch-Site: same-site (no legitimate cross-subdomain caller exists)', () => {
    expect(isTrustedOrigin(request({ 'sec-fetch-site': 'same-site' }))).toBe(false);
  });

  it('rejects a request with neither header — refuses to assume same-origin', () => {
    expect(isTrustedOrigin(request({}))).toBe(false);
  });

  it('matches on scheme+host+port, not just host', () => {
    expect(isTrustedOrigin(request({ origin: 'http://fitmacro.test' }))).toBe(false);
  });
});
