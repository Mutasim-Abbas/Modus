import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  addDays,
  dayKeysBetween,
  formatDayLabel,
  fromDayKey,
  isDayKey,
  lastNDays,
  toDayKey,
} from '@/lib/date';

afterEach(() => {
  vi.useRealTimers();
});

describe('toDayKey', () => {
  it('formats a date as YYYY-MM-DD', () => {
    expect(toDayKey(new Date(2026, 6, 16))).toBe('2026-07-16');
  });

  it('zero-pads single-digit months and days', () => {
    expect(toDayKey(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('uses the local calendar day, not UTC', () => {
    // 00:30 local on the 16th is still the 15th in UTC for positive offsets;
    // toISOString() would report the wrong day here.
    const localMidnightish = new Date(2026, 6, 16, 0, 30);
    expect(toDayKey(localMidnightish)).toBe('2026-07-16');
  });

  it('defaults to today', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 16, 12));
    expect(toDayKey()).toBe('2026-07-16');
  });
});

describe('isDayKey', () => {
  it('accepts a well-formed key', () => {
    expect(isDayKey('2026-07-16')).toBe(true);
  });

  it('rejects anything else', () => {
    for (const bad of ['2026-7-16', '16-07-2026', 'today', '', null, undefined, 42, {}]) {
      expect(isDayKey(bad)).toBe(false);
    }
  });
});

describe('fromDayKey', () => {
  it('round-trips with toDayKey', () => {
    const key = '2026-07-16';
    const date = fromDayKey(key);
    expect(date).not.toBeNull();
    expect(toDayKey(date as Date)).toBe(key);
  });

  it('returns local midnight', () => {
    const date = fromDayKey('2026-07-16');
    expect(date?.getHours()).toBe(0);
    expect(date?.getDate()).toBe(16);
    expect(date?.getMonth()).toBe(6);
  });

  it('returns null for a malformed key', () => {
    expect(fromDayKey('nonsense')).toBeNull();
  });
});

describe('formatDayLabel', () => {
  it('labels the current day "Today"', () => {
    expect(formatDayLabel('2026-07-16', '2026-07-16')).toBe('Today');
  });

  it('labels the previous day "Yesterday"', () => {
    expect(formatDayLabel('2026-07-15', '2026-07-16')).toBe('Yesterday');
  });

  it('handles "Yesterday" across a month boundary', () => {
    expect(formatDayLabel('2026-06-30', '2026-07-01')).toBe('Yesterday');
  });

  it('handles "Yesterday" across a year boundary', () => {
    expect(formatDayLabel('2025-12-31', '2026-01-01')).toBe('Yesterday');
  });

  it('formats older days as a readable date', () => {
    const label = formatDayLabel('2026-07-10', '2026-07-16');
    expect(label).not.toBe('Today');
    expect(label).not.toBe('Yesterday');
    expect(label.length).toBeGreaterThan(0);
  });

  it('returns the raw key for a malformed input rather than crashing', () => {
    expect(formatDayLabel('garbage', '2026-07-16')).toBe('garbage');
  });
});

describe('addDays', () => {
  it('adds forward across a month boundary', () => {
    expect(addDays('2026-07-30', 3)).toBe('2026-08-02');
  });

  it('subtracts backward across a year boundary', () => {
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('returns the same key for delta 0', () => {
    expect(addDays('2026-07-16', 0)).toBe('2026-07-16');
  });

  it('truncates a fractional delta', () => {
    expect(addDays('2026-07-16', 2.9)).toBe('2026-07-18');
  });

  it('returns the input unchanged for a malformed key', () => {
    expect(addDays('garbage', 5)).toBe('garbage');
  });
});

describe('dayKeysBetween', () => {
  it('lists every day inclusive, ascending', () => {
    expect(dayKeysBetween('2026-07-14', '2026-07-17')).toEqual([
      '2026-07-14',
      '2026-07-15',
      '2026-07-16',
      '2026-07-17',
    ]);
  });

  it('returns a single-element array when start equals end', () => {
    expect(dayKeysBetween('2026-07-16', '2026-07-16')).toEqual(['2026-07-16']);
  });

  it('returns [] for an inverted range', () => {
    expect(dayKeysBetween('2026-07-17', '2026-07-14')).toEqual([]);
  });

  it('returns [] for a malformed key', () => {
    expect(dayKeysBetween('garbage', '2026-07-14')).toEqual([]);
  });
});

describe('lastNDays', () => {
  it('returns the n most recent days ending at today, ascending', () => {
    expect(lastNDays(3, '2026-07-16')).toEqual(['2026-07-14', '2026-07-15', '2026-07-16']);
  });

  it('returns [] for n <= 0', () => {
    expect(lastNDays(0, '2026-07-16')).toEqual([]);
    expect(lastNDays(-2, '2026-07-16')).toEqual([]);
  });
});

describe('day-field math across DST transitions', () => {
  // `addDays`/`dayKeysBetween` are implemented with `Date#setDate`, which walks local
  // calendar fields rather than adding 24h in milliseconds — the latter would land on
  // the wrong side of a DST change twice a year. Pinning TZ makes this deterministic
  // regardless of the host machine's own timezone.
  const originalTZ = process.env.TZ;

  beforeEach(() => {
    process.env.TZ = 'America/New_York';
  });

  afterEach(() => {
    process.env.TZ = originalTZ;
  });

  it('does not skip or repeat a day across the spring-forward transition', () => {
    // Clocks jump 02:00 -> 03:00 on 2026-03-08 in America/New_York.
    expect(addDays('2026-03-07', 1)).toBe('2026-03-08');
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09');
    expect(dayKeysBetween('2026-03-06', '2026-03-10')).toEqual([
      '2026-03-06',
      '2026-03-07',
      '2026-03-08',
      '2026-03-09',
      '2026-03-10',
    ]);
  });

  it('does not skip or repeat a day across the fall-back transition', () => {
    // Clocks fall 02:00 -> 01:00 on 2026-11-01 in America/New_York.
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02');
    expect(dayKeysBetween('2026-10-30', '2026-11-02')).toEqual([
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
    ]);
  });
});
