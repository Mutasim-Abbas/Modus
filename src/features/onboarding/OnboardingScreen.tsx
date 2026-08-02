import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import type { ActivityLevel, Goal, Profile, Sex } from '@/types';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Field } from '@/components/Field';
import { Segmented } from '@/components/Segmented';
import { ACTIVITY_LABELS, GOAL_ADJUSTMENTS, LIMITS, calculateTargets } from '@/lib/macros';
import { useStore } from '@/lib/useStore';

const SEX_OPTIONS = [
  { value: 'male' as Sex, label: 'Male' },
  { value: 'female' as Sex, label: 'Female' },
];

const ACTIVITY_OPTIONS = (Object.keys(ACTIVITY_LABELS) as ActivityLevel[]).map((level) => ({
  value: level,
  label: ACTIVITY_LABELS[level].title,
  hint: ACTIVITY_LABELS[level].hint,
}));

const GOAL_OPTIONS = [
  { value: 'cut' as Goal, label: 'Cut', hint: `${Math.round(GOAL_ADJUSTMENTS.cut * 100)}% kcal` },
  { value: 'maintain' as Goal, label: 'Maintain', hint: 'TDEE' },
  { value: 'bulk' as Goal, label: 'Bulk', hint: `+${Math.round(GOAL_ADJUSTMENTS.bulk * 100)}% kcal` },
];

interface FormValues {
  sex: Sex;
  age: string;
  heightCm: string;
  weightKg: string;
  activity: ActivityLevel;
  goal: Goal;
}

const INITIAL: FormValues = {
  sex: 'male',
  age: '',
  heightCm: '',
  weightKg: '',
  activity: 'moderate',
  goal: 'maintain',
};

type NumericField = 'age' | 'heightCm' | 'weightKg';

const RANGES: Record<NumericField, { min: number; max: number; label: string }> = {
  age: { ...LIMITS.age, label: 'Age' },
  heightCm: { ...LIMITS.heightCm, label: 'Height' },
  weightKg: { ...LIMITS.weightKg, label: 'Weight' },
};

/** Validates at the boundary: strings from the DOM in, a trusted Profile out. */
function validate(values: FormValues): {
  errors: Partial<Record<NumericField, string>>;
  profile: Profile | null;
} {
  const errors: Partial<Record<NumericField, string>> = {};

  for (const key of Object.keys(RANGES) as NumericField[]) {
    const raw = values[key].trim();
    const range = RANGES[key];

    if (!raw) {
      errors[key] = `${range.label} is required.`;
      continue;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      errors[key] = `${range.label} must be a number.`;
      continue;
    }
    if (parsed < range.min || parsed > range.max) {
      errors[key] = `${range.label} must be between ${range.min} and ${range.max}.`;
    }
  }

  if (Object.keys(errors).length > 0) return { errors, profile: null };

  return {
    errors,
    profile: {
      sex: values.sex,
      age: Number(values.age),
      heightCm: Number(values.heightCm),
      weightKg: Number(values.weightKg),
      activity: values.activity,
      goal: values.goal,
    },
  };
}

