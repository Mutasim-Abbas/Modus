import { parsePullCursorParam, pushRequestSchema } from './schemas.js';

const validEntry = {
  id: '018f1234-5678-7abc-8def-0123456789ab',
  deleted: false,
  day: '2026-03-12',
  name: 'Chicken breast',
  grams: 150,
  kcal: 248,
  protein: 46,
  carbs: 0,
  fat: 5,
  meal: 'lunch',
  source: 'manual',
  loggedAt: Date.parse('2026-03-12T12:00:00.000Z'),
};

describe('pushRequestSchema', () => {
  it('accepts an empty body — a no-op push is not an error', () => {
    expect(pushRequestSchema.safeParse({}).success).toBe(true);
  });

  it('rejects an unrecognised top-level field (mass-assignment guard)', () => {
    expect(pushRequestSchema.safeParse({ entries: [], userId: 'forged' }).success).toBe(false);
  });

  it('accepts a valid live entry op', () => {
    expect(pushRequestSchema.safeParse({ entries: [validEntry] }).success).toBe(true);
  });

  it('rejects an entry op carrying unexpected content fields alongside deleted: true', () => {
    const result = pushRequestSchema.safeParse({ entries: [{ ...validEntry, deleted: true }] });
    expect(result.success).toBe(false);
  });

  it('rejects a calendar-invalid day (2026 is not a leap year)', () => {
    const result = pushRequestSchema.safeParse({ entries: [{ ...validEntry, day: '2026-02-29' }] });
    expect(result.success).toBe(false);
  });

  it('accepts a calendar-valid leap day', () => {
    const result = pushRequestSchema.safeParse({ entries: [{ ...validEntry, day: '2024-02-29' }] });
    expect(result.success).toBe(true);
  });

  it('rejects a non-UUID entry id', () => {
    const result = pushRequestSchema.safeParse({ entries: [{ ...validEntry, id: 'not-a-uuid' }] });
    expect(result.success).toBe(false);
  });

  it('rejects grams/macros out of the schema.ts CHECK-constraint range', () => {
    expect(pushRequestSchema.safeParse({ entries: [{ ...validEntry, grams: -1 }] }).success).toBe(false);
    expect(pushRequestSchema.safeParse({ entries: [{ ...validEntry, kcal: 200000 }] }).success).toBe(false);
  });

  it('rejects a loggedAt far outside the sane epoch-ms bound (e.g. seconds mistaken for ms)', () => {
    const result = pushRequestSchema.safeParse({ entries: [{ ...validEntry, loggedAt: 1_772_000_000 }] });
    expect(result.success).toBe(false);
  });

  it('rejects an unrecognised meal/source/category enum value', () => {
    expect(pushRequestSchema.safeParse({ entries: [{ ...validEntry, meal: 'brunch' }] }).success).toBe(false);
  });

  it('rejects a batch over the per-table row cap', () => {
    const many = Array.from({ length: 501 }, (_, i) => ({
      ...validEntry,
      id: `018f1234-0000-7000-8000-${String(i).padStart(12, '0')}`,
    }));
    expect(pushRequestSchema.safeParse({ entries: many }).success).toBe(false);
  });

  /*
   * the internal security audit F-06 — CPU amplification. `z.array(x).max(500)` parses every element
   * BEFORE the length check fires, so a 2 MB array of junk was measured at ~0.9 s of CPU
   * and 400 001 issue objects for a request that is rejected anyway — and api/sync/* has
   * no rate limit of its own.
   *
   * Asserted by ISSUE COUNT, not by elapsed time: a wall-clock threshold would be flaky on
   * a loaded CI box, whereas "did it build one issue per element?" is the defect itself and
   * is deterministic. If the O(1) pre-check is ever removed, this count explodes and the
   * test fails — which is exactly the regression that matters.
   */
  it('rejects an over-long array in O(1) without validating every element (F-06)', () => {
    const junk = new Array(200_000).fill(0);
    const result = pushRequestSchema.safeParse({ entries: junk });
    expect(result.success).toBe(false);
    expect(result.error!.issues.length).toBeLessThanOrEqual(4);
  });

  it('applies the same O(1) gate to every row-capped table (F-06)', () => {
    for (const table of ['entries', 'weights', 'customFoods', 'favourites'] as const) {
      const result = pushRequestSchema.safeParse({ [table]: new Array(50_000).fill(0) });
      expect(result.success, `${table} must be capped`).toBe(false);
      expect(result.error!.issues.length, `${table} must not build an issue per element`).toBeLessThanOrEqual(4);
    }
  });

  it('rejects a calendar-valid year Postgres cannot store, as 400 not 500 (F-08)', () => {
    expect(pushRequestSchema.safeParse({ entries: [{ ...validEntry, day: '0000-01-01' }] }).success).toBe(false);
    expect(pushRequestSchema.safeParse({ weights: [{ id: validEntry.id, deleted: false, day: '0000-01-01', weightKg: 80 }] }).success).toBe(false);
  });

  it('accepts the full real-world day range either side of the F-08 bound', () => {
    for (const day of ['1900-01-01', '2026-03-12', '2100-12-31']) {
      expect(pushRequestSchema.safeParse({ entries: [{ ...validEntry, day }] }).success, day).toBe(true);
    }
    for (const day of ['1899-12-31', '2101-01-01']) {
      expect(pushRequestSchema.safeParse({ entries: [{ ...validEntry, day }] }).success, day).toBe(false);
    }
  });

  it('accepts a tombstone op with only id + deleted:true', () => {
    expect(
      pushRequestSchema.safeParse({ entries: [{ id: validEntry.id, deleted: true }] }).success,
    ).toBe(true);
  });

  it('accepts a valid favourite op keyed by foodId, not a uuid', () => {
    expect(pushRequestSchema.safeParse({ favourites: [{ foodId: 'chicken-breast', deleted: false }] }).success).toBe(
      true,
    );
  });

  it('rejects a custom food with more common portions than the sanity cap', () => {
    const commonPortions = Array.from({ length: 51 }, (_, i) => ({ label: `p${i}`, grams: 10 }));
    const result = pushRequestSchema.safeParse({
      customFoods: [
        {
          id: validEntry.id,
          deleted: false,
          name: 'x',
          category: 'snacks',
          kcal: 1,
          protein: 1,
          carbs: 1,
          fat: 1,
          commonPortions,
        },
      ],
    });
    expect(result.success).toBe(false);
  });
});

