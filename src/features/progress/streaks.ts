import type { DayKey } from '@/types';
import { addDays } from '@/lib/date';

/**
 * Adherence streak logic — pure, deterministic, no I/O and no Date.now() inside.
 *
 * The rule, stated on-screen exactly as here (docs/DESIGN.md §4.2.5): "A day counts
 * when you log at least one entry and land within ±15% of your calorie target."
 */
export const STREAK_TOLERANCE = 0.15;

export interface StreakDay {
  day: DayKey;
  /** Total kcal logged that day. 0 when nothing was logged. */
  kcal: number;
  /** At least one live entry exists for the day. */
  logged: boolean;
}

/** True when a logged day's calories fall within ±15% of the target. */
export function isOnTargetForStreak(kcal: number, targetKcal: number): boolean {
  if (!Number.isFinite(kcal) || !Number.isFinite(targetKcal) || targetKcal <= 0) return false;
  const ratio = kcal / targetKcal;
  return ratio >= 1 - STREAK_TOLERANCE && ratio <= 1 + STREAK_TOLERANCE;
}

/**
 * Builds one `StreakDay` per key in `days`, from a day -> kcal-logged map. Days absent
 * from `kcalByDay` are treated as not logged (kcal 0), never invented.
 */
export function buildStreakDays(
  days: readonly DayKey[],
  kcalByDay: ReadonlyMap<DayKey, number>,
): StreakDay[] {
  return days.map((day) => {
    const kcal = kcalByDay.get(day);
    return { day, kcal: kcal ?? 0, logged: kcal !== undefined };
  });
}

/**
 * The current streak length, walking backward from `today`.
 *
 * Rules:
 *  - A day that was logged but missed the ±15% band breaks the streak at 0.
 *  - `today` not being logged yet does not break a streak that is still running as of
 *    yesterday — the day isn't over, so it's "pending", not "missed".
 *  - Any gap (a day with no `StreakDay` entry at all, or `logged: false`) stops the
 *    count. Streaks never span a hole in the log.
 *  - Runs on a `Map` keyed by day for O(1) lookups; `addDays` (docs/lib/date.ts) does
 *    the DST-safe walk backward one calendar day at a time.
 */
export function currentStreak(
  streakDays: readonly StreakDay[],
  targetKcal: number,
  today: DayKey,
): number {
  const byDay = new Map(streakDays.map((d) => [d.day, d] as const));

  const todayEntry = byDay.get(today);
  if (todayEntry?.logged && !isOnTargetForStreak(todayEntry.kcal, targetKcal)) return 0;

  let cursor = todayEntry?.logged ? today : addDays(today, -1);
  let count = 0;
  const MAX_LOOKBACK = 20000; // guards against a corrupt/unbounded map

  for (let i = 0; i < MAX_LOOKBACK; i++) {
    const entry = byDay.get(cursor);
    if (!entry || !entry.logged || !isOnTargetForStreak(entry.kcal, targetKcal)) break;
    count += 1;
    cursor = addDays(cursor, -1);
  }

  return count;
}

/** The five states a streak-calendar cell can render — colour + shape, never hue alone. */
export type StreakCellState = 'no-log' | 'low' | 'mid' | 'target' | 'over';

/**
 * Buckets a single day's kcal-vs-target ratio into the ordinal heatmap fill
 * (docs/DESIGN.md §4.2.5 table). Deliberately a *different* tolerance from the ±15%
 * streak rule above — the heatmap shows a finer gradient, the streak headline is a
 * stricter pass/fail.
 */
export function streakCellState(entry: StreakDay | undefined, targetKcal: number): StreakCellState {
  if (!entry || !entry.logged || !Number.isFinite(targetKcal) || targetKcal <= 0) return 'no-log';
  const ratio = entry.kcal / targetKcal;
  if (ratio < 0.6) return 'low';
  if (ratio < 0.85) return 'mid';
  if (ratio <= 1.1) return 'target';
  return 'over';
}
