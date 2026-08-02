import { useState } from 'react';
import type { FormEvent } from 'react';
import { Check } from 'lucide-react';
import type { DayKey } from '@/types';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { selectWeightForDay } from '@/lib/store';
import { formatDayLabel, toDayKey } from '@/lib/date';
import { useAppState, useStore } from '@/lib/useStore';

interface WeightEntryFormProps {
  /** Defaults to today. */
  defaultDate?: DayKey;
  /** Shows an editable date field — used on the full weight log; the compact Progress
   *  card only ever logs today, per docs/DESIGN.md §7.5's "Add today's weight" button. */
  showDate?: boolean;
  onSaved?: () => void;
}

/**
 * The one way real weight data gets into the app — used both inline on Progress
 * ("Add today's weight") and on the full `/profile/weight` log.
 *
 * One live reading per day is enforced by `store.logWeight` itself (it upserts), but
 * the UI must not silently overwrite a value the user already entered — docs/DESIGN.md
 * §7.8 requires an explicit "You already logged X kg for <day>. Replace it?" step.
 */
export function WeightEntryForm({ defaultDate, showDate = false, onSaved }: WeightEntryFormProps): JSX.Element {
  const state = useAppState();
  const store = useStore();
  const today = toDayKey();

  const [date, setDate] = useState<DayKey>(defaultDate ?? today);
  const [weight, setWeight] = useState('');
  const [saved, setSaved] = useState(false);
  const [pendingReplace, setPendingReplace] = useState<{
    date: DayKey;
    weightKg: number;
    existingKg: number;
  } | null>(null);

  const parsedWeight = Number(weight);
  const valid = weight.trim() !== '' && Number.isFinite(parsedWeight) && parsedWeight > 0 && parsedWeight <= 500;

  const commit = (targetDate: DayKey, weightKg: number): void => {
    store.logWeight(weightKg, targetDate);
    setWeight('');
    setPendingReplace(null);
    setSaved(true);
    onSaved?.();
  };

  const handleSubmit = (event: FormEvent): void => {
    event.preventDefault();
    if (!valid) return;
    setSaved(false);

    const existing = selectWeightForDay(state, date);
    if (existing) {
      setPendingReplace({ date, weightKg: parsedWeight, existingKg: existing.weightKg });
      return;
    }
    commit(date, parsedWeight);
  };

  if (pendingReplace) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-fm-warn/40 bg-fm-warn-bg p-4">
        <p className="text-sm font-medium leading-relaxed text-fm-text">
          You already logged <span className="font-bold">{pendingReplace.existingKg} kg</span> for{' '}
          {formatDayLabel(pendingReplace.date)}. Replace it with{' '}
          <span className="font-bold">{pendingReplace.weightKg} kg</span>?
        </p>
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="flex-1"
            onClick={() => setPendingReplace(null)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            className="flex-1"
            onClick={() => commit(pendingReplace.date, pendingReplace.weightKg)}
          >
            Replace
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div className={showDate ? 'grid grid-cols-2 gap-3' : 'grid grid-cols-1 gap-3'}>
        {showDate ? (
          <Field
            label="Date"
            type="date"
            max={today}
            value={date}
            onChange={(event) => {
              setDate(event.target.value);
              setSaved(false);
            }}
          />
        ) : null}
        <Field
          label={showDate ? 'Weight' : `Today's weight (${formatDayLabel(date)})`}
          type="number"
          inputMode="decimal"
          step="0.1"
          min={1}
          max={500}
          suffix="kg"
          placeholder="e.g. 81.4"
          value={weight}
          onChange={(event) => {
            setWeight(event.target.value);
            setSaved(false);
          }}
        />
      </div>

      <Button type="submit" disabled={!valid} className="w-full">
        <Check size={18} aria-hidden="true" />
        {saved ? 'Saved' : 'Save weight'}
      </Button>
      <div role="status" aria-live="polite" className="sr-only">
        {saved ? `Weight saved for ${formatDayLabel(date)}.` : ''}
      </div>
    </form>
  );
}
