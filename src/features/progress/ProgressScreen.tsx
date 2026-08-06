import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { Card } from '@/components/Card';
import { ScreenHeader } from '@/components/ScreenHeader';
import { StatTile } from '@/components/StatTile';
import { Segmented } from '@/components/Segmented';
import { Button } from '@/components/Button';
import { WeightTrendChart } from '@/components/charts/WeightTrendChart';
import { CaloriesChart } from '@/components/charts/CaloriesChart';
import { MacroTrendsChart } from '@/components/charts/MacroTrendsChart';
import { WeeklyAveragesChart } from '@/components/charts/WeeklyAveragesChart';
import { StreakCalendar } from '@/components/charts/StreakCalendar';
import { WeightEntryForm } from '@/features/progress/WeightEntryForm';
import { SyncChip } from '@/features/sync/SyncChip';
import { buildStreakDays, currentStreak } from '@/features/progress/streaks';
import {
  RANGE_OPTIONS,
  computeWeeklyAverages,
  computeWeightSeries,
  resolveRangeDays,
  selectCaloriesSeries,
  selectDayTotalsMap,
  selectMacroSeries,
  selectWeightPointsInRange,
  weeksWithActivity,
  weightDeltaKg,
} from '@/features/progress/selectors';
import type { RangeKey } from '@/features/progress/selectors';
import type { Macros } from '@/types';
import { selectLiveWeights, selectLoggedDays } from '@/lib/store';
import { lastNDays, toDayKey } from '@/lib/date';
import { useAppState } from '@/lib/useStore';

const STREAK_CALENDAR_WEEKS = 10; // 70 days — a screenful on phone, a real stretch on desktop
const STREAK_LOOKBACK_DAYS = 400; // generous enough that no real streak ever gets truncated
const MAX_WEEKLY_ROWS = 8;

/** Adapts the shared `{day -> Macros}` map into the `{day -> kcal}` map streaks.ts wants. */
function toKcalMap(dayTotals: ReadonlyMap<string, Macros>): Map<string, number> {
  const map = new Map<string, number>();
  for (const [day, totals] of dayTotals) map.set(day, totals.kcal);
  return map;
}

/**
 * The real Progress screen (docs/DESIGN.md §7.5): a shared date-range control feeding
 * the weight, calories and macro charts, plus a fixed weekly-averages table and streak
 * calendar. Every card decides its own empty state independently — a user with weights
 * but no food log still sees a real weight chart next to an honest empty calories card,
 * never a single blanked screen (§7.5 "Every card independently handles empty").
 */
