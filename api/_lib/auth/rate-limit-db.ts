/**
 * Postgres-backed rate limiting — the durable replacement for `api/_lib/rate-limit.ts`
 * for anything security-relevant (the project plan §2). That in-memory limiter is honest
 * about living in one serverless instance's memory and resetting on every cold start;
 * fine as a courtesy brake on the scan button, not fine for login brute force. This one
 * counts real rows in `auth_attempts`, which survives a cold start because it survives
 * in Postgres.
 *
 * Two independent counters per action — per-IP and per-account — checked together by
 * the caller (the project plan P2.2). `key` is the hashed IP for `scope: 'ip'` and the
 * lowercased email **as submitted** (whether or not it is a real account) for
 * `scope: 'account'` — see docs/DB.md §4.3 for why that must not depend on account
 * existence.
 *
 * SECURITY — read before changing anything here (the internal security audit F-01, F-05):
 *
 * 1. **Reserve, then decide — never check, work, then record.** The original shape was
 *    `SELECT count` -> `await verifySecret()` (50-200 ms of argon2id) -> `INSERT`. Nothing
 *    made those three steps atomic, and the slowest step sat in the middle, so every
 *    concurrent request read a count that did not yet include any request in flight. That
 *    bounded sequential attempts only: 20 simultaneous wrong-password logins against a
 *    cap of 8 produced 20 x 401 and 0 x 429 (measured). `reserveAttempt` below replaces it
 *    with ONE statement that counts and inserts together, so an attempt is durably
 *    recorded before it is ever allowed to proceed, and the window shrinks from "a
 *    network round trip plus a password hash" to "the execution of a single statement,
 *    server-side".
 *
 * 2. **The account bucket counts failures only.** `auth_attempts.success` exists exactly
 *    so a user's own successful sign-ins cannot lock them out of their own account
 *    (docs/DB.md §4.3 anticipated this and P2.2 did not take the option). The row is
 *    inserted as a provisional failure and flipped by `markAttemptSucceeded` once the
 *    credential actually verifies, which is what makes the gate atomic *and* the accounting
 *    honest. The IP bucket deliberately still counts every attempt: it is a velocity brake
 *    on one source, not a per-account lockout.
 *
 * 3. **A rejected attempt is not recorded.** Being rate-limited must not extend your own
 *    window, or a determined attacker could hold a victim locked out with a single request
 *    per window forever.
 */

