import { cn } from '@/lib/cn';

export type PasswordStrengthScore = 0 | 1 | 2 | 3;

const LABELS: Record<PasswordStrengthScore, string> = {
  0: 'weak',
  1: 'fair',
  2: 'good',
  3: 'strong',
};

// docs/DESIGN.md §7.9: danger -> warn -> gold-400 -> ok. The shape channel (filled
// segment count) always carries the signal too, never colour alone.
const SEGMENT_CLASSES: Record<PasswordStrengthScore, string> = {
  0: 'bg-danger',
  1: 'bg-fm-warn',
  2: 'bg-gold',
  3: 'bg-success',
};

/**
 * Advisory only — length + variety, matching the server's own NIST-aligned rule
 * (`api/_lib/auth/schemas.ts`: length resists brute force; there is no composition
 * requirement). The server remains the real gate (8–256 chars); this never blocks
 * submission on its own.
 */
export function scorePassword(password: string): PasswordStrengthScore {
  if (password.length < 10) return 0;

  let variety = 0;
  if (/[a-z]/.test(password)) variety += 1;
  if (/[A-Z]/.test(password)) variety += 1;
  if (/[0-9]/.test(password)) variety += 1;
  if (/[^A-Za-z0-9]/.test(password)) variety += 1;

  if (password.length >= 16 && variety >= 2) return 3;
  if (password.length >= 12 && variety >= 2) return 2;
  return 1;
}

interface PasswordStrengthProps {
  password: string;
}

/** 4-segment strength meter. Always paired with the word — segments are the shape channel. */
export function PasswordStrength({ password }: PasswordStrengthProps): JSX.Element | null {
  if (!password) return null;
  const score = scorePassword(password);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-1">
        {([0, 1, 2, 3] as const).map((segment) => (
          <span
            key={segment}
            aria-hidden="true"
            className={cn(
              'h-1.5 flex-1 rounded-full transition-colors duration-200 ease-out',
              segment <= score ? SEGMENT_CLASSES[score] : 'bg-surface-3',
            )}
          />
        ))}
      </div>
      <p className="text-xs text-gray">
        Strength: <span className="font-semibold text-white">{LABELS[score]}</span>
      </p>
    </div>
  );
}
