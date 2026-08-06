import { useMemo, useState } from 'react';
import type { DayKey, Food } from '@/types';
import { FOODS } from '@/data/foods';
import { macrosForGrams } from '@/lib/macros';
import { selectCustomFoods } from '@/lib/store';
import { useAppState, useStore } from '@/lib/useStore';
import { cn } from '@/lib/cn';
import { MEAL_LABELS, suggestMeal } from '@/features/log/meals';
import { selectRecentFoodRefs } from '@/features/log/recentFoods';

const MAX_ITEMS = 8;

interface QuickAddRowProps {
  /** The day being logged to — Today's dashboard, so always today's key. */
  day: DayKey;
}

/**
 * The phone mock's quick-add strip: a horizontally scrolling row of the foods you have
 * logged most recently, each a one-tap re-add at the portion you used last time.
 *
 * This is a shortcut, never the only route — everything here is also reachable through
 * `/log`'s "Recent" view, which is where you go to change the portion. Renders nothing at
 * all when there is no history to offer rather than showing an empty rail, and it is the
 * caller's job to mount this on phone only (the desktop mock puts the 14-day chart in
 * this slot instead).
 */
export function QuickAddRow({ day }: QuickAddRowProps): JSX.Element | null {
  const state = useAppState();
  const store = useStore();
  const [confirmation, setConfirmation] = useState<string | null>(null);

  const items = useMemo(() => {
    const customFoods = selectCustomFoods(state);
    const allFoods: Food[] = [...FOODS, ...customFoods];

    return selectRecentFoodRefs(state, day)
      .map((ref) => {
        const food = allFoods.find((item) => item.id === ref.foodId);
        // A food can vanish from under a recent entry — a custom food the user deleted.
        // The entry keeps its own copied macros, but there is nothing left to re-add.
        if (!food) return null;
        return { food, grams: ref.lastGrams };
      })
      .filter((item): item is { food: Food; grams: number } => item !== null)
      .slice(0, MAX_ITEMS);
  }, [state, day]);

  if (items.length === 0) return null;

  const handleAdd = (food: Food, grams: number): void => {
    const meal = suggestMeal();
    const macros = macrosForGrams(food, grams);
    store.addEntry(
      {
        foodId: food.id,
        name: food.name,
        grams,
        kcal: macros.kcal,
        protein: macros.protein,
        carbs: macros.carbs,
        fat: macros.fat,
        meal,
        // 'food-db' for custom foods too, matching `LogScreen`'s own quick-add — the
        // union has no 'custom' member, and `foodId` is what distinguishes them anyway.
        source: 'food-db',
      },
      day,
    );
    setConfirmation(`${food.name} added to ${MEAL_LABELS[meal]}.`);
  };

  // The mock gives this rail no heading — the cards read as what they are, and a
  // tracked-out label above them only costs vertical space on a 402 px screen. The
  // accessible name lives on the list instead, so it is still announced.
  return (
    <section className="flex flex-col">
      {/* No negative-margin bleed: the mock keeps this rail inside the page's own
          padding, and pulling it to the screen edges made the document 3px wider than
          the viewport — the shell pads by 20px but the bleed assumed 16px, so the row
          hung past the right edge and every `fixed inset-0` layer stretched with it. */}
      <ul aria-label="Log a recent food again" className="flex gap-2.5 overflow-x-auto pb-1">
        {items.map(({ food, grams }) => {
          const kcal = Math.round(macrosForGrams(food, grams).kcal);
          return (
            <li key={food.id} className="flex-none">
              <button
                type="button"
                onClick={() => handleAdd(food, grams)}
                aria-label={`Log ${food.name} again, ${Math.round(grams)} grams, ${kcal} kcal`}
                className="flex min-h-[64px] flex-col items-start gap-1.5 rounded-[18px] border border-fm-border-neutral bg-fm-surface-2/90 px-3.5 py-3 text-start transition-colors duration-2 ease-out hover:bg-fm-hover active:bg-fm-accent-quiet"
              >
                <span className="max-w-[148px] truncate text-[12.5px] font-semibold text-fm-text">
                  {food.name}
                </span>
                <span className="text-[10.5px] tabular-nums text-fm-text-faint">
                  {Math.round(grams)} g · {kcal} kcal
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {/* One persistent live region, matching `LogScreen`: it has to be in the DOM before
          the text changes for the announcement to land. */}
      <p
        role="status"
        aria-live="polite"
        className={cn(
          confirmation
            ? 'rounded-md border border-[color:var(--success)]/40 bg-success/10 px-3 py-2.5 text-xs font-medium text-success'
            : 'sr-only',
        )}
      >
        {confirmation}
      </p>
    </section>
  );
}
