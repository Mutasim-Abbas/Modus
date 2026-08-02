import { describe, expect, it } from 'vitest';
import { FOODS, FOOD_BY_ID, getFood } from '@/data/foods';
import { KCAL_PER_GRAM } from '@/lib/macros';

/**
 * Data-integrity tests.
 *
 * These cannot prove a value is nutritionally accurate — that comes from using published
 * reference values. What they can prove is that every row is internally consistent, that
 * nothing is negative or missing, and that no macro profile is physically impossible.
 */
describe('food database — shape', () => {
  it('has a substantial curated set', () => {
    expect(FOODS.length).toBeGreaterThanOrEqual(150);
  });

  it('has unique ids', () => {
    const ids = FOODS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has unique names', () => {
    const names = FOODS.map((f) => f.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
  });

  it('uses kebab-case ids', () => {
    for (const food of FOODS) {
      expect(food.id, `${food.id} should be kebab-case`).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it('states every value per 100 g', () => {
    for (const food of FOODS) expect(food.per).toBe(100);
  });

  it('has a non-empty name for every food', () => {
    for (const food of FOODS) expect(food.name.trim().length).toBeGreaterThan(0);
  });
});

describe('food database — values', () => {
  it('has no negative or non-finite macros', () => {
    for (const food of FOODS) {
      for (const key of ['kcal', 'protein', 'carbs', 'fat'] as const) {
        expect(Number.isFinite(food[key]), `${food.id}.${key} finite`).toBe(true);
        expect(food[key], `${food.id}.${key} non-negative`).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('keeps macro mass within 100 g per 100 g of food', () => {
    for (const food of FOODS) {
      const mass = food.protein + food.carbs + food.fat;
      expect(mass, `${food.id} has ${mass} g of macros per 100 g`).toBeLessThanOrEqual(100);
    }
  });

  /**
   * Ethanol carries ~7 kcal/g but is not protein, carbs or fat, so alcoholic drinks
   * legitimately list more calories than 4/4/9 can account for. That is a fact about
   * nutrition, not a data error — these rows are checked separately below.
   */
  const ALCOHOLIC = new Set(['beer', 'wine-red']);

  const macroKcal = (food: (typeof FOODS)[number]): number =>
    food.protein * KCAL_PER_GRAM.protein +
    food.carbs * KCAL_PER_GRAM.carbs +
    food.fat * KCAL_PER_GRAM.fat;

  it('has calories that broadly reconcile with 4/4/9', () => {
    for (const food of FOODS) {
      if (ALCOHOLIC.has(food.id)) continue;

      const computed = macroKcal(food);
      // Whole foods contain fibre and water that 4/4/9 does not model, and the published
      // values are rounded — so this is a sanity bound, not an equality check.
      const tolerance = Math.max(35, computed * 0.3);
      expect(
        Math.abs(computed - food.kcal),
        `${food.id}: listed ${food.kcal} kcal vs ${Math.round(computed)} from macros`,
      ).toBeLessThanOrEqual(tolerance);
    }
  });

  it('lists alcoholic drinks with more calories than their macros alone imply', () => {
    for (const id of ALCOHOLIC) {
      const food = getFood(id);
      expect(food, `missing ${id}`).toBeDefined();
      if (!food) continue;
      // The gap is the ethanol the macro fields cannot represent.
      expect(food.kcal, `${id} should carry unaccounted alcohol calories`).toBeGreaterThan(
        macroKcal(food),
      );
    }
  });

  it('caps calories at what 100 g of pure fat could provide', () => {
    for (const food of FOODS) {
      expect(food.kcal, `${food.id} exceeds 900 kcal/100 g`).toBeLessThanOrEqual(900);
    }
  });
});

describe('food database — portions', () => {
  it('gives every food at least one common portion', () => {
    for (const food of FOODS) {
      expect(food.commonPortions.length, `${food.id} has no portions`).toBeGreaterThan(0);
    }
  });

  it('has positive, sane portion weights', () => {
    for (const food of FOODS) {
      for (const portion of food.commonPortions) {
        expect(portion.grams, `${food.id}: ${portion.label}`).toBeGreaterThan(0);
        expect(portion.grams, `${food.id}: ${portion.label}`).toBeLessThanOrEqual(1000);
        expect(portion.label.trim().length).toBeGreaterThan(0);
      }
    }
  });
});

describe('food database — coverage', () => {
  it('covers every category the app offers', () => {
    const categories = new Set(FOODS.map((f) => f.category));
    for (const expected of [
      'protein',
      'grains',
      'dairy',
      'fruit',
      'vegetables',
      'fats & nuts',
      'snacks',
      'drinks',
      'turkish & middle eastern',
    ]) {
      expect(categories.has(expected as never), `missing category: ${expected}`).toBe(true);
    }
  });

  it('includes the Turkish and Middle-Eastern staples the brief names', () => {
    for (const id of ['bulgur-cooked', 'mercimek-corbasi', 'hummus', 'labneh', 'simit', 'ayran', 'dates']) {
      expect(getFood(id), `missing staple: ${id}`).toBeDefined();
    }
  });

  it('matches known reference values for chicken breast', () => {
    const chicken = getFood('chicken-breast');
    expect(chicken).toMatchObject({ kcal: 165, protein: 31, carbs: 0, fat: 3.6 });
  });

  it('has at least 8 foods in every category', () => {
    const counts = new Map<string, number>();
    for (const food of FOODS) counts.set(food.category, (counts.get(food.category) ?? 0) + 1);

    for (const [category, count] of counts) {
      expect(count, `${category} only has ${count} foods`).toBeGreaterThanOrEqual(8);
    }
  });
});

describe('lookup', () => {
  it('finds every food by id', () => {
    for (const food of FOODS) expect(getFood(food.id)).toBe(food);
  });

  it('returns undefined for an unknown id', () => {
    expect(getFood('not-a-real-food')).toBeUndefined();
  });

  it('indexes every food exactly once', () => {
    expect(FOOD_BY_ID.size).toBe(FOODS.length);
  });
});
