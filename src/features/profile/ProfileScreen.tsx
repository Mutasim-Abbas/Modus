import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ChevronRight,
  CloudOff,
  Download,
  HardDrive,
  RotateCcw,
  Save,
  Scale,
  UserRoundPlus,
} from 'lucide-react';
import type { ActivityLevel, Goal, Profile, Sex } from '@/types';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { Field } from '@/components/Field';
import { Segmented } from '@/components/Segmented';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Sparkline } from '@/components/charts/Sparkline';
import { LinkButton } from '@/components/LinkButton';
import { useAuth } from '@/features/auth/AuthContext';
import {
  ACTIVITY_LABELS,
  FAT_KCAL_SHARE,
  GOAL_ADJUSTMENTS,
  LIMITS,
  PROTEIN_G_PER_KG,
  calculateTargets,
} from '@/lib/macros';
import { selectLiveWeights } from '@/lib/store';
import { formatDayLabel } from '@/lib/date';
import { useAppState, useStore } from '@/lib/useStore';

const SEX_OPTIONS = [
  { value: 'male' as Sex, label: 'Male' },
  { value: 'female' as Sex, label: 'Female' },
];

const ACTIVITY_OPTIONS = (Object.keys(ACTIVITY_LABELS) as ActivityLevel[]).map((level) => ({
  value: level,
  label: ACTIVITY_LABELS[level].title,
  hint: ACTIVITY_LABELS[level].hint,
}));

const GOAL_OPTIONS: { value: Goal; label: string }[] = [
  { value: 'cut', label: 'Cut' },
  { value: 'maintain', label: 'Maintain' },
  { value: 'bulk', label: 'Bulk' },
];