export function OnboardingScreen(): JSX.Element {
  const store = useStore();
  const navigate = useNavigate();
  const [values, setValues] = useState<FormValues>(INITIAL);
  const [submitted, setSubmitted] = useState(false);

  const { errors, profile } = useMemo(() => validate(values), [values]);
  const showErrors = submitted ? errors : {};

  // Live preview — only once the inputs are actually valid. No placeholder numbers.
  const preview = useMemo(() => (profile ? calculateTargets(profile) : null), [profile]);

  const set = <K extends keyof FormValues>(key: K, value: FormValues[K]): void =>
    setValues((current) => ({ ...current, [key]: value }));

  const handleSubmit = (event: React.FormEvent): void => {
    event.preventDefault();
    setSubmitted(true);
    if (!profile) return;
    store.setProfile(profile);
    navigate('/', { replace: true });
  };

  return (
    <div className="app-frame min-h-[100dvh] px-4 py-8">
      <header className="mb-6">
        <div className="mb-4 flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-md bg-gold-mark text-black font-extrabold">
            FM
          </span>
          <div>
            <p className="text-base font-extrabold leading-tight">
              Fit<span className="text-gold-light">Macro</span>
            </p>
            <p className="text-xs text-gray">Nutrition tracker</p>
          </div>
        </div>

        <h1 className="text-2xl font-extrabold leading-tight">Let’s set your targets</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-gray">
          Six answers. We calculate your calories with the Mifflin-St Jeor equation — the same
          formula dietitians use — and split them into macros.
        </p>
      </header>

      <Card className="mb-4 flex gap-3 border-[color:var(--border-strong)] bg-surface-2/80 p-4">
        <ShieldCheck size={18} className="mt-0.5 shrink-0 text-success" aria-hidden="true" />
        <p className="text-xs leading-relaxed text-gray">
          <span className="font-semibold text-white">No account needed.</span> Everything you log is
          stored on this device. Create a free account later if you want it to follow you to another
          device — until then, clearing your browser data deletes it. You can export it any time from
          Profile.
        </p>
      </Card>

      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
        <Segmented legend="Sex" options={SEX_OPTIONS} value={values.sex} onChange={(v) => set('sex', v)} />

        <div className="grid grid-cols-3 gap-3">
          <Field
            label="Age"
            type="number"
            inputMode="numeric"
            value={values.age}
            onChange={(e) => set('age', e.target.value)}
            suffix="yr"
            min={LIMITS.age.min}
            max={LIMITS.age.max}
            {...(showErrors.age ? { error: showErrors.age } : {})}
          />
          <Field
            label="Height"
            type="number"
            inputMode="numeric"
            value={values.heightCm}
            onChange={(e) => set('heightCm', e.target.value)}
            suffix="cm"
            min={LIMITS.heightCm.min}
            max={LIMITS.heightCm.max}
            {...(showErrors.heightCm ? { error: showErrors.heightCm } : {})}
          />
          <Field
            label="Weight"
            type="number"
            inputMode="decimal"
            step="0.1"
            value={values.weightKg}
            onChange={(e) => set('weightKg', e.target.value)}
            suffix="kg"
            min={LIMITS.weightKg.min}
            max={LIMITS.weightKg.max}
            {...(showErrors.weightKg ? { error: showErrors.weightKg } : {})}
          />
        </div>

        <Segmented
          legend="Activity level"
          options={ACTIVITY_OPTIONS}
          value={values.activity}
          onChange={(v) => set('activity', v)}
          columns={1}
        />

        <Segmented
          legend="Goal"
          options={GOAL_OPTIONS}
          value={values.goal}
          onChange={(v) => set('goal', v)}
          columns={3}
        />

        {preview ? (
          <Card aria-live="polite" className="border-[color:var(--border-strong)]">
            <span className="eyebrow">Your targets</span>
            <p className="text-3xl font-extrabold tabular-nums">
              {preview.kcal} <span className="text-base font-semibold text-gray">kcal / day</span>
            </p>
            <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
              {(
                [
                  ['Protein', preview.protein, 'var(--protein)'],
                  ['Carbs', preview.carbs, 'var(--carbs)'],
                  ['Fat', preview.fat, 'var(--fat)'],
                ] as const
              ).map(([label, grams, color]) => (
                <div key={label} className="rounded-sm bg-black-soft py-2">
                  <dt className="text-[11px] uppercase tracking-wide text-gray">{label}</dt>
                  <dd className="text-lg font-bold tabular-nums" style={{ color }}>
                    {grams} g
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-[11px] leading-relaxed text-gray-soft">
              BMR {preview.bmr} kcal (Mifflin-St Jeor) · TDEE {preview.tdee} kcal · goal adjustment{' '}
              {Math.round(GOAL_ADJUSTMENTS[values.goal] * 100)}%. An estimate, not medical advice.
            </p>
          </Card>
        ) : null}

        <Button type="submit" className="w-full">
          Start tracking
          <ArrowRight size={18} aria-hidden="true" />
        </Button>
      </form>
    </div>
  );
}
