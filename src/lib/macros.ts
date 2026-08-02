import type { ActivityLevel, Goal, Macros, Profile, Sex, Targets } from '@/types';

/**
 * Macro engine — pure, deterministic, no I/O.
 *
 * Basis (industry-standard, not invented):
 *  - BMR: Mifflin-St Jeor equation (Mifflin MD, St Jeor ST, et al., 1990).
 *      male:   10*kg + 6.25*cm - 5*age + 5
 *      female: 10*kg + 6.25*cm - 5*age - 161
 *  - TDEE: BMR x activity factor (the conventional 1.2 / 1.375 / 1.55 / 1.725 / 1.9 set).
 *  - Atwater factors: 4 kcal/g protein, 4 kcal/g carbs, 9 kcal/g fat.
 *
 * Every coefficient below is one of the above. Nothing here is guessed.
 */

export const KCAL_PER_GRAM = { protein: 4, carbs: 4, fat: 9 } as const;

export const ACTIVITY_FACTORS: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  very: 1.725,
  extra: 1.9,
};

export const ACTIVITY_LABELS: Record<ActivityLevel, { title: string; hint: string }> = {
  sedentary: { title: 'Sedentary', hint: 'Desk job, little or no exercise (x1.2)' },
  light: { title: 'Light', hint: 'Light exercise 1-3 days/week (x1.375)' },
  moderate: { title: 'Moderate', hint: 'Moderate exercise 3-5 days/week (x1.55)' },
  very: { title: 'Very active', hint: 'Hard exercise 6-7 days/week (x1.725)' },
  extra: { title: 'Extra active', hint: 'Physical job or two-a-day training (x1.9)' },
};

/** Calorie adjustment applied to TDEE, as a fraction. Stated in the UI — no magic numbers. */
export const GOAL_ADJUSTMENTS: Record<Goal, number> = {
  cut: -0.2,
  maintain: 0,
  bulk: 0.15,
};

/** Protein target in grams per kg of bodyweight. Higher on a cut to protect lean mass. */
export const PROTEIN_G_PER_KG: Record<Goal, number> = {
  cut: 2.2,
  maintain: 1.8,
  bulk: 1.8,
};

/** Fat is set as a share of total calories; carbs take the remainder. */
export const FAT_KCAL_SHARE = 0.25;

/**
 * Sane input bounds. Values outside these are clamped rather than rejected, so the
 * engine can never produce NaN or a negative target from a stray input.
 */
export const LIMITS = {
  age: { min: 14, max: 100 },
  heightCm: { min: 120, max: 250 },
  weightKg: { min: 30, max: 300 },
} as const;

/**
 * Lower bound on a recommended daily calorie target. A widely used general guideline,
 * applied here as a safety floor — FitMacro is not medical advice.
 */
export const MIN_KCAL_FLOOR = 1200;

/**
 * Clamp with a NaN guard.
 *
 * NaN has no position on the number line, so it falls back to `min`. Infinities do have
 * one, so they clamp to the bound they run into (+Infinity -> max, -Infinity -> min)
 * rather than being lumped in with NaN.
 */
export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/** Rounds to a whole, finite, non-negative number of calories. NaN/Infinity collapse to 0. */
function toSafeKcal(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
}

/** Clamps a raw profile into the supported ranges. Always safe to feed to the engine. */
export function normalizeProfile(profile: Profile): Profile {
  return {
    sex: profile.sex === 'female' ? 'female' : 'male',
    age: Math.round(clamp(profile.age, LIMITS.age.min, LIMITS.age.max)),
    heightCm: Math.round(clamp(profile.heightCm, LIMITS.heightCm.min, LIMITS.heightCm.max)),
    weightKg: Math.round(clamp(profile.weightKg, LIMITS.weightKg.min, LIMITS.weightKg.max) * 10) / 10,
    activity: profile.activity in ACTIVITY_FACTORS ? profile.activity : 'sedentary',
    goal: profile.goal in GOAL_ADJUSTMENTS ? profile.goal : 'maintain',
  };
}

/** Mifflin-St Jeor basal metabolic rate, in kcal/day. */
export function calculateBMR(input: {
  sex: Sex;
  weightKg: number;
  heightCm: number;
  age: number;
}): number {
  const weightKg = clamp(input.weightKg, LIMITS.weightKg.min, LIMITS.weightKg.max);
  const heightCm = clamp(input.heightCm, LIMITS.heightCm.min, LIMITS.heightCm.max);
  const age = clamp(input.age, LIMITS.age.min, LIMITS.age.max);

  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  const bmr = input.sex === 'female' ? base - 161 : base + 5;

  return Math.max(0, Math.round(bmr));
}

