import { authFetchJson } from '@/lib/authApi';
import { parsePullResult } from '@/lib/sync/wire';
import type { PullCursor, PullResult, PushRequestBody, PushResult } from '@/lib/sync/types';
import { parseServerState } from '@/lib/sync/wire';

/**
 * Typed HTTP client for `GET /api/sync/pull` / `POST /api/sync/push` (docs/API.md).
 * Reuses `src/lib/authApi.ts`'s exact transport/error taxonomy (`AuthError`,
 * `authFetchJson`) — the sync routes document the identical `503`/`401`/`429`/network
 * error shapes as `api/auth/*`, so there is no reason to duplicate that logic here.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `GET /api/sync/pull?cursor=<url-encoded JSON>`. Omit `cursor` for a full pull. */
export async function pull(cursor: PullCursor | null): Promise<PullResult> {
  const query = cursor ? `?cursor=${encodeURIComponent(JSON.stringify(cursor))}` : '';
  const body = await authFetchJson(`/api/sync/pull${query}`, { method: 'GET' });
  return parsePullResult(body);
}

function parseAppliedRow(value: unknown): { id: string; updatedAt: string; deletedAt: string | null } | null {
  if (!isRecord(value)) return null;
  const id = typeof value.id === 'string' ? value.id : '';
  const updatedAt = typeof value.updatedAt === 'string' ? value.updatedAt : '';
  if (!id || !updatedAt) return null;
  return { id, updatedAt, deletedAt: typeof value.deletedAt === 'string' ? value.deletedAt : null };
}

function parseAppliedFavourite(value: unknown): { foodId: string; updatedAt: string; deletedAt: string | null } | null {
  if (!isRecord(value)) return null;
  const foodId = typeof value.foodId === 'string' ? value.foodId : '';
  const updatedAt = typeof value.updatedAt === 'string' ? value.updatedAt : '';
  if (!foodId || !updatedAt) return null;
  return { foodId, updatedAt, deletedAt: typeof value.deletedAt === 'string' ? value.deletedAt : null };
}

function parseSingleton(value: unknown): { updatedAt: string; deletedAt: string | null } | null {
  if (!isRecord(value)) return null;
  const updatedAt = typeof value.updatedAt === 'string' ? value.updatedAt : '';
  if (!updatedAt) return null;
  return { updatedAt, deletedAt: typeof value.deletedAt === 'string' ? value.deletedAt : null };
}

function parseRejected(value: unknown): { id: string; reason: 'owner_conflict' | 'duplicate_day' }[] {
  if (!Array.isArray(value)) return [];
  const rows: { id: string; reason: 'owner_conflict' | 'duplicate_day' }[] = [];
  for (const raw of value) {
    if (!isRecord(raw)) continue;
    const id = typeof raw.id === 'string' ? raw.id : '';
    const reason = raw.reason === 'owner_conflict' || raw.reason === 'duplicate_day' ? raw.reason : null;
    if (!id || !reason) continue;
    rows.push({ id, reason });
  }
  return rows;
}

function parsePushResult(value: unknown): PushResult {
  const record = isRecord(value) ? value : {};
  const applied = isRecord(record.applied) ? record.applied : {};
  const rejected = isRecord(record.rejected) ? record.rejected : {};

  return {
    // `serverState` — an informational watermark, NEVER a pull cursor. Parsed with the
    // same shape as a cursor (docs/API.md), but returned under its own type name
    // (`ServerStateWatermark`) so nothing downstream can accidentally assign it into a
    // `PullCursor`-typed variable without an explicit, visible cast (the internal security audit F-03).
    serverState: parseServerState(record.serverState),
    applied: {
      profile: parseSingleton(applied.profile),
      settings: parseSingleton(applied.settings),
      entries: Array.isArray(applied.entries)
        ? applied.entries.map(parseAppliedRow).filter((r): r is NonNullable<typeof r> => r !== null)
        : [],
      weights: Array.isArray(applied.weights)
        ? applied.weights.map(parseAppliedRow).filter((r): r is NonNullable<typeof r> => r !== null)
        : [],
      customFoods: Array.isArray(applied.customFoods)
        ? applied.customFoods.map(parseAppliedRow).filter((r): r is NonNullable<typeof r> => r !== null)
        : [],
      favourites: Array.isArray(applied.favourites)
        ? applied.favourites.map(parseAppliedFavourite).filter((r): r is NonNullable<typeof r> => r !== null)
        : [],
    },
    rejected: {
      entries: parseRejected(rejected.entries),
      weights: parseRejected(rejected.weights),
      customFoods: parseRejected(rejected.customFoods),
      favourites: [],
    },
  };
}

/** `POST /api/sync/push`. Throws `AuthError` on any non-2xx (same taxonomy as auth). */
export async function push(body: PushRequestBody): Promise<PushResult> {
  const result = await authFetchJson('/api/sync/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return parsePushResult(result);
}
