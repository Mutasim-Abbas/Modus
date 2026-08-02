import { ArrowDown, ArrowUp, Check, History } from 'lucide-react';
import type { WeekAverage } from '@/features/progress/selectors';
import { EmptyState } from '@/components/EmptyState';
import { formatDayLabel } from '@/lib/date';

interface WeeklyAveragesChartProps {
  weeks: WeekAverage[];
  targetKcal: number;
}

/**
 * §4.2.4. Every number here is already visible as real text next to its bar — arrow +
 * number + word, never colour alone — so this is a real `<table>` rather than an
 * SVG-plus-disclosure: there is nothing hidden behind the visual to disclose.
 */
export function WeeklyAveragesChart({ weeks, targetKcal }: WeeklyAveragesChartProps): JSX.Element {
  const withActivity = weeks.filter((w) => w.loggedDays > 0);

  if (withActivity.length === 0) {
    return (
      <EmptyState
        icon={History}
        title="No weeks logged yet"
        description="Log a few days and your weekly averages appear here."
      />
    );
  }

  const maxKcal = Math.max(targetKcal, ...weeks.map((w) => w.avgKcal), 1);

  return (
    // No horizontal scroll needed — every column fits a 360px phone by design (fixed
    // narrow Week/vs-target columns, wrapping text instead of forced min-widths).
    <table className="w-full table-fixed border-collapse text-sm">
      <caption className="sr-only">
        Weekly average calories per day, most recent first, against a target of {targetKcal} kcal.
      </caption>
      <thead>
        <tr>
          <th scope="col" className="w-16 px-1 pb-2 text-start text-xs font-semibold text-fm-text-subtle lg:w-32">
            Week
          </th>
          <th scope="col" className="px-1 pb-2 text-start text-xs font-semibold text-fm-text-subtle">
            Average / day
          </th>
          <th scope="col" className="w-24 px-1 pb-2 text-start text-xs font-semibold text-fm-text-subtle lg:w-28">
            vs target
          </th>
        </tr>
      </thead>
      <tbody>
        {weeks.map((week, index) => {
          const label =
            index === 0
              ? 'This week'
              : index === 1
                ? 'Last week'
                : `${formatDayLabel(week.weekStart)} – ${formatDayLabel(week.weekEnd)}`;
          const ratio = week.loggedDays > 0 ? Math.min(1, week.avgKcal / maxKcal) : 0;
          const deltaKcal = week.avgKcal - targetKcal;

          return (
            <tr key={week.weekStart} className="border-t border-[color:var(--fm-border)] first:border-0">
              <th scope="row" className="px-1 py-3 text-start text-sm font-semibold leading-tight text-fm-text">
                {label}
              </th>
              <td className="px-1 py-3">
                <div className="relative h-3 w-full overflow-hidden rounded-full bg-fm-chip" aria-hidden="true">
                  <div className="h-full rounded-full bg-fm-data-energy" style={{ width: `${ratio * 100}%` }} />
                </div>
                <span className="mt-1 block text-xs tabular-nums leading-snug text-fm-text-subtle">
                  {week.loggedDays > 0 ? `${week.avgKcal} kcal` : 'Not logged'}
                  {week.loggedDays > 0 && week.loggedDays < 4 ? (
                    <span className="text-fm-warn"> · {week.loggedDays}/7 days</span>
                  ) : null}
                </span>
              </td>
              <td className="px-1 py-3 text-xs font-semibold leading-tight">
                {week.onTargetWithinTolerance === null ? (
                  <span className="text-fm-text-faint">Not logged</span>
                ) : week.onTargetWithinTolerance ? (
                  <span className="inline-flex items-center gap-1 text-fm-ok">
                    <Check size={13} aria-hidden="true" className="shrink-0" />
                    On target
                  </span>
                ) : (
                  // Outside the ±5% tolerance in *either* direction reads as --fm-warn
                  // (docs/DESIGN.md §4.2.4) — only the arrow and word say which way.
                  <span className="inline-flex items-start gap-1 text-fm-warn">
                    {deltaKcal > 0 ? (
                      <ArrowUp size={13} aria-hidden="true" className="mt-0.5 shrink-0" />
                    ) : (
                      <ArrowDown size={13} aria-hidden="true" className="mt-0.5 shrink-0" />
                    )}
                    <span>
                      {Math.abs(deltaKcal)} {deltaKcal > 0 ? 'over' : 'under'}
                    </span>
                  </span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
