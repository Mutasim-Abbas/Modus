import { useMemo, useState } from 'react';
import { Calculator, Plus } from 'lucide-react';
import type { Goal, MealSlot } from '@/types';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Segmented } from '@/components/Segmented';
import { buildDayPlan } from '@/lib/plan';
import { calculateTargets } from '@/lib/macros';
import { toDayKey } from '@/lib/date';
import { useAppState, useStore } from '@/lib/useStore';
import { MEAL_LABELS } from '@/features/log/meals';
import { FOOD_DATA_DISCLAIMER } from '@/data/foods';

const GOAL_OPTIONS: { value: Goal; label: string }[] = [
  { value: 'cut', label: 'Cut' },
  { value: 'maintain', label: 'Maintain' },
  { value: 'bulk', label: 'Bulk' },
];

export function PlanScreen(): JSX.Element {
  const state = useAppState();
  const store = useStore();
  const profile = state.profile;
  const [goal, setGoal] = useState<Goal>(profile?.goal ?? 'maintain');
  const [added, setAdded] = useState<string | null>(null);

  // Preview another goal without changing the user's saved profile.
  const targets = useMemo(
    () => (profile ? calculateTargets({ ...profile, goal }) : null),
    [profile, goal],
  );

  const plan = useMemo(() => (targets ? buildDayPlan(targets, goal) : null), [targets, goal]);

  if (!plan || !targets) return <></>;

  const addMeal = (slot: MealSlot): void => {
    const meal = plan.meals.find((m) => m.slot === slot);
    if (!meal) return;

    for (const item of meal.items) {
      store.addEntry(
        {
          foodId: item.food.id,
          name: item.food.name,
          grams: item.grams,
          kcal: item.macros.kcal,
          protein: item.macros.protein,
          carbs: item.macros.carbs,
          fat: item.macros.fat,
          meal: slot,
          source: 'food-db',
        },
        toDayKey(),
      );
    }
    setAdded(`${MEAL_LABELS[slot]} added to today’s log.`);
  };

  return (
    <div className="flex flex-col gap-4">
      <ScreenHeader
        eyebrow="Day plan"
        title="A day built from the food database"
        subtitle="Rule-based, not AI: your calorie target is split across meals, then real foods from the database are scaled to fit."
      />

      {/* Single persistent live region — see LogScreen for why it is not duplicated. */}
      <p
        role="status"
        aria-live="polite"
        className={
          added
            ? 'rounded-md border border-[color:var(--success)]/40 bg-success/10 px-3 py-2.5 text-xs font-medium text-success'
            : 'sr-only'
        }
      >
        {added}
      </p>

      <Segmented
        legend="Plan for goal"
        options={GOAL_OPTIONS}
        value={goal}
        onChange={(value) => {
          setGoal(value);
          setAdded(null);
        }}
        columns={3}
      />

      <Card className="border-[color:var(--border-strong)]">
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-semibold text-gray">Plan total</span>
          <span className="text-xl font-extrabold tabular-nums">
            {Math.round(plan.totals.kcal)}
            <span className="ms-1 text-xs font-normal text-gray">
              / {targets.kcal} kcal target
            </span>
          </span>
        </div>
        <p className="mt-1 text-xs text-gray tabular-nums">
          P {Math.round(plan.totals.protein)} g · C {Math.round(plan.totals.carbs)} g · F{' '}
          {Math.round(plan.totals.fat)} g
        </p>
        <p className="mt-3 text-[11px] leading-relaxed text-gray-soft">{plan.rationale}</p>
      </Card>

      <div className="flex flex-col gap-4">
        {plan.meals.map((meal) => (
          <section key={meal.slot} aria-labelledby={`plan-${meal.slot}`}>
            <div className="mb-2 flex items-baseline justify-between">
              <h2 id={`plan-${meal.slot}`} className="text-sm font-bold text-white">
                {MEAL_LABELS[meal.slot]}
              </h2>
              <span className="text-xs text-gray tabular-nums">
                {Math.round(meal.totals.kcal)} kcal
                <span className="text-gray-soft"> · target {meal.targetKcal}</span>
              </span>
            </div>

            <ul className="mb-2 flex flex-col gap-2">
              {meal.items.map((item) => (
                <li
                  key={item.food.id}
                  className="flex items-center gap-3 rounded-md border border-[color:var(--border)] bg-surface-2/70 px-3.5 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-white">{item.food.name}</p>
                    <p className="text-[11px] text-gray tabular-nums">
                      {item.grams} g · P {item.macros.protein} · C {item.macros.carbs} · F{' '}
                      {item.macros.fat}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm font-bold tabular-nums text-gold-light">
                    {item.macros.kcal}
                  </span>
                </li>
              ))}
            </ul>

            <Button size="sm" variant="secondary" onClick={() => addMeal(meal.slot)}>
              <Plus size={16} aria-hidden="true" />
              Add {MEAL_LABELS[meal.slot].toLowerCase()} to today
            </Button>
          </section>
        ))}
      </div>

      <p className="flex gap-2 text-[11px] leading-relaxed text-gray-soft">
        <Calculator size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
        This planner is arithmetic over a hand-picked shortlist — it is a starting point, not
        nutrition advice, and it does not know your preferences or allergies. {FOOD_DATA_DISCLAIMER}
      </p>
    </div>
  );
}
