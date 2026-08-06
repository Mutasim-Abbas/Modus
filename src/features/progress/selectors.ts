import type { AppState, DayKey, Macros } from '@/types';
import { selectLiveWeights, selectLoggedDays } from '@/lib/store';
import { sumMacros } from '@/lib/macros';
import { addDays, dayKeysBetween, toDayKey } from '@/lib/date';

/**
 * Pure data-prep for the Progress screen's charts. Everything here reads only real
 * store state — no invented points, no interpolation across a gap, no zero-filling a
 * day that was never logged (a zero would falsely claim "you ate nothing"; the caller
 * renders that as an empty slot instead — docs/DESIGN.md §4.2.2).
 */

/**
 * The three windows the mock offers. `1y` and `all` were dropped with them — the range
 * picker is the only way to widen the charts, so nothing else needs to resolve those
 * keys. `earliestActivityDay` is kept: it is the honest start-of-data and is still worth
 * having, even though no range currently spans back to it.
 */
export type RangeKey = '7d' | '30d' | '90d';

/**
 * A `Record` keyed by the exact `RangeKey` union, not an array — indexing a `Record`
 * with one of its own literal key types is not subject to `noUncheckedIndexedAccess`
 * (there is no index signature involved), so lookups below are `number | null`, never
 * `... | undefined`.
 */
const RANGE_DAYS: Record<RangeKey, number | null> = { '7d': 7, '30d': 30, '90d': 90 };
const RANGE_LABELS: Record<RangeKey, string> = { '7d': '7 days', '30d': '30 days', '90d': '90 days' };

export const RANGE_OPTIONS: { value: RangeKey; label: string }[] = (
  Object.keys(RANGE_LABELS) as RangeKey[]
).map((value) => ({ value, label: RANGE_LABELS[value] }));

/** Every logged day's macro totals, keyed by day (docs honesty rule: derived, never invented). */
export function selectDayTotalsMap(state: AppState): Map<DayKey, Macros> {
  const map = new Map<DayKey, Macros>();
  for (const day of selectLoggedDays(state)) {
    map.set(day.date, sumMacros(day.entries));
  }
  return map;
}

/** Earliest day with either a food log or a weight reading — the true start of "All". */
export function earliestActivityDay(state: AppState): DayKey | null {
  const loggedDays = selectLoggedDays(state).map((d) => d.date);
  const weightDays = selectLiveWeights(state).map((w) => w.day);
  const all = [...loggedDays, ...weightDays];
  if (all.length === 0) return null;
  return all.reduce((earliest, day) => (day < earliest ? day : earliest));
}

/**
 * Resolves a `RangeKey` to a concrete ascending list of DayKeys ending today. "all"
 * spans from the earliest real activity to today (never before there is data).
 */
export function resolveRangeDays(state: AppState, range: RangeKey, today: DayKey = toDayKey()): DayKey[] {
  const days = RANGE_DAYS[range];
  if (days !== null) return dayKeysBetween(addDays(today, -(days - 1)), today);

  const earliest = earliestActivityDay(state);
  if (!earliest) return [today];
  return dayKeysBetween(earliest, today);
}

/* ------------------------------------------------------------------ *
 * Weight trend                                                        *
 * ------------------------------------------------------------------ */

export interface WeightPoint {
  day: DayKey;
  weightKg: number;
}

export interface WeightSeriesPoint extends WeightPoint {
  /** Trailing 7-calendar-day average, or null when there isn't enough data yet. */
  movingAvgKg: number | null;
}

/** Live weight readings within `days` (inclusive), ascending. */
export function selectWeightPointsInRange(state: AppState, days: readonly DayKey[]): WeightPoint[] {
  if (days.length === 0) return [];
  const start = days[0] as DayKey;
  const end = days[days.length - 1] as DayKey;
  return selectLiveWeights(state)
    .filter((w) => w.day >= start && w.day <= end)
    .map((w) => ({ day: w.day, weightKg: w.weightKg }));
}

/**
 * Adds a trailing 7-calendar-day moving average to each reading. The window looks back
 * over *readings that exist*, not calendar days that were never weighed-in on — a
 * sparse log still gets a meaningful (if noisier) average rather than a hole.
 * `movingAvgKg` is only populated once there are at least 3 readings total; with fewer,
 * §4.2.1 says to suppress the average line and let the caller show the honest caption
 * instead.
 */
export function computeWeightSeries(readings: readonly WeightPoint[]): WeightSeriesPoint[] {
  if (readings.length < 3) {
    return readings.map((point) => ({ ...point, movingAvgKg: null }));
  }

  return readings.map((point) => {
    const windowStart = addDays(point.day, -6);
    const window = readings.filter((r) => r.day >= windowStart && r.day <= point.day);
    const avg = window.reduce((sum, r) => sum + r.weightKg, 0) / window.length;
    return { ...point, movingAvgKg: Math.round(avg * 10) / 10 };
  });
}

/** "-2.8 kg" style delta over the visible window. Null unless there's a real trend (>=3 pts). */
export function weightDeltaKg(readings: readonly WeightPoint[]): number | null {
  if (readings.length < 3) return null;
  const first = readings[0] as WeightPoint;
  const last = readings[readings.length - 1] as WeightPoint;
  return Math.round((last.weightKg - first.weightKg) * 10) / 10;
}

/* ------------------------------------------------------------------ *
 * Calories per day                                                    *
 * ------------------------------------------------------------------ */

export interface CaloriesDayPoint {
  day: DayKey;
  kcal: number | null; // null = no log at all that day (renders as an empty slot, not a 0 bar)
}

