import { hashIp } from './ip.js';

describe('hashIp', () => {
  it('is a 64-char lowercase hex digest, matching auth_attempts/sessions ip_hash shape', () => {
    expect(hashIp('203.0.113.5', 'a-pepper')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('never contains the raw IP as a substring', () => {
    expect(hashIp('203.0.113.5', 'a-pepper')).not.toContain('203.0.113.5');
  });

  it('is deterministic for the same ip+pepper', () => {
    expect(hashIp('203.0.113.5', 'p')).toBe(hashIp('203.0.113.5', 'p'));
  });

  it('differs when the pepper differs', () => {
    expect(hashIp('203.0.113.5', 'p1')).not.toBe(hashIp('203.0.113.5', 'p2'));
  });

  it('differs for different IPs under the same pepper', () => {
    expect(hashIp('203.0.113.5', 'p')).not.toBe(hashIp('203.0.113.6', 'p'));
  });
});
