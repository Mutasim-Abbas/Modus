import { describe, expect, it } from 'vitest';
import { parsePullResult } from '@/lib/sync/wire';

/**
 * docs/API.md, "Numeric fields are decimal strings, not numbers — on the wire, both
 * ways": every macro/weight/height field arrives on pull as an exact decimal string
 * (Postgres `numeric`). This file proves the round trip never introduces float drift —
 * the exact case that would silently corrupt calorie/macro totals over time.
 */
describe('parsePullResult — decimal-string wire format', () => {
  it('parses exact decimal strings to numbers with no drift', () => {
    const result = parsePullResult({
      cursor: {},
      hasMore: {},
      profile: null,
      settings: null,
      entries: [
        {
          id: 'e1',
          day: '2026-03-12',
          name: 'Chicken breast',
          grams: '150.00',
          kcal: '248.00',
          protein: '46.50',
          carbs: '0.00',
          fat: '5.40',
          meal: 'lunch',
          source: 'food-db',
          foodId: 'chicken-breast',
          loggedAt: 1773316800000,
          updatedAt: '2026-03-12T14:02:00.000Z',
          deletedAt: null,
        },
      ],
      weights: [
        {
          id: 'w1',
          day: '2026-03-12',
          weightKg: '81.50',
          updatedAt: '2026-03-12T07:00:00.000Z',
          deletedAt: null,
        },
      ],
      customFoods: [],
      favourites: [],
      counts: {},
    });

    expect(result.entries[0]?.grams).toBe(150);
    expect(result.entries[0]?.kcal).toBe(248);
    expect(result.entries[0]?.protein).toBe(46.5);
    expect(result.entries[0]?.carbs).toBe(0);
    expect(result.entries[0]?.fat).toBe(5.4);
    expect(result.weights[0]?.weightKg).toBe(81.5);
  });

  it('never produces float drift for values with awkward binary representations', () => {
    // 0.1 + 0.2 !== 0.3 in IEEE754 — proving Number("...") of the exact decimal string
    // the server sent avoids ever performing that kind of arithmetic on the wire value.
    const result = parsePullResult({
      entries: [
        {
          id: 'e1',
          day: '2026-01-01',
          name: 'Test',
          grams: '100.10',
          kcal: '10.30',
          protein: '0.10',
          carbs: '0.20',
          fat: '0.00',
          meal: 'snack',
          source: 'manual',
          foodId: null,
          loggedAt: 1,
          updatedAt: '2026-01-01T00:00:00.000Z',
          deletedAt: null,
        },
      ],
    });
    const entry = result.entries[0];
    expect(entry?.protein).toBe(0.1);
    expect(entry?.carbs).toBe(0.2);
    expect((entry?.protein ?? 0) + (entry?.carbs ?? 0)).toBeCloseTo(0.3, 10);
  });

  it('degrades a malformed row to being dropped rather than crashing', () => {
    const result = parsePullResult({
      entries: [{ id: 'e1' /* missing updatedAt */ }, null, 'not an object', { id: '', updatedAt: '2026-01-01' }],
    });
    expect(result.entries).toEqual([]);
  });

  it('handles a completely malformed body (e.g. a wrong-shaped success response) without throwing', () => {
    expect(() => parsePullResult({ user: { id: 'u1' } })).not.toThrow();
    expect(() => parsePullResult(null)).not.toThrow();
    expect(() => parsePullResult('nonsense')).not.toThrow();
    const result = parsePullResult(undefined);
    expect(result.entries).toEqual([]);
    expect(result.counts.entries.total).toBe(0);
  });
});
