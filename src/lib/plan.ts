import type { Food, Goal, Macros, MealSlot, Targets } from '@/types';
import { FOODS } from '@/data/foods';
import { macrosForGrams, sumMacros } from '@/lib/macros';

/**
 * Rule-based day planner — deterministic, pure, and explicitly NOT AI.
 *
 * How it works, in plain terms (the UI says the same):
 *  1. Split the day's calorie target across meals by fixed shares.
 *  2. For each meal, pick a template (a protein + a carb + a vegetable/extra) from a
 *     goal-appropriate shortlist of real foods in the database.
 *  3. Scale the portions so the meal lands near its calorie share, respecting sane
 *     per-food gram limits.
 *
 * It is a starting point built from arithmetic and a hand-written shortlist. It is not
 * nutrition advice, and it does not "learn" anything.
 */

export const MEAL_KCAL_SHARE: Record<MealSlot, number> = {
  breakfast: 0.25,
  lunch: 0.35,
  dinner: 0.3,
  snack: 0.1,
};

export interface PlanItem {
  food: Food;
  grams: number;
  macros: Macros;
}

export interface PlannedMeal {
  slot: MealSlot;
  items: PlanItem[];
  totals: Macros;
  targetKcal: number;
}

export interface DayPlan {
  meals: PlannedMeal[];
  totals: Macros;
  target: Macros;
  /** Plain-English description of the rules used, shown in the UI. */
  rationale: string;
}

interface MealTemplate {
  slot: MealSlot;
  /** Food ids: [anchor (scaled to fit), ...supporting (fixed sensible portions)] */
  foodIds: string[];
}

/**
 * Shortlists per goal. Cut favours high-protein, high-volume, lower-energy foods;
 * bulk favours calorie-dense staples. Hand-picked from data/foods.ts by id.
 */
const TEMPLATES: Record<Goal, MealTemplate[]> = {
  cut: [
    { slot: 'breakfast', foodIds: ['egg-whole', 'greek-yogurt-0', 'strawberries'] },
    { slot: 'lunch', foodIds: ['chicken-breast', 'bulgur-cooked', 'broccoli'] },
    { slot: 'dinner', foodIds: ['cod', 'potato-boiled', 'cacik'] },
    { slot: 'snack', foodIds: ['apple', 'almonds'] },
  ],
  maintain: [
    { slot: 'breakfast', foodIds: ['oats-dry', 'milk-whole', 'banana'] },
    { slot: 'lunch', foodIds: ['chicken-thigh', 'rice-white-cooked', 'kisir'] },
    { slot: 'dinner', foodIds: ['salmon', 'quinoa-cooked', 'green-beans'] },
    { slot: 'snack', foodIds: ['greek-yogurt', 'walnuts'] },
  ],
  bulk: [
    { slot: 'breakfast', foodIds: ['menemen', 'simit', 'ayran'] },
    { slot: 'lunch', foodIds: ['beef-mince-lean', 'pilav-rice-butter', 'hummus'] },
    { slot: 'dinner', foodIds: ['tavuk-sis', 'pasta-cooked', 'olive-oil'] },
    { slot: 'snack', foodIds: ['peanut-butter', 'dates', 'milk-whole'] },
  ],
};

/** Sane gram bounds so the planner never suggests 900 g of olive oil to hit a number. */
const GRAM_LIMITS: Record<string, { min: number; max: number }> = {
  'olive-oil': { min: 5, max: 20 },
  'peanut-butter': { min: 15, max: 60 },
  almonds: { min: 15, max: 40 },
  walnuts: { min: 15, max: 40 },
  dates: { min: 24, max: 96 },
  hummus: { min: 30, max: 100 },
  ayran: { min: 200, max: 300 },
  simit: { min: 50, max: 120 },
  'milk-whole': { min: 100, max: 300 },
};

const DEFAULT_LIMITS = { min: 40, max: 400 };

function limitsFor(foodId: string): { min: number; max: number } {
  return GRAM_LIMITS[foodId] ?? DEFAULT_LIMITS;
}

/** Rounds to the nearest 5 g — the planner should not pretend to 1 g precision. */
function roundGrams(grams: number): number {
  return Math.max(5, Math.round(grams / 5) * 5);
}

function planMeal(template: MealTemplate, mealKcal: number, foods: readonly Food[]): PlannedMeal {
  const resolved = template.foodIds
    .map((id) => foods.find((food) => food.id === id))
    .filter((food): food is Food => food !== undefined);

  if (resolved.length === 0) {
    return { slot: template.slot, items: [], totals: sumMacros([]), targetKcal: mealKcal };
  }

  // Supporting foods take a fixed, sensible portion first...
  const supporting = resolved.slice(1).map((food) => {
    const portion = food.commonPortions[0];
    const limits = limitsFor(food.id);
    const grams = roundGrams(Math.min(limits.max, Math.max(limits.min, portion?.grams ?? 100)));
    return { food, grams, macros: macrosForGrams(food, grams) };
  });

  // ...then the anchor is scaled to fill whatever calories remain in this meal.
  const anchor = resolved[0];
  if (!anchor) {
    return { slot: template.slot, items: supporting, totals: sumMacros(supporting.map((i) => i.macros)), targetKcal: mealKcal };
  }

  const supportingKcal = supporting.reduce((sum, item) => sum + item.macros.kcal, 0);
  const remainingKcal = Math.max(0, mealKcal - supportingKcal);
  const anchorLimits = limitsFor(anchor.id);

  const rawGrams = anchor.kcal > 0 ? (remainingKcal / anchor.kcal) * 100 : anchorLimits.min;
  const grams = roundGrams(Math.min(anchorLimits.max, Math.max(anchorLimits.min, rawGrams)));

  const items: PlanItem[] = [
    { food: anchor, grams, macros: macrosForGrams(anchor, grams) },
    ...supporting,
  ];

  return {
    slot: template.slot,
    items,
    totals: sumMacros(items.map((item) => item.macros)),
    targetKcal: Math.round(mealKcal),
  };
}

const RATIONALE: Record<Goal, string> = {
  cut: 'Built for a cut: lean protein anchors every meal, with high-volume vegetables and fruit to keep the calories down.',
  maintain:
    'Built to maintain: balanced meals around your calorie target, with protein spread evenly across the day.',
  bulk: 'Built for a bulk: calorie-dense staples and generous carbs to make the surplus easier to eat.',
};

/**
 * Produces a goal-appropriate day of meals from the food database.
 * Deterministic: the same targets always produce the same plan.
 */
export function buildDayPlan(
  targets: Targets,
  goal: Goal,
  foods: readonly Food[] = FOODS,
): DayPlan {
  const templates = TEMPLATES[goal] ?? TEMPLATES.maintain;
  const kcalTarget = Math.max(0, targets.kcal);

  const meals = templates.map((template) =>
    planMeal(template, kcalTarget * MEAL_KCAL_SHARE[template.slot], foods),
  );

  return {
    meals,
    totals: sumMacros(meals.map((meal) => meal.totals)),
    target: { kcal: targets.kcal, protein: targets.protein, carbs: targets.carbs, fat: targets.fat },
    rationale: RATIONALE[goal] ?? RATIONALE.maintain,
  };
}
