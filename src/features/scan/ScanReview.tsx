import { useMemo, useState } from 'react';
import { Check, Info, Trash2, X } from 'lucide-react';
import type { AnalyzedItem, MealSlot } from '@/types';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Segmented } from '@/components/Segmented';
import { sumMacros } from '@/lib/macros';
import { cn } from '@/lib/cn';
import { MEAL_OPTIONS } from '@/features/log/meals';

type NumericKey = 'grams' | 'kcal' | 'protein' | 'carbs' | 'fat';

const FIELDS: { key: NumericKey; label: string; unit: string }[] = [
  { key: 'grams', label: 'Weight', unit: 'g' },
  { key: 'kcal', label: 'Calories', unit: 'kcal' },
  { key: 'protein', label: 'Protein', unit: 'g' },
  { key: 'carbs', label: 'Carbs', unit: 'g' },
  { key: 'fat', label: 'Fat', unit: 'g' },
];

interface ScanReviewProps {
  items: AnalyzedItem[];
  note: string;
  preview: string | null;
  defaultMeal: MealSlot;
  onCancel: () => void;
  onLog: (items: AnalyzedItem[], meal: MealSlot) => void;
}

function confidenceLabel(confidence: number): { text: string; className: string } {
  if (confidence >= 0.7) return { text: 'High confidence', className: 'text-success' };
  if (confidence >= 0.4) return { text: 'Medium confidence', className: 'text-gold-light' };
  return { text: 'Low confidence — check this', className: 'text-danger' };
}

/**
 * The mandatory review step.
 *
 * Every AI-derived number arrives here as an editable input, framed as an estimate.
 * Nothing reaches the log until the user presses the button on this screen.
 */
export function ScanReview({
  items: initialItems,
  note,
  preview,
  defaultMeal,
  onCancel,
  onLog,
}: ScanReviewProps): JSX.Element {
  const [items, setItems] = useState<AnalyzedItem[]>(initialItems);
  const [meal, setMeal] = useState<MealSlot>(defaultMeal);

  const totals = useMemo(() => sumMacros(items), [items]);

  const updateItem = (index: number, key: NumericKey, raw: string): void => {
    const parsed = Number(raw);
    const value = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
    setItems((current) =>
      current.map((item, i) => (i === index ? { ...item, [key]: value } : item)),
    );
  };

  const updateName = (index: number, name: string): void => {
    setItems((current) => current.map((item, i) => (i === index ? { ...item, name } : item)));
  };

  const removeItem = (index: number): void => {
    setItems((current) => current.filter((_, i) => i !== index));
  };

  return (
    <div className="flex flex-col gap-4">
      <header>
        <span className="eyebrow">Review estimate</span>
        <h1 className="text-2xl font-extrabold leading-tight">Check before logging</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-gray">
          These are the model’s <span className="font-semibold text-white">estimates</span>, not
          measurements. Edit anything that looks wrong — nothing is logged until you confirm.
        </p>
      </header>

      {preview ? (
        <img
          src={preview}
          alt="The meal you photographed"
          className="max-h-40 w-full rounded-md object-cover"
        />
      ) : null}

      {note ? (
        <p className="flex gap-2 rounded-md border border-[color:var(--border)] bg-surface-2/60 px-3 py-2.5 text-[11px] leading-relaxed text-gray">
          <Info size={14} className="mt-0.5 shrink-0 text-gold" aria-hidden="true" />
          <span>
            <span className="font-semibold text-white">Model note:</span> {note}
          </span>
        </p>
      ) : null}

      {items.length === 0 ? (
        <Card className="text-center">
          <p className="text-sm text-gray">
            You removed every item. Nothing will be logged.
          </p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((item, index) => {
            const confidence = confidenceLabel(item.confidence);
            return (
              <li
                key={`${item.name}-${index}`}
                className="rounded-md border border-[color:var(--border)] bg-surface-2/70 p-3.5"
              >
                <div className="mb-3 flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <label htmlFor={`item-name-${index}`} className="sr-only">
                      Food name for item {index + 1}
                    </label>
                    <input
                      id={`item-name-${index}`}
                      value={item.name}
                      onChange={(event) => updateName(index, event.target.value)}
                      className="min-h-[44px] w-full rounded-sm border border-transparent bg-transparent text-sm font-bold text-white hover:border-[color:var(--border)] focus:border-[color:var(--border-strong)]"
                    />
                    <p className={cn('text-[11px] font-medium', confidence.className)}>
                      {confidence.text} ({Math.round(item.confidence * 100)}%)
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => removeItem(index)}
                    aria-label={`Remove ${item.name} from this scan`}
                    className="grid h-11 w-11 shrink-0 place-items-center rounded-sm text-gray-soft transition-colors hover:bg-surface-3 hover:text-danger"
                  >
                    <Trash2 size={16} aria-hidden="true" />
                  </button>
                </div>

                <div className="grid grid-cols-5 gap-1.5">
                  {FIELDS.map((field) => (
                    <div key={field.key} className="flex flex-col gap-1">
                      <label
                        htmlFor={`item-${index}-${field.key}`}
                        className="text-[10px] uppercase tracking-wide text-gray"
                      >
                        {field.label}
                      </label>
                      <input
                        id={`item-${index}-${field.key}`}
                        type="number"
                        inputMode="decimal"
                        min={0}
                        value={item[field.key]}
                        onChange={(event) => updateItem(index, field.key, event.target.value)}
                        className="min-h-[44px] w-full rounded-sm border border-[color:var(--border)] bg-black-soft px-1.5 text-center text-sm tabular-nums text-white focus:border-[color:var(--border-strong)]"
                      />
                    </div>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Card className="border-[color:var(--border-strong)]" aria-live="polite">
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-semibold text-gray">Total to log</span>
          <span className="text-2xl font-extrabold tabular-nums">
            {Math.round(totals.kcal)} kcal
          </span>
        </div>
        <p className="mt-1 text-xs text-gray tabular-nums">
          P {Math.round(totals.protein)} g · C {Math.round(totals.carbs)} g · F{' '}
          {Math.round(totals.fat)} g
        </p>
      </Card>

      <Segmented legend="Meal" options={MEAL_OPTIONS} value={meal} onChange={setMeal} columns={2} />

      <div className="flex gap-2">
        <Button variant="secondary" className="flex-1" onClick={onCancel}>
          <X size={18} aria-hidden="true" />
          Discard
        </Button>
        <Button
          className="flex-1"
          disabled={items.length === 0}
          onClick={() => onLog(items, meal)}
        >
          <Check size={18} aria-hidden="true" />
          Log {items.length} item{items.length === 1 ? '' : 's'}
        </Button>
      </div>
    </div>
  );
}
