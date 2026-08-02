import { useId, useState } from 'react';
import { Check } from 'lucide-react';
import type { CustomFood, FoodCategory } from '@/types';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { listCategories } from '@/lib/search';
import { useStore } from '@/lib/useStore';

const CATEGORIES = listCategories();

interface CustomFoodFormProps {
  /** Present when editing an existing custom food; absent when creating one. */
  initial?: CustomFood;
  /** Prefills the name — e.g. from a search query with no matches (E-7). */
  defaultName?: string;
  onSaved: (food: CustomFood) => void;
  onCancel: () => void;
}

interface NumberField {
  raw: string;
  parsed: number;
  valid: boolean;
}

function readNumber(raw: string): NumberField {
  const parsed = Number(raw);
  return { raw, parsed, valid: raw.trim() !== '' && Number.isFinite(parsed) && parsed >= 0 };
}

/**
 * Create/edit a custom food — same per-100 g shape as the built-in database
 * (docs/DB.md §4.7), so it drops straight into search, favourites and the portion
 * step. The honesty rule applies to the user's own numbers too: nothing here claims
 * to be a verified reference value, and the badge is applied everywhere this food
 * is shown, not just here.
 */
export function CustomFoodForm({
  initial,
  defaultName,
  onSaved,
  onCancel,
}: CustomFoodFormProps): JSX.Element {
  const store = useStore();
  const formId = useId();

  const [name, setName] = useState(initial?.name ?? defaultName ?? '');
  const [category, setCategory] = useState<FoodCategory>(initial?.category ?? 'snacks');
  const [kcal, setKcal] = useState(() => readNumber(String(initial?.kcal ?? '')));
  const [protein, setProtein] = useState(() => readNumber(String(initial?.protein ?? '')));
  const [carbs, setCarbs] = useState(() => readNumber(String(initial?.carbs ?? '')));
  const [fat, setFat] = useState(() => readNumber(String(initial?.fat ?? '')));
  const [portionLabel, setPortionLabel] = useState(initial?.commonPortions[0]?.label ?? '');
  const [portionGrams, setPortionGrams] = useState(
    initial?.commonPortions[0]?.grams ? String(initial.commonPortions[0].grams) : '',
  );

  const nameError = name.trim() === '' ? 'Give this food a name.' : undefined;
  const numbersValid = kcal.valid && protein.valid && carbs.valid && fat.valid;
  const canSave = !nameError && numbersValid;

  const handleSubmit = (event: React.FormEvent): void => {
    event.preventDefault();
    if (!canSave) return;

    const portionGramsNum = Number(portionGrams);
    const commonPortions =
      portionLabel.trim() && Number.isFinite(portionGramsNum) && portionGramsNum > 0
        ? [{ label: portionLabel.trim(), grams: portionGramsNum }]
        : [];

    const fields = {
      name: name.trim(),
      category,
      kcal: kcal.parsed,
      protein: protein.parsed,
      carbs: carbs.parsed,
      fat: fat.parsed,
      per: 100 as const,
      commonPortions,
    };

    const saved = initial
      ? store.updateCustomFood(initial.id, fields)
      : store.addCustomFood(fields);

    if (saved) onSaved(saved);
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <p className="text-xs leading-relaxed text-gray-soft">
        These are your own numbers — FitMacro hasn&apos;t checked them. They&apos;ll always show
        a &ldquo;Custom&rdquo; badge so they&apos;re never mistaken for a verified reference value.
      </p>

      <Field
        label="Name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="My protein shake"
        autoFocus
        {...(nameError ? { error: nameError } : {})}
      />

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${formId}-category`} className="text-sm font-semibold text-white">
          Category
        </label>
        <select
          id={`${formId}-category`}
          value={category}
          onChange={(event) => setCategory(event.target.value as FoodCategory)}
          className="min-h-[48px] w-full rounded-md border border-[color:var(--border)] bg-black-soft px-4 text-[15px] capitalize text-white focus:border-[color:var(--border-strong)]"
        >
          {CATEGORIES.map((option) => (
            <option key={option} value={option} className="capitalize">
              {option}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field
          label="Calories"
          type="number"
          inputMode="decimal"
          min={0}
          suffix="kcal"
          value={kcal.raw}
          onChange={(event) => setKcal(readNumber(event.target.value))}
          {...(kcal.raw !== '' && !kcal.valid ? { error: 'Enter 0 or more.' } : {})}
        />
        <Field
          label="Protein"
          type="number"
          inputMode="decimal"
          min={0}
          suffix="g"
          value={protein.raw}
          onChange={(event) => setProtein(readNumber(event.target.value))}
          {...(protein.raw !== '' && !protein.valid ? { error: 'Enter 0 or more.' } : {})}
        />
        <Field
          label="Carbs"
          type="number"
          inputMode="decimal"
          min={0}
          suffix="g"
          value={carbs.raw}
          onChange={(event) => setCarbs(readNumber(event.target.value))}
          {...(carbs.raw !== '' && !carbs.valid ? { error: 'Enter 0 or more.' } : {})}
        />
        <Field
          label="Fat"
          type="number"
          inputMode="decimal"
          min={0}
          suffix="g"
          value={fat.raw}
          onChange={(event) => setFat(readNumber(event.target.value))}
          {...(fat.raw !== '' && !fat.valid ? { error: 'Enter 0 or more.' } : {})}
        />
      </div>
      <p className="-mt-2 text-[11px] text-gray-soft">Per 100 g, same as the food database.</p>

      <div className="grid grid-cols-2 gap-3">
        <Field
          label="Typical portion (optional)"
          value={portionLabel}
          onChange={(event) => setPortionLabel(event.target.value)}
          placeholder="1 scoop"
        />
        <Field
          label="Portion weight"
          type="number"
          inputMode="decimal"
          min={0}
          suffix="g"
          value={portionGrams}
          onChange={(event) => setPortionGrams(event.target.value)}
          placeholder="30"
        />
      </div>

      <div className="flex gap-2">
        <Button type="button" variant="ghost" className="flex-1" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" className="flex-1" disabled={!canSave}>
          <Check size={18} aria-hidden="true" />
          {initial ? 'Save changes' : 'Add food'}
        </Button>
      </div>
    </form>
  );
}
