/**
 * IP hashing — "IPs are stored hashed, never raw" (the project plan P2.2 non-negotiable).
 *
 * Keyed with `SESSION_PEPPER`, the same secret and the same HMAC-SHA256 construction as
 * `sessions.token_hash` (docs/DB.md §4.3) — one pepper, one hash function, used
 * consistently everywhere something IP- or token-shaped needs to be stored without ever
 * storing the identifying value itself. Keyed (HMAC) rather than a bare hash means a
 * leaked `auth_attempts`/`sessions` table alone cannot be turned into a rainbow-table
 * lookup of real IPs, since IPv4 space is small enough to brute-force an unkeyed hash
 * trivially.
 */

import { createHmac } from 'node:crypto';

export function hashIp(ip: string, pepper: string): string {
  return createHmac('sha256', pepper).update(ip).digest('hex');
}
