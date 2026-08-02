import { useState } from 'react';
import { Camera, Database, PencilLine, Trash2 } from 'lucide-react';
import type { DayKey, EntrySource, LogEntry, MealSlot } from '@/types';
import { InlineDeleteConfirm } from '@/components/InlineDeleteConfirm';
import { Sheet } from '@/components/Sheet';
import { sumMacros } from '@/lib/macros';
import { useStore } from '@/lib/useStore';
import { EntryEditor } from '@/features/log/EntryEditor';
import { MEAL_LABELS } from '@/features/log/meals';

/** Where an entry's numbers came from. Shown so estimates are never mistaken for facts. */
const SOURCE_BADGE: Record<EntrySource, { icon: typeof Database; title: string }> = {
  'food-db': { icon: Database, title: 'From the food database (reference values)' },
  scan: { icon: Camera, title: 'AI estimate from a photo, reviewed by you' },
  manual: { icon: PencilLine, title: 'Entered by hand' },
};

interface MealListProps {
  slot: MealSlot;
  date: DayKey;
  entries: readonly LogEntry[];
  /** Hide the section entirely when the meal has no entries. */
  hideWhenEmpty?: boolean;
}

export function MealList({
  slot,
  date,
  entries,
  hideWhenEmpty = true,
}: MealListProps): JSX.Element | null {
  const store = useStore();
  const mealEntries = entries.filter((entry) => entry.meal === slot);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  if (mealEntries.length === 0 && hideWhenEmpty) return null;

  const totals = sumMacros(mealEntries);
  const editingEntry = mealEntries.find((entry) => entry.id === editingId) ?? null;

  return (
    <section aria-labelledby={`meal-${slot}-${date}`}>
      <div className="mb-2 flex items-baseline justify-between">
        <h3 id={`meal-${slot}-${date}`} className="text-sm font-bold text-white">
          {MEAL_LABELS[slot]}
        </h3>
        <span className="text-xs text-gray tabular-nums">{Math.round(totals.kcal)} kcal</span>
      </div>

      {mealEntries.length === 0 ? (
        <p className="rounded-md border border-dashed border-[color:var(--border)] px-3 py-3 text-xs text-gray-soft">
          Nothing logged.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {mealEntries.map((entry) => {
            if (confirmingId === entry.id) {
              return (
                <li key={entry.id}>
                  <InlineDeleteConfirm
                    // docs/DESIGN.md §7.3 specifies the question verbatim — "Delete this
                    // entry?" — and it leads, so the destructive action is stated before
                    // the detail. Naming the entry and the meal after it is additive: a
                    // confirmation that does not say WHAT it is about to delete is the
                    // one people click through without reading.
                    message={`Delete this entry? "${entry.name}" will be removed from ${MEAL_LABELS[slot]}.`}
                    onConfirm={() => {
                      store.removeEntry(entry.id, date);
                      setConfirmingId(null);
                    }}
                    onCancel={() => setConfirmingId(null)}
                  />
                </li>
              );
            }

            const badge = SOURCE_BADGE[entry.source];
            const Icon = badge.icon;

            return (
              <li
                key={entry.id}
                className="flex items-center gap-1 rounded-md border border-[color:var(--border)] bg-surface-2/70"
              >
                <button
                  type="button"
                  onClick={() => setEditingId(entry.id)}
                  aria-label={`Edit ${entry.name}`}
                  className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-start"
                >
                  <span className="shrink-0 text-gray-soft" title={badge.title}>
                    <Icon size={15} aria-hidden="true" />
                    <span className="sr-only">{badge.title}</span>
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-white">
                      {entry.name}
                    </span>
                    <span className="block text-[11px] text-gray tabular-nums">
                      {Math.round(entry.grams)} g · P {entry.protein} · C {entry.carbs} · F{' '}
                      {entry.fat}
                    </span>
                  </span>

                  <span className="shrink-0 text-sm font-bold tabular-nums text-white">
                    {Math.round(entry.kcal)}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setConfirmingId(entry.id)}
                  aria-label={`Remove ${entry.name} from ${MEAL_LABELS[slot]}`}
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-sm text-gray-soft transition-colors hover:bg-surface-3 hover:text-danger"
                >
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <Sheet open={editingEntry !== null} onClose={() => setEditingId(null)} title="Edit entry">
        {editingEntry ? (
          <EntryEditor entry={editingEntry} date={date} onClose={() => setEditingId(null)} />
        ) : null}
      </Sheet>
    </section>
  );
}