import { and, eq, gt, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { authAttempts } from '../db/schema.js';

export type RateLimitScope = 'ip' | 'account';
export type RateLimitAction = 'login' | 'signup' | 'password_change' | 'recovery_redeem';

export interface RateLimitRule {
  windowMs: number;
  maxAttempts: number;
}

/**
 * Thresholds per action. Login and recovery redemption are the highest-value brute-force
 * targets, so their per-account windows are the tightest; per-IP windows stay generous
 * to avoid punishing a shared IP (NAT, campus network) for one bad actor on it.
 */
export const RATE_LIMIT_RULES: Record<
  RateLimitAction,
  { ip: RateLimitRule; account: RateLimitRule }
> = {
  login: {
    ip: { windowMs: 15 * 60_000, maxAttempts: 20 },
    account: { windowMs: 15 * 60_000, maxAttempts: 8 },
  },
  signup: {
    ip: { windowMs: 60 * 60_000, maxAttempts: 10 },
    account: { windowMs: 60 * 60_000, maxAttempts: 5 },
  },
  password_change: {
    ip: { windowMs: 60 * 60_000, maxAttempts: 30 },
    account: { windowMs: 60 * 60_000, maxAttempts: 10 },
  },
  recovery_redeem: {
    ip: { windowMs: 60 * 60_000, maxAttempts: 20 },
    account: { windowMs: 60 * 60_000, maxAttempts: 5 },
  },
};

/** `true` once `rule.maxAttempts` attempts already exist in the current window. */
export async function isRateLimited(
  db: Db,
  params: {
    key: string;
    scope: RateLimitScope;
    action: RateLimitAction;
    rule: RateLimitRule;
    now?: Date;
  },
): Promise<boolean> {
  const now = params.now ?? new Date();
  const since = new Date(now.getTime() - params.rule.windowMs);

  const rows = await db
    .select({ id: authAttempts.id })
    .from(authAttempts)
    .where(
      and(
        eq(authAttempts.key, params.key),
        eq(authAttempts.scope, params.scope),
        eq(authAttempts.action, params.action),
        gt(authAttempts.createdAt, since),
        // Account lockouts count failures only — see note 2 in this file's header.
        params.scope === 'account' ? eq(authAttempts.success, false) : undefined,
      ),
    )
    // Bounded: we only need to know whether the count has reached the threshold.
    .limit(params.rule.maxAttempts);

  return rows.length >= params.rule.maxAttempts;
}

export async function recordAttempt(
  db: Db,
  params: { key: string; scope: RateLimitScope; action: RateLimitAction; success: boolean },
): Promise<void> {
  await db.insert(authAttempts).values({
    key: params.key,
    scope: params.scope,
    action: params.action,
    success: params.success,
  });
}

export interface ReservedAttempt {
  /** `true` when the window is already full: the caller must answer 429 and do no work. */
  limited: boolean;
  /** The `auth_attempts.id` this attempt reserved, or `null` when it was rejected. */
  attemptId: string | null;
}

/**
 * Different drivers hand `db.execute()` back differently — `neon-http` and `pglite` both
 * return `{ rows }`, a raw pg driver returns an array. Normalised here rather than typed
 * against one driver, because `Db` is deliberately the driver-agnostic base class.
 */
function resultRows(result: unknown): { id: string }[] {
  if (Array.isArray(result)) return result as { id: string }[];
  if (typeof result === 'object' && result !== null) {
    const rows = (result as { rows?: unknown }).rows;
    if (Array.isArray(rows)) return rows as { id: string }[];
  }
  return [];
}

/**
 * Counts the current window and records this attempt **in one statement**, returning the
 * new row's id, or nothing at all if the window is already full.
 *
 * This is the whole brute-force control. Writing it as a single
 * `INSERT ... SELECT ... WHERE (count) < limit RETURNING id` is what makes it safe under
 * concurrency: there is no client-visible gap between deciding and recording, so an
 * attacker cannot open N connections and have all N read the same stale count while a
 * password hash runs. See note 1 in this file's header for the measurement that motivated
 * it, and the internal security audit F-01 for the residual (READ COMMITTED still admits a small
 * same-instant burst; removing that entirely needs a transaction-capable driver, which
 * `neon-http` is not).
 *
 * Every interpolation below is a bound parameter via drizzle's `sql` template — no value
 * is ever concatenated into the statement text.
 */
export async function reserveAttempt(
  db: Db,
  params: {
    key: string;
    scope: RateLimitScope;
    action: RateLimitAction;
    rule: RateLimitRule;
    now?: Date;
  },
): Promise<ReservedAttempt> {
  const now = params.now ?? new Date();
  const since = new Date(now.getTime() - params.rule.windowMs).toISOString();
  const failuresOnly =
    params.scope === 'account' ? sql` and "success" = false` : sql``;

  const result = await db.execute(sql`
    insert into "auth_attempts" ("key", "scope", "action", "success")
    select
      ${params.key}::text,
      ${params.scope}::"auth_attempt_scope",
      ${params.action}::"auth_attempt_action",
      false
    where (
      select count(*) from "auth_attempts"
      where "key" = ${params.key}::text
        and "scope" = ${params.scope}::"auth_attempt_scope"
        and "action" = ${params.action}::"auth_attempt_action"
        and "created_at" > ${since}::timestamptz${failuresOnly}
    ) < ${params.rule.maxAttempts}
    returning "id"
  `);

  const rows = resultRows(result);
  const inserted = rows[0];
  return inserted ? { limited: false, attemptId: inserted.id } : { limited: true, attemptId: null };
}

/**
 * Flips a reserved attempt from its provisional `success = false` to `true`. For the
 * account bucket (which counts failures only) this is what stops a user's own successful
 * sign-ins from counting toward their own lockout; for the IP bucket it is pure
 * bookkeeping, since that bucket counts every attempt either way.
 */
export async function markAttemptSucceeded(db: Db, attemptId: string | null): Promise<void> {
  if (!attemptId) return;
  await db.update(authAttempts).set({ success: true }).where(eq(authAttempts.id, attemptId));
}

/**
 * The two-bucket gate every `api/auth/*` mutating route uses: reserve against the per-IP
 * and per-account windows together, and report whether the request may proceed.
 *
 * Both are reserved even when one is already full — deliberately. An attempt that is
 * refused by the account bucket still consumed a request from that IP, and letting it
 * escape the IP counter would hand an attacker a free channel for volume.
 */
export async function reserveAttemptPair(
  db: Db,
  params: {
    ipKey: string;
    accountKey: string;
    action: RateLimitAction;
    now?: Date;
  },
): Promise<{ limited: boolean; ip: ReservedAttempt; account: ReservedAttempt }> {
  const rules = RATE_LIMIT_RULES[params.action];
  const now = params.now ?? new Date();
  const [ip, account] = await Promise.all([
    reserveAttempt(db, { key: params.ipKey, scope: 'ip', action: params.action, rule: rules.ip, now }),
    reserveAttempt(db, {
      key: params.accountKey,
      scope: 'account',
      action: params.action,
      rule: rules.account,
      now,
    }),
  ]);
  return { limited: ip.limited || account.limited, ip, account };
}

/** Marks both halves of a `reserveAttemptPair` as successful. */
export async function markAttemptPairSucceeded(
  db: Db,
  pair: { ip: ReservedAttempt; account: ReservedAttempt },
): Promise<void> {
  await Promise.all([
    markAttemptSucceeded(db, pair.ip.attemptId),
    markAttemptSucceeded(db, pair.account.attemptId),
  ]);
}
