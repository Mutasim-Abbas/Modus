import { getDummyHash, hashSecret, verifySecret } from './password.js';

describe('hashSecret / verifySecret — argon2id (the live path on this machine)', () => {
  it('round-trips a correct password', async () => {
    const hash = await hashSecret('correct horse battery staple');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    await expect(verifySecret(hash, 'correct horse battery staple')).resolves.toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hashSecret('correct horse battery staple');
    await expect(verifySecret(hash, 'wrong password')).resolves.toBe(false);
  });

  it('produces a different hash each time (random salt) even for the same input', async () => {
    const a = await hashSecret('same input');
    const b = await hashSecret('same input');
    expect(a).not.toBe(b);
  });

  it('never contains the plaintext secret in the stored hash', async () => {
    const secret = 'super-secret-value-xyz';
    const hash = await hashSecret(secret);
    expect(hash).not.toContain(secret);
  });
});

describe('verifySecret — fails closed on anything it does not recognise', () => {
  it('rejects an empty string', async () => {
    await expect(verifySecret('', 'anything')).resolves.toBe(false);
  });

  it('rejects a plausible-looking but bogus hash instead of throwing', async () => {
    await expect(verifySecret('not-a-real-hash-format', 'anything')).resolves.toBe(false);
  });

  it('rejects a malformed scrypt-prefixed hash instead of throwing', async () => {
    await expect(verifySecret('scrypt$not$enough$fields', 'anything')).resolves.toBe(false);
  });

  it('rejects a scrypt hash with a non-numeric cost parameter instead of throwing', async () => {
    await expect(
      verifySecret('scrypt$abc$8$1$c2FsdA==$aGFzaA==', 'anything'),
    ).resolves.toBe(false);
  });
});

describe('getDummyHash — the timing-safety fixture used by login/recovery-redeem', () => {
  it('is a valid, verifiable hash that never matches a real guess', async () => {
    const dummy = await getDummyHash();
    expect(dummy.startsWith('$argon2id$') || dummy.startsWith('scrypt$')).toBe(true);
    await expect(verifySecret(dummy, 'password123')).resolves.toBe(false);
    await expect(verifySecret(dummy, '')).resolves.toBe(false);
  });

  it('is computed once and cached — repeated calls return the identical hash', async () => {
    const a = await getDummyHash();
    const b = await getDummyHash();
    expect(a).toBe(b);
  });
});