/** Total daily energy expenditure = BMR x activity factor. */
export function calculateTDEE(bmr: number, activity: ActivityLevel): number {
  const factor = ACTIVITY_FACTORS[activity] ?? ACTIVITY_FACTORS.sedentary;
  return toSafeKcal(Math.max(0, toSafeKcal(bmr)) * factor);
}

/** Applies the goal adjustment to TDEE and enforces the calorie floor. */
export function applyGoal(tdee: number, goal: Goal): number {
  const adjustment = GOAL_ADJUSTMENTS[goal] ?? 0;
  const adjusted = toSafeKcal(toSafeKcal(tdee) * (1 + adjustment));
  return Math.max(MIN_KCAL_FLOOR, adjusted);
}

/**
 * Splits a calorie target into macros.
 *
 * protein = g/kg x bodyweight, fat = 25% of kcal, carbs = whatever calories remain.
 * If protein + fat alone exceed the target (possible for a heavy user on an
 * aggressive cut hitting the floor), carbs clamp to 0 rather than going negative —
 * the returned `kcal` then reflects the macros actually prescribed.
 */
export function splitMacros(kcalTarget: number, weightKg: number, goal: Goal): Macros {
  const kcal = toSafeKcal(kcalTarget);
  const weight = clamp(weightKg, LIMITS.weightKg.min, LIMITS.weightKg.max);
  const gPerKg = PROTEIN_G_PER_KG[goal] ?? PROTEIN_G_PER_KG.maintain;

  const protein = Math.round(weight * gPerKg);
  const fat = Math.round((kcal * FAT_KCAL_SHARE) / KCAL_PER_GRAM.fat);

  const proteinKcal = protein * KCAL_PER_GRAM.protein;
  const fatKcal = fat * KCAL_PER_GRAM.fat;
  const carbs = Math.max(0, Math.round((kcal - proteinKcal - fatKcal) / KCAL_PER_GRAM.carbs));

  const macroKcal = proteinKcal + fatKcal + carbs * KCAL_PER_GRAM.carbs;

  return { kcal: Math.max(kcal, macroKcal), protein, carbs, fat };
}

/** Full pipeline: profile -> BMR -> TDEE -> goal-adjusted calories -> macro split. */
export function calculateTargets(rawProfile: Profile): Targets {
  const profile = normalizeProfile(rawProfile);
  const bmr = calculateBMR(profile);
  const tdee = calculateTDEE(bmr, profile.activity);
  const kcalTarget = applyGoal(tdee, profile.goal);
  const macros = splitMacros(kcalTarget, profile.weightKg, profile.goal);

  return { bmr, tdee, ...macros };
}

/** Sums a list of macro-bearing items. Returns zeroes for an empty list. */
export function sumMacros(items: readonly Macros[]): Macros {
  return items.reduce<Macros>(
    (total, item) => ({
      kcal: total.kcal + (Number.isFinite(item.kcal) ? item.kcal : 0),
      protein: total.protein + (Number.isFinite(item.protein) ? item.protein : 0),
      carbs: total.carbs + (Number.isFinite(item.carbs) ? item.carbs : 0),
      fat: total.fat + (Number.isFinite(item.fat) ? item.fat : 0),
    }),
    { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  );
}

/** Target minus consumed, floored at 0 — "remaining" is never negative in the UI. */
export function remainingMacros(target: Macros, consumed: Macros): Macros {
  return {
    kcal: Math.max(0, Math.round(target.kcal - consumed.kcal)),
    protein: Math.max(0, Math.round(target.protein - consumed.protein)),
    carbs: Math.max(0, Math.round(target.carbs - consumed.carbs)),
    fat: Math.max(0, Math.round(target.fat - consumed.fat)),
  };
}

/** Completion ratio 0..1 (capped) for progress rings. Guards against a zero target. */
export function progressRatio(consumed: number, target: number): number {
  if (!Number.isFinite(consumed) || !Number.isFinite(target) || target <= 0) return 0;
  return clamp(consumed / target, 0, 1);
}

/** Scales a per-100g food to an arbitrary gram weight. */
export function macrosForGrams(
  per100g: Pick<Macros, 'kcal' | 'protein' | 'carbs' | 'fat'>,
  grams: number,
): Macros {
  const factor = Math.max(0, Number.isFinite(grams) ? grams : 0) / 100;
  const round = (n: number): number => Math.round(n * factor * 10) / 10;
  return {
    kcal: Math.round(per100g.kcal * factor),
    protein: round(per100g.protein),
    carbs: round(per100g.carbs),
    fat: round(per100g.fat),
  };
}
