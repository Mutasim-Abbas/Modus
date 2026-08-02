import { authFetchJson } from '@/lib/authApi';

/**
 * A single, minimal read against `GET /api/sync/pull` (docs/API.md), used only by the
 * delete-account confirmation screen (docs/DESIGN.md §7.9) to show real, pre-commit
 * counts instead of inventing them (docs/DESIGN.md §0 rule 8).
 *
 * This is deliberately NOT the sync engine: no cursor persistence, no outbox, no pull
 * loop, no push, no conflict resolution, no adoption/merge screen. That is Task 6's
 * scope in full; this file exists only so one screen can render a true number, and Task
 * 6 will very likely replace or absorb it once the real sync client exists.
 */
export interface SyncCounts {
  entries: { total: number; days: number; firstDay: string | null; lastDay: string | null };
  weights: { total: number };
  customFoods: { total: number };
  favourites: { total: number };
  lastChangeAt: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function parseCounts(value: unknown): SyncCounts {
  const record = isRecord(value) ? value : {};
  const entries = isRecord(record.entries) ? record.entries : {};
  const weights = isRecord(record.weights) ? record.weights : {};
  const customFoods = isRecord(record.customFoods) ? record.customFoods : {};
  const favourites = isRecord(record.favourites) ? record.favourites : {};

  return {
    entries: {
      total: num(entries.total),
      days: num(entries.days),
      firstDay: nullableString(entries.firstDay),
      lastDay: nullableString(entries.lastDay),
    },
    weights: { total: num(weights.total) },
    customFoods: { total: num(customFoods.total) },
    favourites: { total: num(favourites.total) },
    lastChangeAt: nullableString(record.lastChangeAt),
  };
}

/** A full pull (no cursor) to read `counts` — see `docs/API.md`'s "counts" section. */
export async function pullCounts(): Promise<SyncCounts> {
  const body = await authFetchJson('/api/sync/pull');
  return parseCounts(isRecord(body) ? body.counts : null);
}
