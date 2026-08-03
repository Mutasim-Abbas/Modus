/**
 * A real v2 localStorage payload — not a hand-written fixture that happens to match
 * this migration's assumptions.
 *
 * Provenance: captured on 2026-08-01 by running the actual, unmodified pre-v3
 * `src/lib/store.ts` (git commit c37862e, `SCHEMA_VERSION = 2`) through its real public
 * API — `createStore(defaultState())`, then `setProfile`, four `addEntry` calls across
 * two days/three meal slots/all three `EntrySource` values (`food-db` with and without
 * a `foodId`, `scan`, `manual`), then `setSettings` — and reading back `store.exportJSON()`
 * verbatim. This is exactly what `JSON.stringify(state)` produces from real user actions
 * on the shipped v2 app; nothing here was typed by hand to make a test pass.
 *
 * See the project plan P3.2's acceptance criterion: migration must be proven against a
 * captured real v2 payload, not an invented one.
 */
export const V2_PAYLOAD = {
  version: 2,
  profile: {
    sex: 'female',
    age: 27,
    heightCm: 165,
    weightKg: 61,
    activity: 'light',
    goal: 'cut',
  },
  targets: {
    bmr: 1345,
    tdee: 1849,
    kcal: 1481,
    protein: 134,
    carbs: 144,
    fat: 41,
  },
  days: {
    '2026-07-20': {
      date: '2026-07-20',
      entries: [
        {
          foodId: 'chicken-breast',
          name: 'Chicken breast, cooked',
          grams: 150,
          kcal: 248,
          protein: 46.5,
          carbs: 0,
          fat: 5.4,
          meal: 'lunch',
          source: 'food-db',
          id: 'c8671cc6-09c5-4c69-b2c7-7d8edf794a6d',
          loggedAt: 1785546755096,
        },
        {
          name: 'Grilled salmon with rice (scan)',
          grams: 320,
          kcal: 540,
          protein: 38,
          carbs: 52,
          fat: 18,
          meal: 'dinner',
          source: 'scan',
          id: '4d757650-086c-47b8-9654-e2338ae0b6b0',
          loggedAt: 1785546755096,
        },
      ],
    },
    '2026-07-21': {
      date: '2026-07-21',
      entries: [
        {
          name: 'Homemade lentil soup',
          grams: 400,
          kcal: 260,
          protein: 14,
          carbs: 38,
          fat: 5,
          meal: 'lunch',
          source: 'manual',
          id: '52ab57f9-e537-4484-8911-71f4c64d7652',
          loggedAt: 1785546755096,
        },
        {
          foodId: 'simit',
          name: 'Simit',
          grams: 90,
          kcal: 275,
          protein: 8,
          carbs: 52,
          fat: 4,
          meal: 'breakfast',
          source: 'food-db',
          id: 'bbb1d3b0-635c-4f62-bed5-bf9b95b643bc',
          loggedAt: 1785546755096,
        },
      ],
    },
  },
  settings: {
    units: 'metric',
    reducedMotion: true,
  },
} as const;
