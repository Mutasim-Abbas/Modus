import { useId, useState } from 'react';
import type { InputHTMLAttributes } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/cn';

interface PasswordFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'type'> {
  label: string;
  // Explicit `| undefined` (not just `?`) so callers under `exactOptionalPropertyTypes`
  // can pass a possibly-absent value (e.g. `error={fieldError.password}`) directly.
  hint?: string | undefined;
  error?: string | undefined;
}

/**
 * A password input with a 44px reveal toggle (docs/DESIGN.md §7.9). Kept separate from
 * the shared `Field` component because `Field`'s `suffix` slot is decorative
 * (`pointer-events-none`) — this one needs a real, focusable, `aria-pressed` button.
 */
export function PasswordField({ label, hint, error, className, ...props }: PasswordFieldProps): JSX.Element {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const [revealed, setRevealed] = useState(false);
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ');

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold text-white">
        {label}
      </label>

      <div className="relative">
        <input
          id={id}
          type={revealed ? 'text' : 'password'}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
          className={cn(
            'min-h-[48px] w-full rounded-md border bg-black-soft px-4 pe-12 text-[15px] text-white',
            'placeholder:text-gray-soft transition-colors duration-200 ease-out',
            error
              ? 'border-[color:var(--danger)]'
              : 'border-[color:var(--border)] focus:border-[color:var(--border-strong)]',
            className,
          )}
          {...props}
        />
        <button
          type="button"
          onClick={() => setRevealed((value) => !value)}
          aria-pressed={revealed}
          aria-label={revealed ? 'Hide password' : 'Show password'}
          className="absolute end-1 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-sm text-gray transition-colors hover:bg-surface-3 hover:text-white"
        >
          {revealed ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
        </button>
      </div>

      {hint && !error ? (
        <p id={hintId} className="text-xs text-gray">
          {hint}
        </p>
      ) : null}

      {error ? (
        <p id={errorId} role="alert" className="text-xs font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
