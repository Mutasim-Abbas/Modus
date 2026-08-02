import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { lastNDays } from '@/lib/date';
import {
  buildStreakDays,
  currentStreak,
  isOnTargetForStreak,
  streakCellState,
} from '@/features/progress/streaks';

const TARGET = 2000;

describe('isOnTargetForStreak', () => {
  it('accepts exactly on target', () => {
    expect(isOnTargetForStreak(2000, TARGET)).toBe(true);
  });

  it('accepts the edges of the ±15% band', () => {
    expect(isOnTargetForStreak(1700, TARGET)).toBe(true); // -15%
    expect(isOnTargetForStreak(2300, TARGET)).toBe(true); // +15%
  });

  it('rejects just outside the band', () => {
    expect(isOnTargetForStreak(1699, TARGET)).toBe(false);
    expect(isOnTargetForStreak(2301, TARGET)).toBe(false);
  });

  it('rejects a non-finite kcal or a zero/negative target', () => {
    expect(isOnTargetForStreak(NaN, TARGET)).toBe(false);
    expect(isOnTargetForStreak(2000, 0)).toBe(false);
    expect(isOnTargetForStreak(2000, -100)).toBe(false);
  });
});

describe('currentStreak', () => {
  const today = '2026-07-16';

  it('is 0 with no logged days at all', () => {
    const days = buildStreakDays(lastNDays(7, today), new Map());
    expect(currentStreak(days, TARGET, today)).toBe(0);
  });

  it('counts consecutive on-target days ending today', () => {
    const kcalByDay = new Map([
      ['2026-07-14', 2000],
      ['2026-07-15', 1950],
      ['2026-07-16', 2050],
    ]);
    const days = buildStreakDays(lastNDays(7, today), kcalByDay);
    expect(currentStreak(days, TARGET, today)).toBe(3);
  });

  it('stops at a gap (a day with nothing logged at all)', () => {
    const kcalByDay = new Map([
      ['2026-07-12', 2000],
      // 07-13 missing entirely — the gap
      ['2026-07-14', 2000],
      ['2026-07-15', 2000],
      ['2026-07-16', 2000],
    ]);
    const days = buildStreakDays(lastNDays(7, today), kcalByDay);
    expect(currentStreak(days, TARGET, today)).toBe(3); // 14, 15, 16 only
  });

  it('stops at a day that was logged but missed the ±15% band', () => {
    const kcalByDay = new Map([
      ['2026-07-14', 2000],
      ['2026-07-15', 3200], // way over
      ['2026-07-16', 2000],
    ]);
    const days = buildStreakDays(lastNDays(7, today), kcalByDay);
    expect(currentStreak(days, TARGET, today)).toBe(1); // just today
  });

  it('is 0 when today itself was logged but missed the band', () => {
    const kcalByDay = new Map([
      ['2026-07-15', 2000],
      ['2026-07-16', 5000],
    ]);
    const days = buildStreakDays(lastNDays(7, today), kcalByDay);
    expect(currentStreak(days, TARGET, today)).toBe(0);
  });

  it('treats today as pending (not a break) when nothing is logged for it yet', () => {
    const kcalByDay = new Map([
      ['2026-07-14', 2000],
      ['2026-07-15', 2000],
      // nothing for today — the day isn't over yet
    ]);
    const days = buildStreakDays(lastNDays(7, today), kcalByDay);
    expect(currentStreak(days, TARGET, today)).toBe(2);
  });

  it('does not resurrect a streak across a gap even when today is pending', () => {
    const kcalByDay = new Map([
      ['2026-07-13', 2000],
      // 07-14 gap
      ['2026-07-15', 2000],
      // 07-16 (today) not logged yet
    ]);
    const days = buildStreakDays(lastNDays(7, today), kcalByDay);
    expect(currentStreak(days, TARGET, today)).toBe(1); // 15 only
  });

  describe('across a DST transition', () => {
    const originalTZ = process.env.TZ;
    beforeEach(() => {
      process.env.TZ = 'America/New_York';
    });
    afterEach(() => {
      process.env.TZ = originalTZ;
    });

    it('counts correctly through the spring-forward change (2026-03-08)', () => {
      const dstToday = '2026-03-09';
      const kcalByDay = new Map([
        ['2026-03-07', 2000],
        ['2026-03-08', 2000], // the 23-hour day
        ['2026-03-09', 2000],
      ]);
      const days = buildStreakDays(lastNDays(5, dstToday), kcalByDay);
      expect(currentStreak(days, TARGET, dstToday)).toBe(3);
    });

    it('counts correctly through the fall-back change (2026-11-01)', () => {
      const dstToday = '2026-11-02';
      const kcalByDay = new Map([
        ['2026-10-31', 2000],
        ['2026-11-01', 2000], // the 25-hour day
        ['2026-11-02', 2000],
      ]);
      const days = buildStreakDays(lastNDays(5, dstToday), kcalByDay);
      expect(currentStreak(days, TARGET, dstToday)).toBe(3);
    });
  });
});

describe('streakCellState', () => {
  it('is "no-log" for a day with no entry, an unlogged day, or a non-positive target', () => {
    expect(streakCellState(undefined, TARGET)).toBe('no-log');
    expect(streakCellState({ day: '2026-07-16', kcal: 0, logged: false }, TARGET)).toBe('no-log');
    expect(streakCellState({ day: '2026-07-16', kcal: 2000, logged: true }, 0)).toBe('no-log');
  });

  it('buckets by percentage of target', () => {
    expect(streakCellState({ day: 'd', kcal: 1000, logged: true }, TARGET)).toBe('low'); // 50%
    expect(streakCellState({ day: 'd', kcal: 1600, logged: true }, TARGET)).toBe('mid'); // 80%
    expect(streakCellState({ day: 'd', kcal: 1700, logged: true }, TARGET)).toBe('target'); // 85% — lower band edge
    expect(streakCellState({ day: 'd', kcal: 1900, logged: true }, TARGET)).toBe('target'); // 95%
    expect(streakCellState({ day: 'd', kcal: 2050, logged: true }, TARGET)).toBe('target'); // 102.5%
    expect(streakCellState({ day: 'd', kcal: 2200, logged: true }, TARGET)).toBe('target'); // 110% — upper band edge
    expect(streakCellState({ day: 'd', kcal: 2300, logged: true }, TARGET)).toBe('over'); // 115%
  });
});
