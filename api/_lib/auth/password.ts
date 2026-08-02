/**
 * Password / recovery-code secret hashing.
 *
 * Primary: **argon2id** via `@node-rs/argon2`, OWASP parameters (`m=19456` KiB, `t=2`,
 * `p=1`). This is a prebuilt native binding — smoke-tested directly on this Windows dev
 * machine (`node -e` against `@node-rs/argon2`, real hash + verify round trip) and
 * expected to work identically on Vercel's linux-x64 Node runtime, which is exactly the
 * platform `@node-rs/argon2` ships prebuilt binaries for — no compile step either place.
 *
 * Documented fallback: **`node:crypto.scrypt`** (OWASP's scrypt recommendation: N=2^17,
 * r=8, p=1), used ONLY if the native argon2 binding fails to *load* for the running
 * platform/architecture — this is a genuine runtime fallback, not a hypothetical: the
 * import is attempted lazily and the failure is caught, not assumed away.
 *
 * Both algorithms are self-describing in the stored hash string (argon2's own
 * `$argon2id$...` prefix; a hand-rolled `scrypt$N$r$p$salt$hash` prefix for the
 * fallback), so `verifySecret` always dispatches on what actually produced a given row
 * — a fleet that hashed some rows with argon2id and later fell back to scrypt (or vice
 * versa, if the binding becomes available again) verifies every row correctly.
 */

import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';

interface ScryptOptions {
  N: number;
  r: number;
  p: number;
  maxmem: number;
}

/**
 * Hand-wrapped rather than `util.promisify(scrypt)`: `scrypt`'s TS overloads (with vs.
 * without an `options` object) do not survive `promisify`'s inference, which silently
 * collapses to the 3-argument overload. This keeps the `options` argument typed.
 */
function scryptAsync(password: string, salt: Buffer, keylen: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolvePromise, reject) => {
    scryptCallback(password, salt, keylen, options, (err, derivedKey) => {
      if (err) reject(err);
      else resolvePromise(derivedKey);
    });
  });
}

/** OWASP-recommended argon2id parameters (docs/PLAN.md §2). */
const ARGON2_OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

/** OWASP-recommended scrypt parameters. N=2^17 needs >32MB of V8's default scrypt maxmem. */
const SCRYPT_N = 2 ** 17;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 32;
const SCRYPT_MAXMEM = 256 * 1024 * 1024;
const SCRYPT_PREFIX = 'scrypt';

type Argon2Module = typeof import('@node-rs/argon2');

// Attempted once per process (cold start), then cached — a failed load never retries on
// every request, and a successful load is reused for the life of the instance.
let argon2ModulePromise: Promise<Argon2Module | null> | null = null;

function loadArgon2(): Promise<Argon2Module | null> {
  argon2ModulePromise ??= import('@node-rs/argon2').then(
    (mod) => mod,
    (cause: unknown) => {
      // Never log the secret being hashed — only that the binding itself failed to load.
      console.error('password: @node-rs/argon2 failed to load; falling back to scrypt', {
        name: cause instanceof Error ? cause.name : typeof cause,
      });
      return null;
    },
  );
  return argon2ModulePromise;
}

async function hashWithScrypt(plain: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scryptAsync(plain, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM,
  });
  return [
    SCRYPT_PREFIX,
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString('base64'),
    derived.toString('base64'),
  ].join('$');
}

async function verifyWithScrypt(stored: string, plain: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== SCRYPT_PREFIX) return false;
  const [, nRaw, rRaw, pRaw, saltB64, hashB64] = parts;
  const N = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  if (N <= 0 || r <= 0 || p <= 0) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(saltB64 ?? '', 'base64');
    expected = Buffer.from(hashB64 ?? '', 'base64');
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;

  try {
    const derived = await scryptAsync(plain, salt, expected.length, {
      N,
      r,
      p,
      maxmem: SCRYPT_MAXMEM,
    });
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    // A malformed/adversarial stored hash (e.g. absurd N) must fail closed, not throw
    // out of an auth handler.
    return false;
  }
}

/** Hashes a password or recovery code. Never throws on a well-formed string input. */
export async function hashSecret(plain: string): Promise<string> {
  const argon2 = await loadArgon2();
  if (argon2) {
    // No explicit `algorithm` option: Argon2id is the library's own documented default
    // ("Default value, this is the default algorithm for normative recommendations" —
    // node_modules/@node-rs/argon2/index.d.ts). Referencing its `Algorithm` const enum
    // by value is disallowed under `isolatedModules` across a dynamic `import()`
    // boundary, so relying on the documented default avoids that entirely rather than
    // working around it.
    return argon2.hash(plain, ARGON2_OPTIONS);
  }
  return hashWithScrypt(plain);
}

/**
 * Verifies a password or recovery code against its stored hash, dispatching on the
 * hash's own prefix. Fails closed (`false`) on any malformed or unrecognised hash
 * rather than throwing — a corrupt row must never crash an auth request.
 */
export async function verifySecret(storedHash: string, plain: string): Promise<boolean> {
  if (storedHash.startsWith('$argon2')) {
    const argon2 = await loadArgon2();
    if (!argon2) {
      // The row was hashed with argon2 but the binding is unavailable right now. Fail
      // closed rather than guess — this is a deployment problem to fix, not a login
      // this request can safely allow or safely deny by chance.
      return false;
    }
    try {
      return await argon2.verify(storedHash, plain);
    } catch {
      return false;
    }
  }
  if (storedHash.startsWith(`${SCRYPT_PREFIX}$`)) {
    return verifyWithScrypt(storedHash, plain);
  }
  return false;
}

// Lazily computed once per process and reused — gives every "user not found" login
// attempt a verify() call of the same cost and shape as a real one, without re-hashing
// a fresh dummy value on every miss.
let dummyHashPromise: Promise<string> | null = null;

/**
 * A syntactically valid hash that no real password will ever match. Used so that a
 * login against a non-existent email still pays the full hashing cost, on the same
 * code path, as a login against a real one — see api/auth/login.ts.
 */
export function getDummyHash(): Promise<string> {
  dummyHashPromise ??= hashSecret(`fitmacro-timing-safety-dummy-${randomBytes(24).toString('hex')}`);
  return dummyHashPromise;
}
