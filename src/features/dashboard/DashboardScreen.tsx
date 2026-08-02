import { useMemo } from 'react';
import { ClipboardList, Plus, UtensilsCrossed } from 'lucide-react';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { MacroBar, MacroRing } from '@/components/MacroRing';
import { LinkButton } from '@/components/LinkButton';
import { remainingMacros, sumMacros } from '@/lib/macros';
import { selectDay } from '@/lib/store';
import { toDayKey } from '@/lib/date';
import { useAppState } from '@/lib/useStore';
import { MealList } from '@/features/log/MealList';
import { MEAL_ORDER } from '@/features/log/meals';
import { SyncChip } from '@/features/sync/SyncChip';

export function DashboardScreen(): JSX.Element {
  const state = useAppState();
  const today = toDayKey();

  const day = useMemo(() => selectDay(state, today), [state, today]);
  const consumed = useMemo(() => sumMacros(day.entries), [day.entries]);

  // RequireProfile guarantees a profile; targets are derived alongside it.
  const targets = state.targets;
  if (!targets) return <></>;

  const remaining = remainingMacros(targets, consumed);
  const hasEntries = day.entries.length > 0;

  return (
    <div className="flex flex-col gap-5 lg:grid lg:grid-cols-12 lg:items-start lg:gap-6">
      <header className="lg:col-span-12">
        <div className="flex items-center justify-between">
          <span className="eyebrow">Today</span>
          <div className="lg:hidden">
            <SyncChip />
          </div>
        </div>
        <h1 className="text-2xl font-extrabold leading-tight">
          {remaining.kcal > 0 ? (
            <>
              <span className="tabular-nums">{remaining.kcal}</span> kcal left
            </>
          ) : (
            'Target reached'
          )}
        </h1>
        <p className="mt-1 text-sm text-gray">
          {Math.round(consumed.kcal)} of {targets.kcal} kcal logged
        </p>
      </header>

      {/* Desktop bento (docs/DESIGN.md §7.2): the ring is the hero on the inline-start,
          quick actions and today's meals share the wider inline-end column — a real
          two-column layout, not the phone stack simply stretched wide. */}
      <Card className="flex flex-col items-center gap-5 lg:col-span-5">
        <MacroRing
          consumed={consumed.kcal}
          target={targets.kcal}
          label="Calories"
          unit="kcal"
          color="var(--gold)"
          size={148}
        />

        <div className="grid w-full gap-3">
          <MacroBar
            consumed={consumed.protein}
            target={targets.protein}
            label="Protein"
            color="var(--protein)"
          />
          <MacroBar
            consumed={consumed.carbs}
            target={targets.carbs}
            label="Carbs"
            color="var(--carbs)"
          />
          <MacroBar consumed={consumed.fat} target={targets.fat} label="Fat" color="var(--fat)" />
        </div>
      </Card>

      <div className="flex flex-col gap-4 lg:col-span-7">
        <div className="grid grid-cols-2 gap-3">
          <LinkButton to="/log">
            <Plus size={18} aria-hidden="true" />
            Log food
          </LinkButton>
          <LinkButton to="/plan" variant="secondary">
            <ClipboardList size={18} aria-hidden="true" />
            Day plan
          </LinkButton>
        </div>

        <section aria-labelledby="today-meals">
          <h2 id="today-meals" className="mb-3 text-base font-bold">
            Today’s meals
          </h2>

          {hasEntries ? (
            <div className="flex flex-col gap-4">
              {MEAL_ORDER.map((slot) => (
                <MealList key={slot} slot={slot} date={today} entries={day.entries} />
              ))}
            </div>
          ) : (
            /* No action button here: the "Log food" quick action sits directly above,
               and two identical CTAs on one screen is noise, not helpfulness. */
            <EmptyState
              icon={UtensilsCrossed}
              title="Nothing logged yet"
              description="Search the food database and add your first portion — your rings fill as you go."
            />
          )}
        </section>
      </div>
    </div>
  );
}
