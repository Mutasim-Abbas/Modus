import { useState } from 'react';
import { Copy } from 'lucide-react';
import type { LogEntry } from '@/types';
import { Button } from '@/components/Button';
import { formatDayLabel } from '@/lib/date';
import { sumMacros } from '@/lib/macros';

interface CopyDayConfirmProps {
  sourceDay: string;
  today: string;
  entries: readonly LogEntry[];
  onCancel: () => void;
  onConfirm: (selectedIds: readonly string[]) => void;
}

/**
 * "Never copies silently" (docs/DESIGN.md §7.3): lists exactly what will be copied,
 * every entry checked by default, and lets the user drop specific items before
 * confirming.
 */
export function CopyDayConfirm({
  sourceDay,
  today,
  entries,
  onCancel,
  onConfirm,
}: CopyDayConfirmProps): JSX.Element {
  const [checked, setChecked] = useState<ReadonlySet<string>>(
    () => new Set(entries.map((entry) => entry.id)),
  );

  const totals = sumMacros(entries);
  const selectedCount = checked.size;

  const toggle = (id: string): void => {
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-gray">
        <strong className="text-white">
          {entries.length} entr{entries.length === 1 ? 'y' : 'ies'}, {Math.round(totals.kcal)} kcal
        </strong>{' '}
        — from {formatDayLabel(sourceDay, today)}
      </p>

      <ul className="flex max-h-[40dvh] flex-col gap-2 overflow-y-auto">
        {entries.map((entry) => (
          <li key={entry.id}>
            <label className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-md border border-[color:var(--border)] bg-surface-2/70 px-3 py-2">
              <input
                type="checkbox"
                checked={checked.has(entry.id)}
                onChange={() => toggle(entry.id)}
                className="h-5 w-5 shrink-0 accent-gold"
              />
              <span className="min-w-0 flex-1 truncate text-sm text-white">{entry.name}</span>
              <span className="shrink-0 text-xs text-gray tabular-nums">
                {Math.round(entry.grams)} g · {Math.round(entry.kcal)} kcal
              </span>
            </label>
          </li>
        ))}
      </ul>

      <div className="flex gap-2">
        <Button type="button" variant="ghost" className="flex-1" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="button"
          className="flex-1"
          disabled={selectedCount === 0}
          onClick={() => onConfirm(Array.from(checked))}
        >
          <Copy size={16} aria-hidden="true" />
          Copy {selectedCount} {selectedCount === 1 ? 'entry' : 'entries'}
        </Button>
      </div>
    </div>
  );
}
