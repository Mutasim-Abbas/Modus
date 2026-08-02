import { describe, expect, it } from 'vitest';
import type { Profile } from '@/types';
import {
  ACTIVITY_FACTORS,
  FAT_KCAL_SHARE,
  GOAL_ADJUSTMENTS,
  KCAL_PER_GRAM,
  LIMITS,
  MIN_KCAL_FLOOR,
  PROTEIN_G_PER_KG,
  applyGoal,
  calculateBMR,
  calculateTDEE,
  calculateTargets,
  clamp,
  macrosForGrams,
  normalizeProfile,
  progressRatio,
  remainingMacros,
  splitMacros,
  sumMacros,
} from '@/lib/macros';

const male: Profile = {
  sex: 'male',
  age: 30,
  heightCm: 180,
  weightKg: 80,
  activity: 'moderate',
  goal: 'maintain',
};

const female: Profile = {
  sex: 'female',
  age: 30,
  heightCm: 165,
  weightKg: 65,
  activity: 'light',
  goal: 'cut',
};

describe('calculateBMR — Mifflin-St Jeor', () => {
  it('matches the hand-computed value for a male (10w + 6.25h - 5a + 5)', () => {
    // 10*80 + 6.25*180 - 5*30 + 5 = 800 + 1125 - 150 + 5 = 1780
    expect(calculateBMR(male)).toBe(1780);
  });

  it('matches the hand-computed value for a female (10w + 6.25h - 5a - 161)', () => {
    // 10*65 + 6.25*165 - 5*30 - 161 = 650 + 1031.25 - 150 - 161 = 1370.25 -> 1370
    expect(calculateBMR(female)).toBe(1370);
  });

  it('differs by exactly 166 between sexes at identical body stats', () => {
    const stats = { age: 40, heightCm: 175, weightKg: 70 };
    const difference =
      calculateBMR({ ...stats, sex: 'male' }) - calculateBMR({ ...stats, sex: 'female' });
    expect(difference).toBe(166); // +5 vs -161
  });

  it('decreases with age and increases with weight and height', () => {
    expect(calculateBMR({ ...male, age: 50 })).toBeLessThan(calculateBMR(male));
    expect(calculateBMR({ ...male, weightKg: 90 })).toBeGreaterThan(calculateBMR(male));
    expect(calculateBMR({ ...male, heightCm: 190 })).toBeGreaterThan(calculateBMR(male));
  });

  it('clamps out-of-range inputs instead of returning absurd values', () => {
    expect(calculateBMR({ ...male, weightKg: 5000 })).toBe(
      calculateBMR({ ...male, weightKg: LIMITS.weightKg.max }),
    );
    expect(calculateBMR({ ...male, age: -10 })).toBe(
      calculateBMR({ ...male, age: LIMITS.age.min }),
    );
  });

  it('never returns NaN or a negative number for hostile input', () => {
    for (const bad of [NaN, Infinity, -Infinity, 0, -500]) {
      const bmr = calculateBMR({ sex: 'male', age: bad, heightCm: bad, weightKg: bad });
      expect(Number.isFinite(bmr)).toBe(true);
      expect(bmr).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('calculateTDEE', () => {
  it('multiplies BMR by the activity factor', () => {
    expect(calculateTDEE(2000, 'sedentary')).toBe(2400); // 2000 * 1.2
    expect(calculateTDEE(2000, 'moderate')).toBe(3100); // 2000 * 1.55
    expect(calculateTDEE(2000, 'extra')).toBe(3800); // 2000 * 1.9
  });

  it('uses the conventional factor set', () => {
    expect(ACTIVITY_FACTORS).toEqual({
      sedentary: 1.2,
      light: 1.375,
      moderate: 1.55,
      very: 1.725,
      extra: 1.9,
    });
  });

  it('increases monotonically across activity levels', () => {
    const levels = ['sedentary', 'light', 'moderate', 'very', 'extra'] as const;
    const values = levels.map((level) => calculateTDEE(1800, level));
    const sorted = [...values].sort((a, b) => a - b);
    expect(values).toEqual(sorted);
  });

  it('clamps a negative BMR to zero rather than propagating it', () => {
    expect(calculateTDEE(-100, 'moderate')).toBe(0);
  });
});

describe('applyGoal', () => {
  it('cuts by 20% and bulks by 15%', () => {
    expect(applyGoal(3000, 'cut')).toBe(2400);
    expect(applyGoal(3000, 'maintain')).toBe(3000);
    expect(applyGoal(3000, 'bulk')).toBe(3450);
  });

  it('exposes the adjustments so the UI can state them', () => {
    expect(GOAL_ADJUSTMENTS).toEqual({ cut: -0.2, maintain: 0, bulk: 0.15 });
  });

  it('never recommends less than the calorie floor', () => {
    expect(applyGoal(500, 'cut')).toBe(MIN_KCAL_FLOOR);
    expect(applyGoal(0, 'maintain')).toBe(MIN_KCAL_FLOOR);
  });
});

describe('splitMacros', () => {
  it('splits a maintain target using 1.8 g/kg protein and 25% fat', () => {
    const macros = splitMacros(2759, 80, 'maintain');

    expect(macros.protein).toBe(144); // 80 * 1.8
    expect(macros.fat).toBe(77); // round(2759 * 0.25 / 9)
    // carbs take the remainder: (2759 - 144*4 - 77*9) / 4
    expect(macros.carbs).toBe(Math.round((2759 - 144 * 4 - 77 * 9) / 4));
  });

  it('raises protein to 2.2 g/kg on a cut', () => {
    expect(splitMacros(2000, 80, 'cut').protein).toBe(176);
    expect(splitMacros(2000, 80, 'maintain').protein).toBe(144);
    expect(PROTEIN_G_PER_KG.cut).toBeGreaterThan(PROTEIN_G_PER_KG.maintain);
  });

  it('keeps fat at roughly 25% of calories', () => {
    const kcal = 2400;
    const { fat } = splitMacros(kcal, 75, 'maintain');
    const fatKcalShare = (fat * KCAL_PER_GRAM.fat) / kcal;
    expect(fatKcalShare).toBeCloseTo(FAT_KCAL_SHARE, 2);
  });

  it('produces macros whose calories reconcile with the target', () => {
    const kcal = 2500;
    const macros = splitMacros(kcal, 80, 'maintain');
    const computed =
      macros.protein * KCAL_PER_GRAM.protein +
      macros.carbs * KCAL_PER_GRAM.carbs +
      macros.fat * KCAL_PER_GRAM.fat;
    // Rounding to whole grams moves the total a few kcal at most.
    expect(Math.abs(computed - kcal)).toBeLessThanOrEqual(6);
  });

  it('clamps carbs at zero instead of going negative when protein and fat fill the target', () => {
    // A heavy user on an aggressive cut: protein alone nearly covers the floor.
    const macros = splitMacros(MIN_KCAL_FLOOR, 150, 'cut');
    expect(macros.carbs).toBeGreaterThanOrEqual(0);
    expect(macros.protein).toBe(330);
    // kcal reflects what is actually prescribed, so the UI never shows an impossible target.
    expect(macros.kcal).toBeGreaterThanOrEqual(MIN_KCAL_FLOOR);
  });

  it('never returns NaN or negative macros for hostile input', () => {
    for (const kcal of [NaN, -1000, Infinity, 0]) {
      for (const weight of [NaN, -5, Infinity]) {
        const macros = splitMacros(kcal, weight, 'maintain');
        for (const value of Object.values(macros)) {
          expect(Number.isFinite(value)).toBe(true);
          expect(value).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });
});

describe('calculateTargets — full pipeline', () => {
  it('chains BMR -> TDEE -> goal -> macros for a known male profile', () => {
    const targets = calculateTargets(male);

    expect(targets.bmr).toBe(1780);
    expect(targets.tdee).toBe(2759); // round(1780 * 1.55)
    expect(targets.protein).toBe(144);
    expect(targets.kcal).toBeGreaterThan(targets.tdee - 10);
  });

  it('produces a lower calorie target on a cut than on a bulk', () => {
    const cut = calculateTargets({ ...male, goal: 'cut' });
    const maintain = calculateTargets({ ...male, goal: 'maintain' });
    const bulk = calculateTargets({ ...male, goal: 'bulk' });

    expect(cut.kcal).toBeLessThan(maintain.kcal);
    expect(bulk.kcal).toBeGreaterThan(maintain.kcal);
  });

  it('is deterministic', () => {
    expect(calculateTargets(male)).toEqual(calculateTargets(male));
  });

  it('never yields NaN or negatives across a wide sweep of profiles', () => {
    const sexes = ['male', 'female'] as const;
    const activities = ['sedentary', 'light', 'moderate', 'very', 'extra'] as const;
    const goals = ['cut', 'maintain', 'bulk'] as const;

    for (const sex of sexes) {
      for (const activity of activities) {
        for (const goal of goals) {
          for (const age of [14, 30, 100]) {
            for (const weightKg of [30, 80, 300]) {
              const targets = calculateTargets({ sex, age, heightCm: 175, weightKg, activity, goal });
              for (const [key, value] of Object.entries(targets)) {
                expect(Number.isFinite(value), `${key} finite`).toBe(true);
                expect(value, `${key} non-negative`).toBeGreaterThanOrEqual(0);
              }
              expect(targets.kcal).toBeGreaterThanOrEqual(MIN_KCAL_FLOOR);
            }
          }
        }
      }
    }
  });

  it('survives a profile with garbage values', () => {
    const targets = calculateTargets({
      sex: 'male',
      age: NaN,
      heightCm: Infinity,
      weightKg: -20,
      activity: 'moderate',
      goal: 'cut',
    });
    expect(Number.isFinite(targets.kcal)).toBe(true);
    expect(targets.kcal).toBeGreaterThanOrEqual(MIN_KCAL_FLOOR);
  });
});

describe('normalizeProfile', () => {
  it('clamps every numeric field into the supported range', () => {
    const normalized = normalizeProfile({
      sex: 'male',
      age: 500,
      heightCm: 10,
      weightKg: 1000,
      activity: 'moderate',
      goal: 'cut',
    });

    expect(normalized.age).toBe(LIMITS.age.max);
    expect(normalized.heightCm).toBe(LIMITS.heightCm.min);
    expect(normalized.weightKg).toBe(LIMITS.weightKg.max);
  });

  it('falls back to safe defaults for unknown enum values', () => {
    const normalized = normalizeProfile({
      sex: 'other' as Profile['sex'],
      age: 30,
      heightCm: 180,
      weightKg: 80,
      activity: 'bogus' as Profile['activity'],
      goal: 'bogus' as Profile['goal'],
    });

    expect(normalized.sex).toBe('male');
    expect(normalized.activity).toBe('sedentary');
    expect(normalized.goal).toBe('maintain');
  });
});

describe('clamp', () => {
  it('bounds values within the range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(50, 0, 10)).toBe(10);
  });

  it('falls back to the minimum for NaN, which has no position on the number line', () => {
    expect(clamp(NaN, 3, 10)).toBe(3);
  });

  it('clamps infinities to the bound they run into', () => {
    expect(clamp(Infinity, 3, 10)).toBe(10);
    expect(clamp(-Infinity, 3, 10)).toBe(3);
  });
});

describe('sumMacros', () => {
  it('returns zeroes for an empty list', () => {
    expect(sumMacros([])).toEqual({ kcal: 0, protein: 0, carbs: 0, fat: 0 });
  });

  it('adds every field', () => {
    expect(
      sumMacros([
        { kcal: 100, protein: 10, carbs: 5, fat: 2 },
        { kcal: 250, protein: 20, carbs: 30, fat: 8 },
      ]),
    ).toEqual({ kcal: 350, protein: 30, carbs: 35, fat: 10 });
  });

  it('ignores non-finite values rather than poisoning the total with NaN', () => {
    const total = sumMacros([
      { kcal: 100, protein: 10, carbs: 5, fat: 2 },
      { kcal: NaN, protein: Infinity, carbs: 10, fat: 0 },
    ]);
    expect(total.kcal).toBe(100);
    expect(total.protein).toBe(10);
    expect(total.carbs).toBe(15);
  });
});

describe('remainingMacros', () => {
  it('subtracts consumed from target', () => {
    const remaining = remainingMacros(
      { kcal: 2000, protein: 150, carbs: 200, fat: 60 },
      { kcal: 500, protein: 40, carbs: 60, fat: 15 },
    );
    expect(remaining).toEqual({ kcal: 1500, protein: 110, carbs: 140, fat: 45 });
  });

  it('floors at zero when the target is exceeded', () => {
    const remaining = remainingMacros(
      { kcal: 2000, protein: 150, carbs: 200, fat: 60 },
      { kcal: 2500, protein: 200, carbs: 300, fat: 90 },
    );
    expect(remaining).toEqual({ kcal: 0, protein: 0, carbs: 0, fat: 0 });
  });
});

describe('progressRatio', () => {
  it('returns a 0..1 ratio', () => {
    expect(progressRatio(50, 100)).toBe(0.5);
    expect(progressRatio(0, 100)).toBe(0);
    expect(progressRatio(100, 100)).toBe(1);
  });

  it('caps at 1 when over target', () => {
    expect(progressRatio(300, 100)).toBe(1);
  });

  it('returns 0 rather than dividing by zero or NaN', () => {
    expect(progressRatio(50, 0)).toBe(0);
    expect(progressRatio(NaN, 100)).toBe(0);
    expect(progressRatio(50, NaN)).toBe(0);
  });
});

describe('macrosForGrams', () => {
  const chickenBreast = { kcal: 165, protein: 31, carbs: 0, fat: 3.6 };

  it('returns the per-100g values unchanged at 100 g', () => {
    expect(macrosForGrams(chickenBreast, 100)).toEqual({
      kcal: 165,
      protein: 31,
      carbs: 0,
      fat: 3.6,
    });
  });

  it('scales linearly', () => {
    const half = macrosForGrams(chickenBreast, 50);
    expect(half.kcal).toBe(83); // round(82.5)
    expect(half.protein).toBe(15.5);
    expect(half.fat).toBe(1.8);
  });

  it('scales up past 100 g', () => {
    expect(macrosForGrams(chickenBreast, 200).protein).toBe(62);
  });

  it('returns zeroes for zero, negative, or non-finite grams', () => {
    for (const grams of [0, -50, NaN, Infinity]) {
      const macros = macrosForGrams(chickenBreast, grams === Infinity ? 0 : grams);
      expect(macros.kcal).toBe(0);
      expect(macros.protein).toBe(0);
    }
  });
});
