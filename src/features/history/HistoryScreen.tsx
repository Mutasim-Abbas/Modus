import { useMemo, useState } from 'react';
import { CalendarDays, ChevronDown } from 'lucide-react';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { ScreenHeader } from '@/components/ScreenHeader';
import { LinkButton } from '@/components/LinkButton';
import { sumMacros } from '@/lib/macros';
import { selectLoggedDays } from '@/lib/store';
import { formatDayLabel, toDayKey } from '@/lib/date';
import { useAppState } from '@/lib/useStore';
import { cn } from '@/lib/cn';
import { MealList } from '@/features/log/MealList';
import { MEAL_ORDER } from '@/features/log/meals';

export function HistoryScreen(): JSX.Element {
  const state = useAppState();
  const today = toDayKey();
  const days = useMemo(() => selectLoggedDays(state), [state]);
  const [expanded, setExpanded] = useState<string | null>(days[0]?.date ?? null);

  if (days.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <ScreenHeader eyebrow="History" title="Your logged days" />
        <EmptyState
          icon={CalendarDays}
          title="No days logged yet"
          description="Once you log food, each day is saved here on this device so you can look back at it."
          action={<LinkButton to="/log" className="mt-1">Log your first food</LinkButton>}
        />
      </div>
    );
  }

  const targetKcal = state.targets?.kcal ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <ScreenHeader
        eyebrow="History"
        title="Your logged days"
        subtitle={`${days.length} day${days.length === 1 ? '' : 's'} saved on this device.`}
      />

      <ul className="flex flex-col gap-3">
        {days.map((day) => {
          const totals = sumMacros(day.entries);
          const isOpen = expanded === day.date;
          const overTarget = targetKcal > 0 && totals.kcal > targetKcal;

          return (
            <li key={day.date}>
              <Card className="p-0">
                <h2>
                  <button
                    type="button"
                    onClick={() => setExpanded(isOpen ? null : day.date)}
                    aria-expanded={isOpen}
                    aria-controls={`day-${day.date}`}
                    className="flex min-h-[64px] w-full items-center gap-3 px-4 py-3 text-start"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-white">
                        {formatDayLabel(day.date, today)}
                      </p>
                      <p className="text-[11px] text-gray tabular-nums">
                        {day.entries.length} item{day.entries.length === 1 ? '' : 's'} · P{' '}
                        {Math.round(totals.protein)} · C {Math.round(totals.carbs)} · F{' '}
                        {Math.round(totals.fat)}
                      </p>
                    </div>

                    <span
                      className={cn(
                        'shrink-0 text-base font-extrabold tabular-nums',
                        overTarget ? 'text-danger' : 'text-white',
                      )}
                    >
                      {Math.round(totals.kcal)}
                      <span className="ms-1 text-[10px] font-normal text-gray">kcal</span>
                    </span>

                    <ChevronDown
                      size={18}
                      aria-hidden="true"
                      className={cn(
                        'shrink-0 text-gray-soft transition-transform duration-200',
                        isOpen && 'rotate-180',
                      )}
                    />
                  </button>
                </h2>

                {isOpen ? (
                  <div id={`day-${day.date}`} className="flex flex-col gap-4 border-t border-[color:var(--border)] px-4 py-4">
                    {MEAL_ORDER.map((slot) => (
                      <MealList key={slot} slot={slot} date={day.date} entries={day.entries} />
                    ))}
                  </div>
                ) : null}
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