export function ProgressScreen(): JSX.Element {
  const state = useAppState();
  const today = toDayKey();
  const [range, setRange] = useState<RangeKey>('90d');
  const [addingWeight, setAddingWeight] = useState(false);

  const targets = state.targets;

  const dayTotals = useMemo(() => selectDayTotalsMap(state), [state]);
  const rangeDays = useMemo(() => resolveRangeDays(state, range, today), [state, range, today]);

  const weightPoints = useMemo(() => selectWeightPointsInRange(state, rangeDays), [state, rangeDays]);
  const weightSeries = useMemo(() => computeWeightSeries(weightPoints), [weightPoints]);
  const weightDelta = useMemo(() => weightDeltaKg(weightPoints), [weightPoints]);

  const caloriesSeries = useMemo(() => selectCaloriesSeries(dayTotals, rangeDays), [dayTotals, rangeDays]);
  const proteinSeries = useMemo(() => selectMacroSeries(dayTotals, rangeDays, 'protein'), [dayTotals, rangeDays]);
  const carbsSeries = useMemo(() => selectMacroSeries(dayTotals, rangeDays, 'carbs'), [dayTotals, rangeDays]);
  const fatSeries = useMemo(() => selectMacroSeries(dayTotals, rangeDays, 'fat'), [dayTotals, rangeDays]);

  const weeklyRowCount = useMemo(
    () => Math.min(MAX_WEEKLY_ROWS, Math.max(1, weeksWithActivity(dayTotals, MAX_WEEKLY_ROWS, today))),
    [dayTotals, today],
  );
  const weeks = useMemo(
    () => computeWeeklyAverages(dayTotals, weeklyRowCount, targets?.kcal ?? 0, today),
    [dayTotals, weeklyRowCount, targets, today],
  );

  const kcalMap = useMemo(() => toKcalMap(dayTotals), [dayTotals]);
  const streakLookback = useMemo(() => lastNDays(STREAK_LOOKBACK_DAYS, today), [today]);
  const streakDaysAll = useMemo(() => buildStreakDays(streakLookback, kcalMap), [streakLookback, kcalMap]);
  const streakCount = useMemo(
    () => currentStreak(streakDaysAll, targets?.kcal ?? 0, today),
    [streakDaysAll, targets, today],
  );

  const calendarDays = useMemo(() => lastNDays(STREAK_CALENDAR_WEEKS * 7, today), [today]);
  const streakDaysVisual = useMemo(() => buildStreakDays(calendarDays, kcalMap), [calendarDays, kcalMap]);

  const totalLoggedDays = useMemo(() => selectLoggedDays(state).length, [state]);
  const currentRangeLabel = RANGE_OPTIONS.find((option) => option.value === range)?.label ?? range;

  // "Current weight" is the truly latest reading regardless of the selected chart
  // range — it must not go blank just because the user picked "30 d" and last
  // weighed in 45 days ago. The range only scopes the chart and its own delta.
  const allWeights = useMemo(() => selectLiveWeights(state), [state]);
  const latestWeightKg = allWeights.length > 0 ? allWeights[allWeights.length - 1]?.weightKg : null;

  if (!targets) return <></>;

  return (
    <div className="flex flex-col gap-5 lg:grid lg:grid-cols-12 lg:items-start lg:gap-6">
      <div className="lg:col-span-12">
        <ScreenHeader
          eyebrow="Insights"
          title="How it’s going"
          subtitle="Weight, where your calories come from, and how consistent you’ve been — drawn only from days you actually logged."
          action={<SyncChip />}
        />

        <Segmented legend="Date range" options={RANGE_OPTIONS} value={range} onChange={setRange} columns={4} />
      </div>

      <Card className="flex flex-col gap-4 lg:col-span-8">
        <h2 className="text-base font-bold text-fm-text">Body weight</h2>
        <WeightTrendChart days={rangeDays} readings={weightSeries} deltaKg={weightDelta} goal={state.profile?.goal} />

        {addingWeight ? (
          <WeightEntryForm onSaved={() => setAddingWeight(false)} />
        ) : (
          <Button type="button" variant="secondary" onClick={() => setAddingWeight(true)} className="self-start">
            <Plus size={16} aria-hidden="true" />
            Add today&rsquo;s weight
          </Button>
        )}
      </Card>

      <div className="grid grid-cols-2 gap-3.5 lg:col-span-4">
        {/* "Current weight", not the mock's bare "Current": this tile sits in a 2×2 block
            away from the chart's own title, so it has to name its own subject. */}
        <StatTile
          label="Current weight"
          value={
            latestWeightKg !== null && latestWeightKg !== undefined ? `${latestWeightKg} kg` : '—'
          }
        />
        <StatTile
          label={`Change (${currentRangeLabel})`}
          value={weightDelta !== null ? `${weightDelta > 0 ? '+' : ''}${weightDelta} kg` : '—'}
          /* Losing weight is not universally "good", so the delta is never coloured by
             sign — it takes the goal's own direction or stays neutral. */
          tone={weightDelta === null || weightDelta === 0 ? 'neutral' : 'accent'}
        />
        <StatTile
          label="Streak"
          value={`${streakCount} d`}
          hint="within ±15% of target"
          tone="warn"
        />
        <StatTile label="Days logged" value={String(totalLoggedDays)} />
      </div>

      <Card className="flex flex-col gap-4 lg:col-span-6">
        <h2 className="text-base font-bold text-fm-text">Calories per day</h2>
        <CaloriesChart series={caloriesSeries} targetKcal={targets.kcal} />
      </Card>

      <Card className="flex flex-col gap-4 lg:col-span-6">
        <h2 className="text-base font-bold text-fm-text">Macro trends</h2>
        <MacroTrendsChart
          days={rangeDays}
          protein={proteinSeries}
          carbs={carbsSeries}
          fat={fatSeries}
          targets={{ protein: targets.protein, carbs: targets.carbs, fat: targets.fat }}
        />
      </Card>

      <Card className="flex flex-col gap-4 lg:col-span-7">
        <h2 className="text-base font-bold text-fm-text">Weekly averages</h2>
        <WeeklyAveragesChart weeks={weeks} targetKcal={targets.kcal} />
      </Card>

      <Card className="flex flex-col gap-4 lg:col-span-5">
        <h2 className="text-base font-bold text-fm-text">Streaks</h2>
        <p className="text-xs leading-relaxed text-fm-text-subtle">
          A day counts when you log at least one entry and land within ±15% of your calorie target.
        </p>
        <StreakCalendar days={streakDaysVisual} targetKcal={targets.kcal} streakCount={streakCount} />
      </Card>
    </div>
  );
}

