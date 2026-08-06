import type { DayKey } from '@/types';

/** Local-timezone `YYYY-MM-DD`. Deliberately not toISOString(), which shifts to UTC. */
export function toDayKey(date: Date = new Date()): DayKey {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function isDayKey(value: unknown): value is DayKey {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/** Parses a DayKey into a local Date at midnight. Returns null if malformed. */
export function fromDayKey(key: DayKey): Date | null {
  if (!isDayKey(key)) return null;
  const [year, month, day] = key.split('-').map(Number) as [number, number, number];
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Adds (or subtracts, for a negative delta) whole calendar days to a DayKey.
 *
 * Deliberately implemented with `Date#setDate`, which walks local calendar fields —
 * not by adding `delta * 86400000` ms, which would land on the wrong side of a DST
 * transition twice a year. Malformed input returns the key unchanged rather than
 * throwing, matching the rest of this module's degrade-safely contract.
 */
export function addDays(key: DayKey, delta: number): DayKey {
  const date = fromDayKey(key);
  if (!date || !Number.isFinite(delta)) return key;
  date.setDate(date.getDate() + Math.trunc(delta));
  return toDayKey(date);
}

/**
 * Every DayKey from `start` to `end` inclusive, ascending. Returns `[]` for malformed
 * input or an inverted range. Guarded against runaway loops from a corrupt/far-future
 * key, mirroring the rest of the module's "degrade, don't crash" contract.
 */
export function dayKeysBetween(start: DayKey, end: DayKey): DayKey[] {
  const startDate = fromDayKey(start);
  const endDate = fromDayKey(end);
  if (!startDate || !endDate || startDate.getTime() > endDate.getTime()) return [];

  const keys: DayKey[] = [];
  let cursor = start;
  const MAX_DAYS = 20000; // ~55 years — generous, but not unbounded
  for (let i = 0; i < MAX_DAYS; i++) {
    keys.push(cursor);
    if (cursor === end) break;
    cursor = addDays(cursor, 1);
  }
  return keys;
}

/**
 * The `n` DayKeys ending at (and including) `today`, ascending — e.g. `lastNDays(3)`
 * on 12 Mar returns `['2026-03-10', '2026-03-11', '2026-03-12']`.
 */
export function lastNDays(n: number, today: DayKey = toDayKey()): DayKey[] {
  if (!Number.isFinite(n) || n <= 0) return [];
  return dayKeysBetween(addDays(today, -(Math.trunc(n) - 1)), today);
}

/**
 * The long, spelled-out form used in the Today eyebrow — "Wednesday, 5 August". Unlike
 * `formatDayLabel` this never collapses to "Today"/"Yesterday": the eyebrow already says
 * "Today ·", so the date next to it has to be the actual date to add anything.
 */
export function formatLongDate(key: DayKey): string {
  const date = fromDayKey(key);
  if (!date) return key;
  return date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
}

export function formatDayLabel(key: DayKey, today: DayKey = toDayKey()): string {
  const date = fromDayKey(key);
  if (!date) return key;

  if (key === today) return 'Today';

  const yesterday = fromDayKey(today);
  if (yesterday) {
    yesterday.setDate(yesterday.getDate() - 1);
    if (toDayKey(yesterday) === key) return 'Yesterday';
  }

  return date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}