export function selectCaloriesSeries(
  dayTotals: ReadonlyMap<DayKey, Macros>,
  days: readonly DayKey[],
): CaloriesDayPoint[] {
  return days.map((day) => ({ day, kcal: dayTotals.get(day)?.kcal ?? null }));
}

/* ------------------------------------------------------------------ *
 * Macro trends (small multiples)                                      *
 * ------------------------------------------------------------------ */

export type MacroKey = 'protein' | 'carbs' | 'fat';

export interface MacroDayPoint {
  day: DayKey;
  grams: number | null;
}

export function selectMacroSeries(
  dayTotals: ReadonlyMap<DayKey, Macros>,
  days: readonly DayKey[],
  macro: MacroKey,
): MacroDayPoint[] {
  return days.map((day) => {
    const totals = dayTotals.get(day);
    return { day, grams: totals ? Math.round(totals[macro]) : null };
  });
}

/** Average grams/day of a macro, over days that were actually logged (never over gaps). */
export function macroAverage(points: readonly MacroDayPoint[]): number {
  const logged = points.filter((p): p is { day: DayKey; grams: number } => p.grams !== null);
  if (logged.length === 0) return 0;
  return Math.round(logged.reduce((sum, p) => sum + p.grams, 0) / logged.length);
}

/* ------------------------------------------------------------------ *
 * Macro split (share of calories)                                     *
 * ------------------------------------------------------------------ */

export interface MacroCalorieSplit {
  /** Percent of calories from each macro, integers summing to exactly 100. */
  protein: number;
  carbs: number;
  fat: number;
  /** Days inside the range that were actually logged — the split's real sample size. */
  loggedDays: number;
}

/**
 * What share of the range's calories came from each macro (docs/DESIGN.md §7.5).
 *
 * Deliberately *not* `MacroTrendsChart` in another shape: that one plots grams over time,
 * where 40 g of fat and 40 g of carbs draw the same height while carrying 360 vs 160 kcal.
 * This converts to energy first (4/4/9 kcal per gram) so the three shares are comparable,
 * which is the only reading under which "where the calories come from" means anything.
 *
 * The denominator is the summed *macro* energy, not the stored `kcal`. The two disagree
 * slightly — a food's kcal comes from its own label, not from 4/4/9 of its macros — and
 * dividing by the label total would leave the segments failing to reach 100%. Returns
 * null when no day in the range was logged, so the caller shows an empty state rather
 * than a bar built from nothing.
 */
export function selectMacroCalorieSplit(
  dayTotals: ReadonlyMap<DayKey, Macros>,
  days: readonly DayKey[],
): MacroCalorieSplit | null {
  let protein = 0;
  let carbs = 0;
  let fat = 0;
  let loggedDays = 0;

  for (const day of days) {
    const totals = dayTotals.get(day);
    if (!totals) continue;
    loggedDays += 1;
    protein += totals.protein * 4;
    carbs += totals.carbs * 4;
    fat += totals.fat * 9;
  }

  const total = protein + carbs + fat;
  if (loggedDays === 0 || total <= 0) return null;

  // Round two shares and derive the third, so the legend always reads 100% and the bar
  // always fills — three independent `Math.round`s can land on 99% or 101%.
  const proteinPct = Math.round((protein / total) * 100);
  const carbsPct = Math.round((carbs / total) * 100);
  return { protein: proteinPct, carbs: carbsPct, fat: 100 - proteinPct - carbsPct, loggedDays };
}

/* ------------------------------------------------------------------ *
 * Weekly averages                                                     *
 * ------------------------------------------------------------------ */

export interface WeekAverage {
  weekStart: DayKey;
  weekEnd: DayKey;
  loggedDays: number;
  avgKcal: number;
  onTargetWithinTolerance: boolean | null; // null when nothing was logged that week
}

/**
 * Trailing 7-day blocks ending at `today`, most recent first: block 0 is
 * `[today-6, today]`, block 1 is the 7 days before that, and so on. Average is over the
 * days that were actually logged within the block, never silently divided by 7
 * (docs/DESIGN.md §4.2.4 — "never silently average over missing days").
 */
export function computeWeeklyAverages(
  dayTotals: ReadonlyMap<DayKey, Macros>,
  weeksCount: number,
  targetKcal: number,
  today: DayKey = toDayKey(),
): WeekAverage[] {
  const weeks: WeekAverage[] = [];
  for (let w = 0; w < weeksCount; w++) {
    const weekEnd = addDays(today, -7 * w);
    const weekStart = addDays(weekEnd, -6);
    const totals = dayKeysBetween(weekStart, weekEnd)
      .map((d) => dayTotals.get(d))
      .filter((t): t is Macros => t !== undefined);

    const loggedDays = totals.length;
    const avgKcal = loggedDays > 0 ? Math.round(totals.reduce((s, t) => s + t.kcal, 0) / loggedDays) : 0;
    const onTargetWithinTolerance =
      loggedDays === 0 || targetKcal <= 0 ? null : Math.abs(avgKcal - targetKcal) / targetKcal <= 0.05;

    weeks.push({ weekStart, weekEnd, loggedDays, avgKcal, onTargetWithinTolerance });
  }
  return weeks;
}

/** How many trailing weeks (capped at `max`) actually have at least one logged day. */
export function weeksWithActivity(dayTotals: ReadonlyMap<DayKey, Macros>, max: number, today: DayKey = toDayKey()): number {
  let count = 0;
  for (let w = 0; w < max; w++) {
    const weekEnd = addDays(today, -7 * w);
    const weekStart = addDays(weekEnd, -6);
    const hasActivity = dayKeysBetween(weekStart, weekEnd).some((d) => dayTotals.has(d));
    if (hasActivity) count = w + 1;
  }
  return count;
}
