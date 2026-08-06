import { useMemo } from 'react';
import { UtensilsCrossed } from 'lucide-react';
import { BrandMark } from '@/components/BrandMark';
import { EmptyState } from '@/components/EmptyState';
import { MacroBar, MacroRing } from '@/components/MacroRing';
import { ScreenHeader } from '@/components/ScreenHeader';
import { StatTile } from '@/components/StatTile';
import { CaloriesChart } from '@/components/charts/CaloriesChart';
import { cn } from '@/lib/cn';
import { remainingMacros, sumMacros } from '@/lib/macros';
import { selectDay } from '@/lib/store';
import { formatLongDate, formatShortDate, lastNDays, toDayKey } from '@/lib/date';
import { useAppState } from '@/lib/useStore';
import { MealList } from '@/features/log/MealList';
import { MEAL_ORDER } from '@/features/log/meals';
import { QuickAddRow } from '@/features/dashboard/QuickAddRow';
import { selectCaloriesSeries, selectDayTotalsMap } from '@/features/progress/selectors';
import { SyncChip } from '@/features/sync/SyncChip';
import { useShellBreakpoint } from '@/app/useBreakpoint';

/** The trend window the mock puts on Today — long enough to read, short enough to fit. */
const TREND_DAYS = 14;

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

  // Only computed for the wider layouts, but hooks cannot be called conditionally — and
  // this is a map over the logged days already in memory, not a trip to storage.
  const dayTotals = useMemo(() => selectDayTotalsMap(state), [state]);
  const trendDays = useMemo(() => lastNDays(TREND_DAYS, today), [today]);
  const trendSeries = useMemo(
    () => selectCaloriesSeries(dayTotals, trendDays),
    [dayTotals, trendDays],
  );
  const trendAvgKcal = useMemo(() => {
    const logged = trendSeries.filter((p): p is { day: string; kcal: number } => p.kcal !== null);
    if (logged.length === 0) return null;
    return Math.round(logged.reduce((sum, p) => sum + p.kcal, 0) / logged.length);
  }, [trendSeries]);

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
      {/* Phone follows the mock's header exactly: the date alone as the eyebrow, in the
          mock's own short-month format, and nothing under the headline. Spelling the
          month out and adding the explanatory line pushed the eyebrow to three lines and
          the h1 to two at 402 px, burying the ring below the fold. Desktop has the room,
          so it keeps the long date, the subtitle and the mark. */}
      <ScreenHeader
        live
        eyebrow={isPhone ? formatShortDate(today) : `Today · ${formatLongDate(today)}`}
        title={
          /* The h1 carries the number and its unit as one string, so a screen reader
             reads "2711 kcal left" rather than the two as unrelated fragments. */
          `${headlineNum} ${headlineUnit}`
        }
        {...(isPhone
          ? {}
          : {
              subtitle:
                'Everything on one screen: your budget, the trend behind it, and what you actually ate.',
            })}
        action={
          <>
            <SyncChip />
            {isPhone ? null : <BrandMark size={46} />}
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
          {/* Desktop only. The phone mock goes ring card → quick-add → meals with no tiles
              in between: every figure they carry is already on the ring card directly
              above them (eaten/target under the number, protein in its own bar), so on a
              402 px screen they are a second telling of the same three facts that pushes
              the meal list another 120 px down. Desktop has the column to spare. */}
          {isPhone ? null : (
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
          )}

          {/* One slot, two occupants. The desktop mock puts the 14-day trend between the
              tiles and today's meals; the phone mock puts the quick-add rail there
              instead and keeps its trend on Insights. Switched on the breakpoint rather
              than hidden with CSS, so only one of them is ever in the DOM. */}
          {isPhone ? (
            <QuickAddRow day={today} />
          ) : (
            <section aria-labelledby="today-trend" className="card">
              <div className="mb-4 flex items-start justify-between gap-4">
                <div>
                  <h2 id="today-trend" className="text-base font-bold">
                    Last 14 days
                  </h2>
                  <p className="mt-1.5 text-xs text-fm-text-subtle">
                    Daily calories against your {Math.round(targets.kcal)} kcal target
                  </p>
                </div>
                {/* Averaged over the days actually logged, never over the whole 14 —
                    dividing by 14 would read as "you ate 900 kcal" after a week off. */}
                {trendAvgKcal !== null ? (
                  <span className="whitespace-nowrap text-xs tabular-nums text-fm-text-faint">
                    avg {trendAvgKcal}
                  </span>
                ) : null}
              </div>
              <CaloriesChart series={trendSeries} targetKcal={targets.kcal} />
            </section>
          )}

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
