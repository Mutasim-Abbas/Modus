/**
 * The one-time account-recovery code (the project plan §2 — no email service exists in v3,
 * so this is the entire account-recovery mechanism).
 *
 * Generated once at signup, shown to the user exactly once in the response body, never
 * again — the server keeps only its argon2id hash (`users.recovery_code_hash`). Every
 * successful redemption (`api/auth/recovery-redeem.ts`) rotates it: the old code is
 * consumed and a fresh one is issued and shown once, which is what makes it
 * *regenerable* without needing a separate "regenerate" endpoint — redemption already
 * requires proving possession of the current code.
 */

import { randomInt } from 'node:crypto';

// Crockford-ish alphabet with ambiguous characters removed (0/O, 1/I/L) so a code can be
// read aloud or hand-copied without guessing which glyph was meant.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const GROUPS = 4;
const GROUP_LENGTH = 4;

/**
 * `XXXX-XXXX-XXXX-XXXX` from a 33-character alphabet: ~80 bits of entropy — far beyond
 * brute-forceable even against an unthrottled endpoint, and this endpoint is throttled
 * too (api/_lib/auth/rate-limit-db.ts).
 */
export function generateRecoveryCode(): string {
  const groups: string[] = [];
  for (let g = 0; g < GROUPS; g += 1) {
    let group = '';
    for (let i = 0; i < GROUP_LENGTH; i += 1) {
      group += ALPHABET[randomInt(ALPHABET.length)];
    }
    groups.push(group);
  }
  return groups.join('-');
}

/**
 * Canonicalises user input before hashing/verifying: uppercased, dashes and whitespace
 * stripped. This is what actually gets hashed — not the dash-formatted display string —
 * so a user retyping the code without dashes, in lowercase, or with stray spaces from a
 * copy-paste still verifies correctly.
 */
export function normalizeRecoveryCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '');
}