export function ProfileScreen(): JSX.Element {
  const state = useAppState();
  const store = useStore();
  const auth = useAuth();
  const profile = state.profile;

  const [draft, setDraft] = useState<Profile | null>(profile);
  const [saved, setSaved] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);

  const preview = useMemo(() => (draft ? calculateTargets(draft) : null), [draft]);
  const weights = useMemo(() => selectLiveWeights(state), [state]);
  const latestWeight = weights[weights.length - 1] ?? null;

  if (!draft || !preview) return <></>;

  const set = <K extends keyof Profile>(key: K, value: Profile[K]): void => {
    setDraft({ ...draft, [key]: value });
    setSaved(false);
  };

  const setNumber = (key: 'age' | 'heightCm' | 'weightKg', raw: string): void => {
    const parsed = Number(raw);
    set(key, Number.isFinite(parsed) ? parsed : 0);
  };

  const handleSave = (): void => {
    store.setProfile(draft);
    setSaved(true);
  };

  const handleExport = (): void => {
    const blob = new Blob([store.exportJSON()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `fitmacro-export-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleReset = (): void => {
    store.reset();
    setConfirmingReset(false);
  };

  const outOfRange =
    draft.age < LIMITS.age.min ||
    draft.age > LIMITS.age.max ||
    draft.heightCm < LIMITS.heightCm.min ||
    draft.heightCm > LIMITS.heightCm.max ||
    draft.weightKg < LIMITS.weightKg.min ||
    draft.weightKg > LIMITS.weightKg.max;

  return (
    <div className="flex flex-col gap-5">
      <ScreenHeader
        eyebrow="Profile"
        title="Your details and targets"
        subtitle="Change anything here and your targets recalculate immediately."
      />

      {!store.isPersisted() ? (
        <p
          role="alert"
          className="flex gap-2 rounded-md border border-[color:var(--danger)]/40 bg-danger/10 px-3 py-3 text-xs leading-relaxed text-white"
        >
          <AlertTriangle size={15} className="mt-0.5 shrink-0 text-danger" aria-hidden="true" />
          <span>
            <span className="font-semibold">Saving is not working in this browser.</span> Private
            mode or blocked storage means your log will be lost when you close the tab.
          </span>
        </p>
      ) : null}

      <div className="flex flex-col gap-5">
        <Segmented legend="Sex" options={SEX_OPTIONS} value={draft.sex} onChange={(v) => set('sex', v)} />

        <div className="grid grid-cols-3 gap-3">
          <Field
            label="Age"
            type="number"
            inputMode="numeric"
            value={String(draft.age)}
            onChange={(e) => setNumber('age', e.target.value)}
            suffix="yr"
          />
          <Field
            label="Height"
            type="number"
            inputMode="numeric"
            value={String(draft.heightCm)}
            onChange={(e) => setNumber('heightCm', e.target.value)}
            suffix="cm"
          />
          <Field
            label="Weight"
            type="number"
            inputMode="decimal"
            step="0.1"
            value={String(draft.weightKg)}
            onChange={(e) => setNumber('weightKg', e.target.value)}
            suffix="kg"
          />
        </div>

        {outOfRange ? (
          <p role="alert" className="text-xs font-medium text-danger">
            Some values are outside the supported range and will be clamped
            (age {LIMITS.age.min}-{LIMITS.age.max}, height {LIMITS.heightCm.min}-
            {LIMITS.heightCm.max} cm, weight {LIMITS.weightKg.min}-{LIMITS.weightKg.max} kg).
          </p>
        ) : null}

        <Segmented
          legend="Activity level"
          options={ACTIVITY_OPTIONS}
          value={draft.activity}
          onChange={(v) => set('activity', v)}
          columns={1}
        />

        <Segmented
          legend="Goal"
          options={GOAL_OPTIONS}
          value={draft.goal}
          onChange={(v) => set('goal', v)}
          columns={3}
        />

        <Card aria-live="polite" className="border-[color:var(--border-strong)]">
          <span className="eyebrow">Calculated targets</span>
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
        </Card>

        <Button onClick={handleSave} className="w-full">
          <Save size={18} aria-hidden="true" />
          {saved ? 'Saved' : 'Save changes'}
        </Button>
        <div role="status" aria-live="polite" className="sr-only">
          {saved ? 'Profile saved and targets updated.' : ''}
        </div>
      </div>

      <section aria-labelledby="body-weight">
        <h2 id="body-weight" className="mb-2 text-base font-bold">
          Body weight
        </h2>
        <Card>
          <Link
            to="/profile/weight"
            className="-m-1 flex items-center gap-3 rounded-md p-1 transition-colors hover:bg-surface-2"
          >
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-sm bg-surface-2 text-gold-light">
              <Scale size={18} aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              {latestWeight ? (
                <>
                  <span className="block text-lg font-extrabold tabular-nums text-white">
                    {latestWeight.weightKg} kg
                  </span>
                  <span className="block text-xs text-gray">
                    Latest reading — {formatDayLabel(latestWeight.day)}
                  </span>
                </>
              ) : (
                <>
                  <span className="block text-sm font-semibold text-white">No readings yet</span>
                  <span className="block text-xs text-gray">Add your first weigh-in</span>
                </>
              )}
            </span>
            {weights.length >= 2 ? (
              <Sparkline values={weights.slice(-14).map((w) => w.weightKg)} />
            ) : null}
            <ChevronRight size={18} aria-hidden="true" className="shrink-0 text-gray-soft" />
          </Link>
        </Card>
        <LinkButton to="/profile/weight" variant="secondary" className="mt-3 w-full">
          <Scale size={16} aria-hidden="true" />
          {latestWeight ? 'Manage weight log' : 'Add reading'}
        </LinkButton>
      </section>

      <section aria-labelledby="preferences">
        <h2 id="preferences" className="mb-2 text-base font-bold">
          Preferences
        </h2>
        <Card>
          <label className="flex cursor-pointer items-center justify-between gap-4">
            <span>
              <span className="block text-sm font-semibold text-white">Reduce motion</span>
              <span className="mt-0.5 block text-xs leading-relaxed text-gray">
                Turns off screen transitions and ring animations. Your system setting is
                already respected — this forces it on regardless.
              </span>
            </span>
            <input
              type="checkbox"
              checked={state.settings.reducedMotion}
              onChange={(event) => store.setSettings({ reducedMotion: event.target.checked })}
              className="h-6 w-6 shrink-0 accent-[color:var(--gold)]"
            />
          </label>
        </Card>
      </section>

      <section aria-labelledby="how-it-works">
        <h2 id="how-it-works" className="mb-2 text-base font-bold">
          How your targets are calculated
        </h2>
        <Card className="text-xs leading-relaxed text-gray">
          <ol className="flex list-decimal flex-col gap-1.5 ps-4">
            <li>
              <span className="text-white">BMR</span> from the Mifflin-St Jeor equation (1990) —{' '}
              {preview.bmr} kcal.
            </li>
            <li>
              <span className="text-white">TDEE</span> = BMR × {ACTIVITY_LABELS[draft.activity].title.toLowerCase()} factor
              — {preview.tdee} kcal.
            </li>
            <li>
              <span className="text-white">Goal adjustment</span> of{' '}
              {Math.round(GOAL_ADJUSTMENTS[draft.goal] * 100)}% → {preview.kcal} kcal.
            </li>
            <li>
              <span className="text-white">Macros</span>: protein {PROTEIN_G_PER_KG[draft.goal]} g/kg
              of bodyweight, fat {Math.round(FAT_KCAL_SHARE * 100)}% of calories, carbs take the
              rest (4/4/9 kcal per g).
            </li>
          </ol>
          <p className="mt-3 text-gray-soft">
            These are population-level estimates. They are not medical advice — talk to a
            professional before making significant dietary changes.
          </p>
        </Card>
      </section>

      <section aria-labelledby="your-data">
        <h2 id="your-data" className="mb-2 text-base font-bold">
          Your data
        </h2>
        <Card className="flex flex-col gap-3">
          <p className="flex gap-2 text-xs leading-relaxed text-gray">
            <HardDrive size={15} className="mt-0.5 shrink-0 text-gold" aria-hidden="true" />
            {auth.status === 'signed-in' ? (
              <span>
                <span className="font-semibold text-white">Your data is synced to your account.</span>{' '}
                Everything you log is stored here on this device and, because you&rsquo;re signed in,
                also on FitMacro&rsquo;s server so it follows you to another device. Nobody else can see
                it. Photos you scan are sent for analysis only and are not stored.
              </span>
            ) : (
              <span>
                <span className="font-semibold text-white">
                  No account, no server, by default.
                </span>{' '}
                Everything you log lives in this browser’s local storage, on this device only. It is
                never uploaded, and nobody else can see it. Clearing your browser data — or using a
                different device — means starting fresh, unless you create a free account to sync it.
                Photos you scan are sent for analysis only and are not stored.
              </span>
            )}
          </p>

          <Button variant="secondary" onClick={handleExport}>
            <Download size={18} aria-hidden="true" />
            Export my data (JSON)
          </Button>

          {confirmingReset ? (
            <div className="flex flex-col gap-2 rounded-md border border-[color:var(--danger)]/40 bg-danger/10 p-3">
              <p className="text-xs font-medium text-white">
                Delete your profile and every logged day? This cannot be undone.
              </p>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" className="flex-1" onClick={() => setConfirmingReset(false)}>
                  Cancel
                </Button>
                <Button size="sm" variant="danger" className="flex-1" onClick={handleReset}>
                  Delete everything
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="danger" onClick={() => setConfirmingReset(true)}>
              <RotateCcw size={18} aria-hidden="true" />
              Reset all data
            </Button>
          )}
        </Card>
      </section>

      <section aria-labelledby="account">
        <h2 id="account" className="mb-2 text-base font-bold">
          Account
        </h2>
        {auth.status === 'unconfigured' ? (
          <EmptyState
            icon={CloudOff}
            title="Accounts aren't set up on this deployment"
            description="This copy of FitMacro has no database connected, so there's nothing to sign in to. Everything still works and stays on this device."
          />
        ) : auth.status === 'signed-in' && auth.user ? (
          <Card className="flex items-center justify-between gap-3">
            <span className="min-w-0 truncate text-sm font-semibold text-white">{auth.user.email}</span>
            <LinkButton to="/account" variant="secondary" className="shrink-0">
              Manage
            </LinkButton>
          </Card>
        ) : (
          <EmptyState
            icon={UserRoundPlus}
            title="You're not signed in"
            description="FitMacro is saving everything on this device. Create an account and your log follows you to your phone, laptop and back."
            action={
              <div className="flex w-full flex-col gap-2 sm:flex-row">
                <LinkButton to="/auth/sign-up" className="flex-1">
                  Create account
                </LinkButton>
                <LinkButton to="/auth/sign-in" variant="secondary" className="flex-1">
                  Sign in
                </LinkButton>
              </div>
            }
          />
        )}
      </section>
    </div>
  );
}
