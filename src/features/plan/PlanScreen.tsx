import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Calculator, Plus, ScanLine } from 'lucide-react';
import type { Goal, MealSlot } from '@/types';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { LinkButton } from '@/components/LinkButton';
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

/** The mock's shortcut list — the other ways into the same three destinations. */
const SHORTCUTS: readonly { to: string; label: string }[] = [
  { to: '/log', label: 'Browse the full food list' },
  { to: '/history', label: 'Look back at earlier days' },
  { to: '/profile', label: 'Recompute my targets' },
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
        eyebrow="Coach"
        title="Plan it or scan it"
        subtitle="A rule-based day built from the food database, plus photo estimation you edit before anything is logged."
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

      {/* The mock's Coach: the generated day on the inline-start, the two other ways into
          a log entry — scan, and the shortcuts — stacked on the inline-end. */}
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(340px,1.15fr)_minmax(300px,0.85fr)]">
        <Card>
          <div className="mb-2 flex items-center justify-between gap-3">
            <h2 className="text-base font-bold">A day built for you</h2>
            <span className="whitespace-nowrap rounded-full border border-fm-border-neutral bg-white/[0.05] px-3 py-1.5 text-[10.5px] font-semibold text-fm-text-subtle">
              Rule-based, not AI
            </span>
          </div>
          <p className="mb-5 text-[12.5px] leading-relaxed text-fm-text-faint">
            Your target is split across meals, then real foods from the database are scaled to
            fit.
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

          <div className="mt-4 flex items-baseline justify-between rounded-lg border border-fm-border-strong bg-fm-accent-quiet px-4 py-3.5">
            <span className="text-[12.5px] font-semibold text-fm-text-muted">Plan total</span>
            <span className="font-num text-base font-bold tabular-nums">
              {Math.round(plan.totals.kcal)}
              <span className="ms-1 text-[11px] font-normal text-fm-text-faint">
                / {targets.kcal} kcal
              </span>
            </span>
          </div>

          <div className="mt-3.5 flex flex-col gap-3.5">
            {plan.meals.map((meal) => (
              <section
                key={meal.slot}
                aria-labelledby={`plan-${meal.slot}`}
                className="rounded-lg border border-fm-border-neutral bg-white/[0.028] p-[18px]"
              >
                <div className="mb-3 flex items-baseline justify-between gap-3">
                  <h3 id={`plan-${meal.slot}`} className="text-sm font-bold text-white">
                    {MEAL_LABELS[meal.slot]}
                  </h3>
                  <span className="font-num text-xs tabular-nums text-fm-text-faint">
                    {Math.round(meal.totals.kcal)} kcal
                  </span>
                </div>

                <ul className="mb-3.5 flex flex-col gap-[7px]">
                  {meal.items.map((item) => (
                    <li key={item.food.id} className="flex items-center justify-between gap-3">
                      <span className="min-w-0 truncate text-[13px] text-fm-text-muted">
                        {item.food.name}
                      </span>
                      <span className="whitespace-nowrap font-num text-[11.5px] tabular-nums text-fm-text-faint">
                        {item.grams} g · {item.macros.kcal} kcal
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

          <p className="mt-4 flex gap-2 text-[11px] leading-relaxed text-fm-text-faint">
            <Calculator size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
            This planner is arithmetic over a hand-picked shortlist — it is a starting point, not
            nutrition advice, and it does not know your preferences or allergies.{' '}
            {FOOD_DATA_DISCLAIMER}
          </p>
        </Card>

        <div className="flex flex-col gap-5">
          <section className="relative overflow-hidden rounded-xl border border-fm-border-neutral bg-card-cyan p-7 text-center">
            <div className="mx-auto mb-[18px] grid h-16 w-16 place-items-center rounded-lg border border-fm-accent-2/30 bg-fm-accent-2-quiet text-fm-accent-2-ink">
              <ScanLine size={26} aria-hidden="true" />
            </div>
            <h2 className="text-[17px] font-bold">Scan a meal</h2>
            <p className="mb-5 mt-2.5 text-[12.5px] leading-relaxed text-fm-text-faint">
              Photo → estimate →{' '}
              <strong className="font-semibold text-fm-text-muted">you edit every number</strong> →
              logged. Nothing is saved until you confirm.
            </p>
            <LinkButton to="/scan" variant="cyan" className="w-full">
              Take or upload a photo
            </LinkButton>
            <p className="mt-3.5 text-[10.5px] leading-relaxed text-fm-text-faint">
              JPEG, PNG or WebP under 5 MB. Your photo is analysed, never stored.
            </p>
          </section>

          <Card>
            <h2 className="mb-3.5 text-sm font-bold">Shortcuts</h2>
            <div className="flex flex-col gap-2.5">
              {SHORTCUTS.map((shortcut) => (
                <Link
                  key={shortcut.to}
                  to={shortcut.to}
                  className="flex min-h-[48px] items-center justify-between gap-3 rounded-md border border-fm-border-neutral bg-white/[0.028] px-4 text-[13px] font-semibold text-fm-text-muted transition-colors duration-2 hover:bg-fm-accent-quiet"
                >
                  <span>{shortcut.label}</span>
                  <ArrowRight size={16} className="text-fm-text-faint" aria-hidden="true" />
                </Link>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
