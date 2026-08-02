import type { AppState, DayKey } from '@/types';
import { selectDay } from '@/lib/store';
import { lastNDays } from '@/lib/date';

/**
 * A food the user has actually logged recently, for the Log screen's "Recent" filter
 * and for defaulting a favourite's quick-add portion to what was used last time.
 *
 * Pure and derived entirely from public selectors/date helpers — no new store state,
 * no new date arithmetic (`lib/date.ts`'s `lastNDays` does the DST-safe walk).
 */
export interface RecentFoodRef {
  foodId: string;
  name: string;
  lastGrams: number;
  lastLoggedAt: number;
}

/**
 * The most recent live entries that carry a `foodId` (food-db or custom-food sourced —
 * scanned/manual entries have no stable id to re-add by), one per food, newest first.
 */
export function selectRecentFoodRefs(
  state: AppState,
  today: DayKey,
  windowDays = 14,
): RecentFoodRef[] {
  const byFoodId = new Map<string, RecentFoodRef>();

  for (const day of lastNDays(windowDays, today)) {
    for (const entry of selectDay(state, day).entries) {
      if (!entry.foodId) continue;
      const current = byFoodId.get(entry.foodId);
      if (current && current.lastLoggedAt >= entry.loggedAt) continue;
      byFoodId.set(entry.foodId, {
        foodId: entry.foodId,
        name: entry.name,
        lastGrams: entry.grams,
        lastLoggedAt: entry.loggedAt,
      });
    }
  }

  return Array.from(byFoodId.values()).sort((a, b) => b.lastLoggedAt - a.lastLoggedAt);
}
