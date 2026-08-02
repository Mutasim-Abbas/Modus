import { beforeEach, describe, expect, it } from 'vitest';
import type { AppState } from '@/types';
import { createStore, defaultState } from '@/lib/store';
import { addDays, lastNDays, toDayKey } from '@/lib/date';
import {
  computeWeeklyAverages,
  computeWeightSeries,
  earliestActivityDay,
  macroAverage,
  resolveRangeDays,
  selectCaloriesSeries,
  selectDayTotalsMap,
  selectMacroSeries,
  selectWeightPointsInRange,
  weeksWithActivity,
  weightDeltaKg,
} from '@/features/progress/selectors';

const today = '2026-07-16';

const entry = {
  name: 'Chicken breast, cooked',
  grams: 150,
  kcal: 248,
  protein: 46.5,
  carbs: 0,
  fat: 5.4,
  meal: 'lunch' as const,
  source: 'food-db' as const,
};

describe('selectDayTotalsMap', () => {
  it('is empty for a fresh state', () => {
    expect(selectDayTotalsMap(defaultState())).toEqual(new Map());
  });

  it('sums each day\'s live entries, keyed by day', () => {
    const store = createStore(defaultState());
    store.addEntry(entry, '2026-07-14');
    store.addEntry({ ...entry, kcal: 100 }, '2026-07-14');
    store.addEntry(entry, '2026-07-15');

    const map = selectDayTotalsMap(store.getState());
    expect(map.get('2026-07-14')?.kcal).toBe(348);
    expect(map.get('2026-07-15')?.kcal).toBe(248);
    expect(map.has('2026-07-16')).toBe(false);
  });

  it('never invents a day that was never logged', () => {
    const store = createStore(defaultState());
    store.addEntry(entry, '2026-07-14');
    const map = selectDayTotalsMap(store.getState());
    expect(map.size).toBe(1);
  });
});

describe('earliestActivityDay', () => {
  it('is null with nothing logged and no weights', () => {
    expect(earliestActivityDay(defaultState())).toBeNull();
  });

  it('finds the earliest of entries and weights combined', () => {
    const store = createStore(defaultState());
    store.addEntry(entry, '2026-07-10');
    store.logWeight(80, '2026-06-01');
    expect(earliestActivityDay(store.getState())).toBe('2026-06-01');
  });
});

describe('resolveRangeDays', () => {
  it('returns exactly n days for a fixed range', () => {
    const days = resolveRangeDays(defaultState(), '30d', today);
    expect(days).toHaveLength(30);
    expect(days[0]).toBe('2026-06-17');
    expect(days[days.length - 1]).toBe(today);
  });

  it('"all" with zero activity returns just today rather than an empty/huge range', () => {
    expect(resolveRangeDays(defaultState(), 'all', today)).toEqual([today]);
  });

  it('"all" spans from the earliest real activity to today', () => {
    const store = createStore(defaultState());
    store.logWeight(80, '2026-07-01');
    const days = resolveRangeDays(store.getState(), 'all', today);
    expect(days[0]).toBe('2026-07-01');
    expect(days[days.length - 1]).toBe(today);
  });
});

describe('weight series', () => {
  it('selectWeightPointsInRange only returns readings inside the window', () => {
    const store = createStore(defaultState());
    store.logWeight(82, '2026-06-01'); // outside
    store.logWeight(81, '2026-07-10');
    store.logWeight(80.5, '2026-07-16');
    const points = selectWeightPointsInRange(store.getState(), lastNDays(30, today));
    expect(points.map((p) => p.day)).toEqual(['2026-07-10', '2026-07-16']);
  });

  it('computeWeightSeries suppresses the moving average with fewer than 3 readings', () => {
    const series = computeWeightSeries([
      { day: '2026-07-10', weightKg: 81 },
      { day: '2026-07-16', weightKg: 80.5 },
    ]);
    expect(series.every((p) => p.movingAvgKg === null)).toBe(true);
  });

  it('computeWeightSeries does not crash and shows the single point with >= 3 readings absent', () => {
    const series = computeWeightSeries([{ day: '2026-07-16', weightKg: 80.5 }]);
    expect(series).toEqual([{ day: '2026-07-16', weightKg: 80.5, movingAvgKg: null }]);
  });

  it('computeWeightSeries computes a trailing 7-day average once there are >= 3 readings', () => {
    const series = computeWeightSeries([
      { day: '2026-07-10', weightKg: 82 },
      { day: '2026-07-12', weightKg: 81 },
      { day: '2026-07-16', weightKg: 80 }, // outside the 7-day window of the first two
    ]);
    // window for 07-16 looks back to 07-10 inclusive -> all three readings average in
    expect(series[2]?.movingAvgKg).toBeCloseTo((82 + 81 + 80) / 3, 5);
    // window for 07-10 is just itself
    expect(series[0]?.movingAvgKg).toBe(82);
  });

  it('weightDeltaKg is null under 3 readings (never implies a trend on 1-2 points)', () => {
    expect(weightDeltaKg([])).toBeNull();
    expect(weightDeltaKg([{ day: today, weightKg: 80 }])).toBeNull();
    expect(
      weightDeltaKg([
        { day: '2026-07-10', weightKg: 82 },
        { day: today, weightKg: 80 },
      ]),
    ).toBeNull();
  });

  it('weightDeltaKg is last minus first once there is a real trend', () => {
    const delta = weightDeltaKg([
      { day: '2026-04-01', weightKg: 84.2 },
      { day: '2026-06-01', weightKg: 82.0 },
      { day: today, weightKg: 81.4 },
    ]);
    expect(delta).toBeCloseTo(-2.8, 5);
  });
});

