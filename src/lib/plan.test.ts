import { describe, expect, it } from 'vitest';
import type { Goal, Targets } from '@/types';
import { MEAL_KCAL_SHARE, buildDayPlan } from '@/lib/plan';
import { calculateTargets } from '@/lib/macros';
import { FOOD_BY_ID } from '@/data/foods';

const targetsFor = (goal: Goal): Targets =>
  calculateTargets({ sex: 'male', age: 30, heightCm: 180, weightKg: 80, activity: 'moderate', goal });

const GOALS: Goal[] = ['cut', 'maintain', 'bulk'];

describe('meal shares', () => {
  it('splits the day into shares that add up to 100%', () => {
    const total = Object.values(MEAL_KCAL_SHARE).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 5);
  });
});

describe('buildDayPlan', () => {
  it('produces four meals for every goal', () => {
    for (const goal of GOALS) {
      const plan = buildDayPlan(targetsFor(goal), goal);
      expect(plan.meals.map((m) => m.slot)).toEqual(['breakfast', 'lunch', 'dinner', 'snack']);
    }
  });

  it('only ever uses foods that exist in the database', () => {
    for (const goal of GOALS) {
      const plan = buildDayPlan(targetsFor(goal), goal);
      for (const meal of plan.meals) {
        expect(meal.items.length).toBeGreaterThan(0);
        for (const item of meal.items) {
          expect(FOOD_BY_ID.has(item.food.id), `unknown food: ${item.food.id}`).toBe(true);
        }
      }
    }
  });

  it('lands within a reasonable distance of the calorie target', () => {
    for (const goal of GOALS) {
      const targets = targetsFor(goal);
      const plan = buildDayPlan(targets, goal);
      const drift = Math.abs(plan.totals.kcal - targets.kcal) / targets.kcal;
      // Portion limits keep the planner honest, so it won't hit the target exactly.
      expect(drift, `${goal} drifted ${Math.round(drift * 100)}%`).toBeLessThan(0.25);
    }
  });

  it('scales with the calorie target: a bulk plan has more calories than a cut plan', () => {
    const cut = buildDayPlan(targetsFor('cut'), 'cut');
    const bulk = buildDayPlan(targetsFor('bulk'), 'bulk');
    expect(bulk.totals.kcal).toBeGreaterThan(cut.totals.kcal);
  });

  it('is deterministic', () => {
    const targets = targetsFor('maintain');
    expect(buildDayPlan(targets, 'maintain')).toEqual(buildDayPlan(targets, 'maintain'));
  });

  it('gives a cut plan a higher protein share than a bulk plan', () => {
    const cut = buildDayPlan(targetsFor('cut'), 'cut');
    const bulk = buildDayPlan(targetsFor('bulk'), 'bulk');

    const proteinShare = (kcal: number, protein: number): number => (protein * 4) / kcal;
    expect(proteinShare(cut.totals.kcal, cut.totals.protein)).toBeGreaterThan(
      proteinShare(bulk.totals.kcal, bulk.totals.protein),
    );
  });

  it('uses sane portion sizes — no 900 g of olive oil', () => {
    for (const goal of GOALS) {
      const plan = buildDayPlan(targetsFor(goal), goal);
      for (const meal of plan.meals) {
        for (const item of meal.items) {
          expect(item.grams, `${item.food.id}`).toBeGreaterThan(0);
          expect(item.grams, `${item.food.id} portion too large`).toBeLessThanOrEqual(400);
          if (item.food.id === 'olive-oil') expect(item.grams).toBeLessThanOrEqual(20);
        }
      }
    }
  });

  it('rounds portions to 5 g — it does not pretend to 1 g precision', () => {
    const plan = buildDayPlan(targetsFor('maintain'), 'maintain');
    for (const meal of plan.meals) {
      for (const item of meal.items) {
        expect(item.grams % 5, `${item.food.id} = ${item.grams} g`).toBe(0);
      }
    }
  });

  it('reports meal totals that equal the sum of the items', () => {
    const plan = buildDayPlan(targetsFor('maintain'), 'maintain');
    for (const meal of plan.meals) {
      const summed = meal.items.reduce((total, item) => total + item.macros.kcal, 0);
      expect(meal.totals.kcal).toBeCloseTo(summed, 5);
    }
  });

  it('reports a day total that equals the sum of the meals', () => {
    const plan = buildDayPlan(targetsFor('cut'), 'cut');
    const summed = plan.meals.reduce((total, meal) => total + meal.totals.kcal, 0);
    expect(plan.totals.kcal).toBeCloseTo(summed, 5);
  });

  it('describes its own reasoning honestly, without claiming AI', () => {
    for (const goal of GOALS) {
      const plan = buildDayPlan(targetsFor(goal), goal);
      expect(plan.rationale.length).toBeGreaterThan(10);
      expect(plan.rationale.toLowerCase()).not.toContain('ai ');
    }
  });

  it('never produces NaN or negative macros', () => {
    for (const goal of GOALS) {
      const plan = buildDayPlan(targetsFor(goal), goal);
      for (const value of Object.values(plan.totals)) {
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('degrades gracefully when the database is missing the templated foods', () => {
    const plan = buildDayPlan(targetsFor('cut'), 'cut', []);
    expect(plan.meals).toHaveLength(4);
    for (const meal of plan.meals) expect(meal.items).toEqual([]);
    expect(plan.totals.kcal).toBe(0);
  });

  it('handles a zero calorie target without dividing by zero', () => {
    const zeroTargets: Targets = { bmr: 0, tdee: 0, kcal: 0, protein: 0, carbs: 0, fat: 0 };
    const plan = buildDayPlan(zeroTargets, 'maintain');
    for (const value of Object.values(plan.totals)) expect(Number.isFinite(value)).toBe(true);
  });
});
