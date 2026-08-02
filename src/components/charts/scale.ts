import type { DayKey } from '@/types';

/** Maps each day to its 0-based position within an ordered list of days. */
export function buildDayIndex(days: readonly DayKey[]): Map<DayKey, number> {
  const map = new Map<DayKey, number>();
  days.forEach((day, index) => map.set(day, index));
  return map;
}

/**
 * A linear scale: maps a numeric domain to a pixel range. A zero-width domain (e.g. a
 * single reading) maps every value to the range midpoint rather than dividing by zero.
 */
export function linearScale(domain: [number, number], range: [number, number]): (value: number) => number {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  if (d1 === d0) return () => (r0 + r1) / 2;
  return (value: number) => r0 + ((value - d0) / (d1 - d0)) * (r1 - r0);
}