describe('parsePullCursorParam', () => {
  it('treats a missing cursor as a full pull, not an error', () => {
    expect(parsePullCursorParam(null)).toEqual({ ok: true, cursor: null });
  });

  it('treats an empty string as a full pull too', () => {
    expect(parsePullCursorParam('')).toEqual({ ok: true, cursor: null });
  });

  it('rejects an oversized cursor string before ever JSON.parse-ing it', () => {
    const result = parsePullCursorParam('x'.repeat(5000));
    expect(result).toEqual({ ok: false, reason: 'too_large' });
  });

  it('rejects malformed JSON', () => {
    expect(parsePullCursorParam('{not json')).toEqual({ ok: false, reason: 'invalid_input' });
  });

  it('rejects an unrecognised field (mass-assignment guard applies to the cursor too)', () => {
    const raw = JSON.stringify({ entries: null, extra: 'nope' });
    expect(parsePullCursorParam(raw)).toEqual({ ok: false, reason: 'invalid_input' });
  });

  /*
   * This test previously used `entries: { ..., id: 'abc' }` and asserted it was accepted.
   * That was not a well-formed cursor at all — `entries.id` is compared against a `uuid`
   * primary key, so `'abc'` reached Postgres and produced `500 server_error` from a
   * boundary documented as `400` (the internal security audit F-04). The test was asserting the
   * defect as intended behaviour, exactly like the F-05.1 case in §3.5. It is NOT
   * weakened here: the id is corrected to a real UUID so the test still proves what it
   * always meant to prove ("a well-formed cursor round-trips"), and the two tests below
   * pin the boundary it was accidentally holding open.
   */
  it('accepts a well-formed per-table cursor', () => {
    const cursor = {
      profile: null,
      settings: '2026-03-12T00:00:00.000Z',
      entries: { updatedAt: '2026-03-12T00:00:00.000Z', id: '018f1234-5678-7abc-8def-0123456789ab' },
      weights: null,
      customFoods: null,
      favourites: null,
    };
    expect(parsePullCursorParam(JSON.stringify(cursor))).toEqual({ ok: true, cursor });
  });

  it('rejects a non-UUID id for a uuid-keyed table as invalid_input, not a 500 (F-04)', () => {
    for (const table of ['entries', 'weights', 'customFoods'] as const) {
      const raw = JSON.stringify({ [table]: { updatedAt: '2026-03-12T00:00:00.000Z', id: 'not-a-uuid' } });
      expect(parsePullCursorParam(raw), `${table} must reject a non-uuid cursor id`).toEqual({
        ok: false,
        reason: 'invalid_input',
      });
    }
  });

  it('still accepts a bare food id for favourites, whose key is text and not a uuid (F-04)', () => {
    const cursor = { favourites: { updatedAt: '2026-03-12T00:00:00.000Z', id: 'chicken-breast' } };
    expect(parsePullCursorParam(JSON.stringify(cursor))).toEqual({ ok: true, cursor });
  });
});
