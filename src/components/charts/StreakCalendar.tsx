import { Link } from 'react-router-dom';
import { Flame } from 'lucide-react';
import type { StreakCellState, StreakDay } from '@/features/progress/streaks';
import { streakCellState } from '@/features/progress/streaks';
import { fromDayKey, formatDayLabel } from '@/lib/date';
import { cn } from '@/lib/cn';

const CELL_FILL: Record<StreakCellState, string> = {
  'no-log': 'var(--fm-surface-2)',
  low: 'var(--fm-gold-700)',
  mid: 'var(--fm-gold-600)',
  target: 'var(--fm-gold-400)',
  over: 'var(--fm-gold-500)',
};

const CELL_LABEL: Record<StreakCellState, string> = {
  'no-log': 'nothing logged',
  low: 'under 60% of target',
  mid: '60–85% of target',
  target: 'on target',
  over: 'over target',
};

interface StreakCalendarProps {
  /** Ascending days, ideally a multiple of 7 for a clean grid. */
  days: StreakDay[];
  targetKcal: number;
  streakCount: number;
}

/**
 * §4.2.5. An ordinal single-hue heatmap (validated ramp — see docs/DESIGN.md §4.2.5) laid
 * out GitHub-style: columns are weeks, rows are day-of-week, oldest at the inline-start.
 * "Over target" additionally gets a danger ring — shape, not colour alone. Every cell is
 * a real button with a full sentence `aria-label`; the visible swatch is intentionally
 * smaller than its hit area so the 44x44 touch-target rule (docs/DESIGN.md §0.5) holds
 * without blowing up the grid's footprint.
 */
export function StreakCalendar({ days, targetKcal, streakCount }: StreakCalendarProps): JSX.Element {
  const firstDate = days[0] ? fromDayKey(days[0].day) : null;
  const leadingBlanks = firstDate ? firstDate.getDay() : 0;

  const cells: (StreakDay | null)[] = [...Array<null>(leadingBlanks).fill(null), ...days];
  const weeks: (StreakDay | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-fm-accent-quiet text-fm-accent">
          <Flame size={20} aria-hidden="true" />
        </span>
        <div>
          <p
            aria-label={`${streakCount} day${streakCount === 1 ? '' : 's'} streak`}
            className="text-2xl font-extrabold leading-none tabular-nums text-fm-text"
          >
            {streakCount}
            <span className="ms-1.5 text-sm font-semibold text-fm-text-subtle">day{streakCount === 1 ? '' : 's'} streak</span>
          </p>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-fm-text-subtle">
            <span
              className={cn('h-1.5 w-1.5 rounded-full', streakCount > 0 ? 'bg-fm-ok' : 'bg-gray')}
              aria-hidden="true"
            />
            {streakCount > 0 ? 'Active' : 'No active streak'}
          </p>
        </div>
      </div>

      <div className="overflow-x-auto">
        <div
          role="group"
          aria-label={`Calendar of the last ${days.length} days, showing how close each logged day came to your calorie target. Each day is a link to History.`}
          className="flex gap-1"
        >
          {weeks.map((week, weekIndex) => (
            // Weeks have no natural id — the grid is fully rebuilt from `days` every
            // render (never reordered in place), so an index key is safe here.
            <div key={weekIndex} className="flex flex-col gap-1">
              {week.map((day, dayIndex) => {
                if (!day) {
                  return <div key={dayIndex} aria-hidden="true" className="h-11 w-11" />;
                }
                const state = streakCellState(day, targetKcal);
                const label = day.logged
                  ? `${formatDayLabel(day.day)} — ${day.kcal} kcal, ${CELL_LABEL[state]}`
                  : `${formatDayLabel(day.day)} — ${CELL_LABEL[state]}`;

                return (
                  <Link
                    key={day.day}
                    to="/history"
                    aria-label={label}
                    title={label}
                    className={cn(
                      // Hit area stays >= 44x44 at every breakpoint (docs/DESIGN.md §0.5)
                      // — only the visible swatch below scales, never the tappable box.
                      'grid h-11 w-11 shrink-0 place-items-center rounded-xs transition-transform duration-150',
                      'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--fm-focus)]',
                      'hover:scale-105',
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        'block h-3.5 w-3.5 rounded-[3px] md:h-4 md:w-4',
                        state === 'over' && 'ring-2 ring-inset ring-fm-danger',
                        state === 'no-log' && 'border border-[color:var(--fm-data-grid)]',
                      )}
                      style={{ backgroundColor: state === 'no-log' ? 'transparent' : CELL_FILL[state] }}
                    />
                  </Link>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <p className="text-[11px] leading-relaxed text-fm-text-faint">
        A day counts toward the streak when you log at least one entry and land within ±15% of
        your calorie target. Tap a day to open History.
      </p>
    </div>
  );
}