describe('calories and macro series', () => {
  let state: AppState;

  beforeEach(() => {
    const store = createStore(defaultState());
    store.addEntry(entry, '2026-07-14');
    store.addEntry({ ...entry, protein: 20, carbs: 30, fat: 10, kcal: 300 }, '2026-07-16');
    state = store.getState();
  });

  it('selectCaloriesSeries renders a gap day as null, not zero', () => {
    const totals = selectDayTotalsMap(state);
    const series = selectCaloriesSeries(totals, lastNDays(3, today));
    expect(series).toEqual([
      { day: '2026-07-14', kcal: 248 },
      { day: '2026-07-15', kcal: null },
      { day: '2026-07-16', kcal: 300 },
    ]);
  });

  it('selectMacroSeries picks the right macro per day, null on gap days', () => {
    const totals = selectDayTotalsMap(state);
    const series = selectMacroSeries(totals, lastNDays(3, today), 'protein');
    expect(series).toEqual([
      { day: '2026-07-14', grams: 47 }, // rounds 46.5
      { day: '2026-07-15', grams: null },
      { day: '2026-07-16', grams: 20 },
    ]);
  });

  it('macroAverage averages only over logged days, never over gaps', () => {
    const totals = selectDayTotalsMap(state);
    const series = selectMacroSeries(totals, lastNDays(3, today), 'protein');
    expect(macroAverage(series)).toBe(Math.round((47 + 20) / 2));
  });

  it('macroAverage is 0 with nothing logged', () => {
    expect(macroAverage([{ day: today, grams: null }])).toBe(0);
  });
});

describe('computeWeeklyAverages', () => {
  it('flags a week with fewer than 4 logged days rather than silently averaging', () => {
    const store = createStore(defaultState());
    store.addEntry(entry, today); // only 1 of the last 7 days
    const totals = selectDayTotalsMap(store.getState());
    const weeks = computeWeeklyAverages(totals, 1, 2000, today);
    expect(weeks[0]?.loggedDays).toBe(1);
    expect(weeks[0]?.avgKcal).toBe(248);
  });

  it('a week with nothing logged reports onTargetWithinTolerance as null, not false', () => {
    const weeks = computeWeeklyAverages(new Map(), 1, 2000, today);
    expect(weeks[0]).toEqual({
      weekStart: addDays(today, -6),
      weekEnd: today,
      loggedDays: 0,
      avgKcal: 0,
      onTargetWithinTolerance: null,
    });
  });

  it('flags within ±5% of target as true, outside as false', () => {
    const store = createStore(defaultState());
    for (const day of lastNDays(7, today)) store.addEntry({ ...entry, kcal: 2000 }, day);
    const totals = selectDayTotalsMap(store.getState());
    expect(computeWeeklyAverages(totals, 1, 2000, today)[0]?.onTargetWithinTolerance).toBe(true);
    expect(computeWeeklyAverages(totals, 1, 3000, today)[0]?.onTargetWithinTolerance).toBe(false);
  });
});

describe('weeksWithActivity', () => {
  it('is 0 with nothing logged', () => {
    expect(weeksWithActivity(new Map(), 8, today)).toBe(0);
  });

  it('counts back through the most distant week that has any activity', () => {
    const store = createStore(defaultState());
    store.addEntry(entry, addDays(today, -20)); // ~3 weeks back
    const totals = selectDayTotalsMap(store.getState());
    expect(weeksWithActivity(totals, 8, today)).toBe(3);
  });
});

// toDayKey is exercised indirectly through the default-parameter path of the range
// helpers; imported here only so the module boundary itself is covered by a real call.
describe('module wiring', () => {
  it('resolveRangeDays defaults `today` from toDayKey when omitted', () => {
    expect(resolveRangeDays(defaultState(), '30d')).toHaveLength(30);
    expect(typeof toDayKey()).toBe('string');
  });
});
