import { useMemo, useState } from 'react';
import { ArrowLeft, Check } from 'lucide-react';
import type { Food, MealSlot } from '@/types';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { Segmented } from '@/components/Segmented';
import { macrosForGrams } from '@/lib/macros';
import { cn } from '@/lib/cn';
import { MEAL_LABELS, MEAL_OPTIONS } from '@/features/log/meals';
import { BRAND } from '@/lib/brand';

interface PortionPanelProps {
  food: Food;
  defaultMeal: MealSlot;
  onBack: () => void;
  onAdd: (grams: number, meal: MealSlot) => void;
  /** True for a user-entered food — swaps the reference-value footnote for the honesty note. */
  isCustom?: boolean;
  /** Overrides the default starting portion (e.g. "last grams used") over the food's first
   *  common portion. */
  initialGrams?: number;
}

export function PortionPanel({
  food,
  defaultMeal,
  onBack,
  onAdd,
  isCustom = false,
  initialGrams,
}: PortionPanelProps): JSX.Element {
  const firstPortion = food.commonPortions[0];
  const [grams, setGrams] = useState<string>(String(initialGrams ?? firstPortion?.grams ?? 100));
  const [meal, setMeal] = useState<MealSlot>(defaultMeal);

  const parsedGrams = Number(grams);
  const validGrams = Number.isFinite(parsedGrams) && parsedGrams > 0 && parsedGrams <= 5000;
  const macros = useMemo(
    () => macrosForGrams(food, validGrams ? parsedGrams : 0),
    [food, parsedGrams, validGrams],
  );

  const error = grams.trim() === '' ? 'Enter a portion size.' : !validGrams ? 'Enter a weight between 1 and 5000 g.' : undefined;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          className="grid h-11 w-11 place-items-center rounded-sm text-gray transition-colors hover:bg-surface-2 hover:text-white"
          aria-label="Back to search results"
        >
          <ArrowLeft size={18} aria-hidden="true" />
        </button>
        <div className="min-w-0">
          <h2 className="truncate text-lg font-extrabold leading-tight">{food.name}</h2>
          <p className="text-xs text-gray">
            {isCustom ? 'Custom · your numbers' : <span className="capitalize">{food.category}</span>}
          </p>
        </div>
      </div>

      {food.commonPortions.length > 0 ? (
        <div>
          <p className="mb-2 text-sm font-semibold">Common portions</p>
          <div className="flex flex-wrap gap-2">
            {food.commonPortions.map((portion) => {
              const active = Number(grams) === portion.grams;
              return (
                <button
                  key={`${portion.label}-${portion.grams}`}
                  type="button"
                  onClick={() => setGrams(String(portion.grams))}
                  aria-pressed={active}
                  className={cn(
                    'min-h-[44px] rounded-md border px-3.5 text-sm transition-colors',
                    active
                      ? 'border-[color:var(--border-strong)] bg-gold/15 font-bold text-white'
                      : 'border-[color:var(--border)] bg-surface-2 text-gray hover:text-white',
                  )}
                >
                  {portion.label}
                  <span className="ms-1.5 text-xs text-gray-soft tabular-nums">
                    {portion.grams} g
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      <Field
        label="Portion"
        type="number"
        inputMode="decimal"
        value={grams}
        onChange={(event) => setGrams(event.target.value)}
        suffix="g"
        min={1}
        max={5000}
        {...(error ? { error } : {})}
      />

      <Segmented legend="Meal" options={MEAL_OPTIONS} value={meal} onChange={setMeal} columns={2} />

      <div
        className="rounded-md border border-[color:var(--border-strong)] bg-surface-2/70 p-4"
        aria-live="polite"
      >
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-semibold text-gray">This portion</span>
          <span className="text-2xl font-extrabold tabular-nums">{macros.kcal} kcal</span>
        </div>
        <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
          {(
            [
              ['Protein', macros.protein, 'var(--protein)'],
              ['Carbs', macros.carbs, 'var(--carbs)'],
              ['Fat', macros.fat, 'var(--fat)'],
            ] as const
          ).map(([label, value, color]) => (
            <div key={label} className="rounded-sm bg-black-soft py-2">
              <dt className="text-[11px] uppercase tracking-wide text-gray">{label}</dt>
              <dd className="text-base font-bold tabular-nums" style={{ color }}>
                {value} g
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-[11px] leading-relaxed text-gray-soft">
          {isCustom
            ? `Based on the numbers you entered — ${BRAND.name} hasn’t checked them.`
            : `Based on ${food.kcal} kcal per 100 g — an approximate reference value.`}
        </p>
      </div>

      <Button
        className="w-full"
        disabled={!validGrams}
        onClick={() => validGrams && onAdd(parsedGrams, meal)}
      >
        <Check size={18} aria-hidden="true" />
        Add to {MEAL_LABELS[meal]}
      </Button>
    </div>
  );
}
