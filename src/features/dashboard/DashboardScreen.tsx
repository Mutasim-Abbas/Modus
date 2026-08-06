import { useMemo } from 'react';
import { UtensilsCrossed } from 'lucide-react';
import { BrandMark } from '@/components/BrandMark';
import { EmptyState } from '@/components/EmptyState';
import { MacroBar, MacroRing } from '@/components/MacroRing';
import { ScreenHeader } from '@/components/ScreenHeader';
import { StatTile } from '@/components/StatTile';
import { cn } from '@/lib/cn';
import { remainingMacros, sumMacros } from '@/lib/macros';
import { selectDay } from '@/lib/store';
import { formatLongDate, toDayKey } from '@/lib/date';
import { useAppState } from '@/lib/useStore';
import { MealList } from '@/features/log/MealList';
import { MEAL_ORDER } from '@/features/log/meals';
import { SyncChip } from '@/features/sync/SyncChip';
import { useShellBreakpoint } from '@/app/useBreakpoint';

const GOAL_LABEL: Record<string, string> = {
  cut: 'Cutting · −20%',
  maintain: 'Maintaining',
  bulk: 'Bulking · +15%',
};

export function DashboardScreen(): JSX.Element {
  const state = useAppState();
  const today = toDayKey();
  const breakpoint = useShellBreakpoint();
  const isPhone = breakpoint === 'phone';

  const day = useMemo(() => selectDay(state, today), [state, today]);
  const consumed = useMemo(() => sumMacros(day.entries), [day.entries]);

  // RequireProfile guarantees a profile; targets are derived alongside it.
  const targets = state.targets;
  if (!targets) return <></>;

  const remaining = remainingMacros(targets, consumed);
  const hasEntries = day.entries.length > 0;

  /**
   * Under target the headline counts down what is left; over it names the overshoot
   * plainly rather than flattening both cases into "Target reached", which read as
   * congratulation whether you had 4 kcal spare or 400 over.
   */
  const over = consumed.kcal > targets.kcal;
  const headlineNum = Math.abs(Math.round(remaining.kcal));
  const headlineUnit = over ? 'kcal over' : 'kcal left';
  const pct = Math.round((consumed.kcal / targets.kcal) * 100);

  const entryCount = `${day.entries.length} ${day.entries.length === 1 ? 'entry' : 'entries'}`;
  const proteinPct = targets.protein > 0 ? Math.round((consumed.protein / targets.protein) * 100) : 0;
  const proteinLeft = Math.max(0, Math.round(targets.protein - consumed.protein));

  return (
    <>
      <ScreenHeader
        live
        eyebrow={`Today · ${formatLongDate(today)}`}
        title={
          /* The h1 carries the number and its unit as one string, so a screen reader
             reads "2711 kcal left" rather than the two as unrelated fragments. */
          `${headlineNum} ${headlineUnit}`
        }
        subtitle="Everything on one screen: your budget, the trend behind it, and what you actually ate."
        action={
          <>
            <SyncChip />
            <BrandMark size={46} />
          </>
        }
      />

      {/* The mock's bento: the energy budget is the hero on the inline-start, the tiles,
          and today's meals share the wider inline-end column. */}
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(320px,1fr)_minmax(360px,1.3fr)]">
        <section className="card-hero">
          <div className="relative flex items-center justify-between gap-3">
            <span className="text-[11.5px] font-semibold uppercase tracking-[0.1em] text-fm-text-subtle">
              Energy budget
            </span>
            <span className="whitespace-nowrap rounded-full border border-fm-border-strong bg-fm-accent-quiet px-3 py-1.5 text-[11px] font-semibold text-fm-accent-hover">
              {GOAL_LABEL[state.profile?.goal ?? 'maintain'] ?? 'Maintaining'}
            </span>
          </div>

          <div className="relative my-5 grid place-items-center">
            <MacroRing
              gradient
              consumed={consumed.kcal}
              target={targets.kcal}
              label="Calories"
              unit="kcal"
              color="var(--fm-accent)"
              size={isPhone ? 208 : 244}
              strokeWidth={isPhone ? 15 : 14}
              headline={{ value: headlineNum, unit: headlineUnit, over }}
            />
          </div>

          <div className="relative flex flex-col gap-[15px]">
            <MacroBar
              consumed={consumed.protein}
              target={targets.protein}
              label="Protein"
              color="var(--fm-data-protein)"
            />
            <MacroBar
              consumed={consumed.carbs}
              target={targets.carbs}
              label="Carbs"
              color="var(--fm-data-carbs)"
            />
            <MacroBar
              consumed={consumed.fat}
              target={targets.fat}
              label="Fat"
              color="var(--fm-data-fat)"
            />
          </div>
        </section>

        <div className="flex flex-col gap-5">
          <section className="grid grid-cols-3 gap-3.5">
            <StatTile
              label="Eaten"
              value={String(Math.round(consumed.kcal))}
              hint={`${pct}% of target`}
            />
            <StatTile
              label="Logged"
              value={String(day.entries.length)}
              hint={day.entries.length === 1 ? 'entry today' : 'entries today'}
              tone="accent"
            />
            <StatTile
              label="Protein"
              value={`${proteinPct}%`}
              hint={proteinLeft > 0 ? `${proteinLeft} g to go` : 'target met'}
              tone="cyan"
            />
          </section>

          <section aria-labelledby="today-meals" className="card">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 id="today-meals" className="text-base font-bold">
                Today’s meals
              </h2>
              <span className="text-xs text-fm-text-faint">{entryCount}</span>
            </div>

            {hasEntries ? (
              <div className="flex flex-col gap-4">
                {MEAL_ORDER.map((slot) => (
                  <MealList key={slot} slot={slot} date={today} entries={day.entries} />
                ))}
              </div>
            ) : (
              /* No action button here: the dock's "Log food" button is permanently on
                 screen, and two CTAs for one action is noise, not helpfulness. */
              <EmptyState
                icon={UtensilsCrossed}
                title="Nothing logged yet"
                description={cn(
                  isPhone
                    ? 'Tap the violet button below to search or scan.'
                    : 'Use the bar at the bottom — search, pick a portion, done.',
                )}
              />
            )}
          </section>
        </div>
      </div>
    </>
  );
}
