import type { MealSlot } from '@/types';

/**
 * Meal-slot constants and helpers.
 *
 * Kept out of the component files so those export components only — that keeps React
 * Fast Refresh working and gives non-component consumers (tests, the planner) a module
 * to import from without pulling in JSX.
 */

export const MEAL_LABELS: Record<MealSlot, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snacks',
};

export const MEAL_ORDER: MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack'];

export const MEAL_OPTIONS = MEAL_ORDER.map((slot) => ({ value: slot, label: MEAL_LABELS[slot] }));

/** Suggests a meal slot from the time of day, so the common case is one tap. */
export function suggestMeal(date: Date = new Date()): MealSlot {
  const hour = date.getHours();
  if (hour < 11) return 'breakfast';
  if (hour < 16) return 'lunch';
  if (hour < 22) return 'dinner';
  return 'snack';
}
