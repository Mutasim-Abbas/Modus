import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Pencil, Scale, Trash2 } from 'lucide-react';
import type { DayKey } from '@/types';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { ScreenHeader } from '@/components/ScreenHeader';
import { WeightEntryForm } from '@/features/progress/WeightEntryForm';
import { selectLiveWeights } from '@/lib/store';
import { formatDayLabel, toDayKey } from '@/lib/date';
import { useAppState, useStore } from '@/lib/useStore';

/**
 * `/profile/weight` (docs/DESIGN.md §7.8) — the full weight log: every live reading,
 * editable and deletable, plus the same add/replace form used inline on Progress.
 * "Editable" here means re-entering a value for that date through the form below,
 * which already asks "You already logged X kg — replace it?" (docs/DESIGN.md §7.8) —
 * there is deliberately no second, parallel edit-in-place path to keep that the one
 * place a weight value gets written.
 */
export function WeightLogScreen(): JSX.Element {
  const state = useAppState();
  const store = useStore();
  const today = toDayKey();

  const readings = useMemo(
    () => [...selectLiveWeights(state)].sort((a, b) => b.day.localeCompare(a.day)),
    [state],
  );

  const [editDate, setEditDate] = useState<DayKey | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link
          to="/profile"
          className="mb-2 inline-flex min-h-[44px] items-center gap-1.5 text-sm font-semibold text-fm-text-subtle transition-colors hover:text-fm-text"
        >
          <ArrowLeft size={16} aria-hidden="true" />
          Profile
        </Link>
        <ScreenHeader
          eyebrow="Profile"
          title="Weight log"
          subtitle="One reading per day — add a new one, or edit an existing day by choosing it below."
        />
      </div>

      <Card>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-bold text-fm-text">
            {editDate ? `Replace the reading for ${formatDayLabel(editDate)}` : 'Add a reading'}
          </h2>
          {editDate ? (
            <button
              type="button"
              onClick={() => setEditDate(null)}
              className="text-xs font-semibold text-fm-text-subtle hover:text-fm-text"
            >
              Cancel
            </button>
          ) : null}
        </div>
        <WeightEntryForm
          key={editDate ?? 'new'}
          showDate
          defaultDate={editDate ?? today}
          onSaved={() => setEditDate(null)}
        />
      </Card>

      {readings.length === 0 ? (
        <EmptyState
          icon={Scale}
          title="No weight readings yet"
          description="Add your first reading above — it appears here and on the Progress chart."
        />
      ) : (
        <Card className="p-0">
          <ul className="flex flex-col">
            {readings.map((reading) => (
              <li key={reading.id} className="border-b border-[color:var(--fm-border)] px-4 py-3 last:border-0">
                {confirmingDeleteId === reading.id ? (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm font-medium text-fm-text">
                      Delete the reading for {formatDayLabel(reading.day)}?
                    </p>
                    <div className="flex gap-2">
                      <Button size="sm" variant="secondary" onClick={() => setConfirmingDeleteId(null)}>
                        Keep
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => {
                          store.removeWeight(reading.id);
                          setConfirmingDeleteId(null);
                        }}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-fm-text">{formatDayLabel(reading.day)}</p>
                      <p className="text-xs tabular-nums text-fm-text-subtle">{reading.day}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <span className="me-1 text-base font-bold tabular-nums text-fm-text">{reading.weightKg} kg</span>
                      <button
                        type="button"
                        onClick={() => setEditDate(reading.day)}
                        aria-label={`Edit the reading for ${formatDayLabel(reading.day)}`}
                        className="grid h-11 w-11 place-items-center rounded-sm text-fm-text-subtle transition-colors hover:bg-fm-hover hover:text-fm-text"
                      >
                        <Pencil size={16} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmingDeleteId(reading.id)}
                        aria-label={`Delete the reading for ${formatDayLabel(reading.day)}`}
                        className="grid h-11 w-11 place-items-center rounded-sm text-fm-text-subtle transition-colors hover:bg-fm-hover hover:text-fm-danger"
                      >
                        <Trash2 size={16} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
