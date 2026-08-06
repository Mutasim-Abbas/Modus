import { useId, useState } from 'react';
import type { InputHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

interface PasswordFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'type'> {
  label: string;
  // Explicit `| undefined` (not just `?`) so callers under `exactOptionalPropertyTypes`
  // can pass a possibly-absent value (e.g. `error={fieldError.password}`) directly.
  hint?: string | undefined;
  error?: string | undefined;
}

/**
 * A password input in the same card treatment as `Field`, with a reveal toggle.
 *
 * Kept separate from `Field` because `Field`'s `suffix` slot is decorative and
 * `aria-hidden` — this one needs a real, focusable, `aria-pressed` button. The mock
 * labels it "Show"/"Hide" as text rather than an eye glyph, which is unambiguous and
 * needs no icon-only tooltip; the 44px target is preserved.
 */
export function PasswordField({
  label,
  hint,
  error,
  className,
  ...props
}: PasswordFieldProps): JSX.Element {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const [revealed, setRevealed] = useState(false);
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ');

  return (
    <div className="flex flex-col gap-1.5">
      <div
        className={cn(
          'rounded-lg border-[1.5px] bg-fm-card px-[18px] py-3.5 transition-colors duration-200 ease-out',
          error
            ? 'border-[color:var(--danger)]'
            : 'border-fm-border-neutral focus-within:border-[color:var(--fm-accent)]',
        )}
      >
        <label
          htmlFor={id}
          className="mb-1 block text-[9.5px] font-bold uppercase tracking-[0.14em] text-fm-text-faint"
        >
          {label}
        </label>

        <div className="flex items-center gap-2.5">
          <input
            id={id}
            type={revealed ? 'text' : 'password'}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy || undefined}
            className={cn(
              'h-[26px] min-w-0 flex-1 bg-transparent text-[15px] tracking-[0.04em] text-white',
              'placeholder:text-fm-text-disabled',
              className,
            )}
            {...props}
          />
          <button
            type="button"
            onClick={() => setRevealed((value) => !value)}
            aria-pressed={revealed}
            aria-label={revealed ? 'Hide password' : 'Show password'}
            className="-my-2.5 -me-2 shrink-0 rounded-sm px-2 py-2.5 text-[11.5px] font-semibold text-fm-text-faint transition-colors hover:text-white"
          >
            {revealed ? 'Hide' : 'Show'}
          </button>
        </div>
      </div>

      {hint && !error ? (
        <p id={hintId} className="px-1 text-xs text-fm-text-faint">
          {hint}
        </p>
      ) : null}

      {error ? (
        <p id={errorId} role="alert" className="px-1 text-xs font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
