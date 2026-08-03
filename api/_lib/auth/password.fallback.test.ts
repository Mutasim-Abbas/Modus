// The documented fallback path (the project plan §2): if the native @node-rs/argon2
// binding fails to LOAD for the running platform/architecture, password.ts falls back
// to node:crypto's scrypt (OWASP params) rather than crashing the whole auth surface.
//
// This is exercised for real, not merely asserted in a comment: vi.mock replaces the
// module with one whose factory throws, so password.ts's `import('@node-rs/argon2')`
// genuinely rejects, the same way it would if the native binding were missing on an
// unsupported serverless architecture.
vi.mock('@node-rs/argon2', () => {
  throw new Error('simulated: native argon2 binding unavailable on this platform');
});

describe('password.ts — scrypt fallback when argon2 cannot load', () => {
  it('hashes with the scrypt$ prefix, not argon2, and still verifies correctly', async () => {
    const { hashSecret, verifySecret } = await import('./password.js');

    const hash = await hashSecret('correct horse battery staple');
    expect(hash.startsWith('scrypt$')).toBe(true);
    expect(hash.startsWith('$argon2')).toBe(false);

    await expect(verifySecret(hash, 'correct horse battery staple')).resolves.toBe(true);
    await expect(verifySecret(hash, 'wrong password')).resolves.toBe(false);
  });

  it('getDummyHash also falls back, and still never matches a real guess', async () => {
    const { getDummyHash, verifySecret } = await import('./password.js');
    const dummy = await getDummyHash();
    expect(dummy.startsWith('scrypt$')).toBe(true);
    await expect(verifySecret(dummy, 'anything')).resolves.toBe(false);
  });

  it('an argon2-prefixed hash fails closed once the binding is unavailable, rather than crashing', async () => {
    const { verifySecret } = await import('./password.js');
    // A syntactically valid argon2id hash string (from a different run/platform) that
    // this process can no longer verify because the binding failed to load.
    const orphanedArgon2Hash =
      '$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    await expect(verifySecret(orphanedArgon2Hash, 'anything')).resolves.toBe(false);
  });
});
