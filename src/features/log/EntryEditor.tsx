import { useMemo, useState } from 'react';
import { Check, Trash2 } from 'lucide-react';
import type { DayKey, LogEntry, MealSlot } from '@/types';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { Segmented } from '@/components/Segmented';
import { InlineDeleteConfirm } from '@/components/InlineDeleteConfirm';
import { FOODS } from '@/data/foods';
import { macrosForGrams } from '@/lib/macros';
import { selectCustomFoods } from '@/lib/store';
import { useAppState, useStore } from '@/lib/useStore';
import { MEAL_LABELS, MEAL_OPTIONS } from '@/features/log/meals';

interface EntryEditorProps {
  entry: LogEntry;
  date: DayKey;
  onClose: () => void;
}

function formatLogTimestamp(epochMs: number): string {
  return new Date(epochMs).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Edit entry (docs/DESIGN.md §7.3). When the entry came from the food database or one
 * of the user's own custom foods, grams stays the source of truth and macros re-derive
 * from the per-100 g values — exactly like adding it fresh. A scanned or hand-typed
 * entry has no such reference to rescale from, so its macros are edited directly.
 */
export function EntryEditor({ entry, date, onClose }: EntryEditorProps): JSX.Element {
  const store = useStore();
  const state = useAppState();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const baseFood = useMemo(() => {
    if (!entry.foodId) return null;
    const customFoods = selectCustomFoods(state);
    return [...FOODS, ...customFoods].find((food) => food.id === entry.foodId) ?? null;
  }, [entry.foodId, state]);

  const [grams, setGrams] = useState(String(entry.grams));
  const [meal, setMeal] = useState<MealSlot>(entry.meal);
  const [kcal, setKcal] = useState(String(entry.kcal));
  const [protein, setProtein] = useState(String(entry.protein));
  const [carbs, setCarbs] = useState(String(entry.carbs));
  const [fat, setFat] = useState(String(entry.fat));

  const parsedGrams = Number(grams);
  const validGrams = Number.isFinite(parsedGrams) && parsedGrams > 0 && parsedGrams <= 5000;

  const derivedMacros = useMemo(
    () => (baseFood && validGrams ? macrosForGrams(baseFood, parsedGrams) : null),
    [baseFood, parsedGrams, validGrams],
  );

  const manualValues = [kcal, protein, carbs, fat];
  const manualValid = manualValues.every((raw) => {
    const parsed = Number(raw);
    return raw.trim() !== '' && Number.isFinite(parsed) && parsed >= 0;
  });

  const canSave = validGrams && (baseFood ? true : manualValid);

  const handleSave = (): void => {
    if (!canSave) return;
    const macros = derivedMacros ?? {
      kcal: Number(kcal),
      protein: Number(protein),
      carbs: Number(carbs),
      fat: Number(fat),
    };
    store.updateEntry(entry.id, { grams: parsedGrams, meal, ...macros }, date);
    onClose();
  };

  const handleDelete = (): void => {
    store.removeEntry(entry.id, date);
    onClose();
  };

  if (confirmingDelete) {
    return (
      <InlineDeleteConfirm
        message={`Delete "${entry.name}"? It will be removed from ${MEAL_LABELS[entry.meal]}.`}
        onConfirm={handleDelete}
        onCancel={() => setConfirmingDelete(false)}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="truncate text-base font-bold text-white">{entry.name}</h3>
        <p className="mt-0.5 text-xs text-gray-soft">
          Logged {formatLogTimestamp(entry.loggedAt)}
          {entry.updatedAt !== entry.loggedAt ? ` · Edited ${formatLogTimestamp(entry.updatedAt)}` : ''}
        </p>
      </div>

      <Field
        label="Portion"
        type="number"
        inputMode="decimal"
        value={grams}
        onChange={(event) => setGrams(event.target.value)}
        suffix="g"
        min={1}
        max={5000}
        {...(!validGrams ? { error: 'Enter a weight between 1 and 5000 g.' } : {})}
      />

      <Segmented legend="Meal" options={MEAL_OPTIONS} value={meal} onChange={setMeal} columns={2} />

      {derivedMacros ? (
        <div
          className="rounded-md border border-[color:var(--border-strong)] bg-surface-3/60 p-4"
          aria-live="polite"
        >
          <div className="flex items-baseline justify-between">
            <span className="text-sm font-semibold text-gray">Updated total</span>
            <span className="text-xl font-extrabold tabular-nums">{derivedMacros.kcal} kcal</span>
          </div>
          <p className="mt-2 text-[11px] text-gray-soft">
            P {derivedMacros.protein} · C {derivedMacros.carbs} · F {derivedMacros.fat}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <Field
            label="Calories"
            type="number"
            inputMode="decimal"
            min={0}
            suffix="kcal"
            value={kcal}
            onChange={(event) => setKcal(event.target.value)}
          />
          <Field
            label="Protein"
            type="number"
            inputMode="decimal"
            min={0}
            suffix="g"
            value={protein}
            onChange={(event) => setProtein(event.target.value)}
          />
          <Field
            label="Carbs"
            type="number"
            inputMode="decimal"
            min={0}
            suffix="g"
            value={carbs}
            onChange={(event) => setCarbs(event.target.value)}
          />
          <Field
            label="Fat"
            type="number"
            inputMode="decimal"
            min={0}
            suffix="g"
            value={fat}
            onChange={(event) => setFat(event.target.value)}
          />
        </div>
      )}

      <div className="flex gap-2">
        <Button variant="danger" onClick={() => setConfirmingDelete(true)}>
          <Trash2 size={16} aria-hidden="true" />
          Delete
        </Button>
        <Button variant="ghost" className="flex-1" onClick={onClose}>
          Cancel
        </Button>
        <Button className="flex-1" disabled={!canSave} onClick={handleSave}>
          <Check size={18} aria-hidden="true" />
          Save
        </Button>
      </div>
    </div>
  );
}
