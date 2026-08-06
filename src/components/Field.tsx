import { useId } from 'react';
import type { InputHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string;
  // Explicit `| undefined` (not just `?`) so callers under `exactOptionalPropertyTypes`
  // can pass a possibly-absent value (e.g. `error={fieldError.email}`) without a ternary.
  hint?: string | undefined;
  error?: string | undefined;
  suffix?: ReactNode;
}

/**
 * A labelled text/number input, in the Modus treatment: the label is a tracked-out micro
 * caption sitting *inside* the field's own card, and the whole card takes the accent
 * border on focus rather than the input drawing a second box within a box.
 *
 * The label is still a real `<label for>`, never a placeholder — placeholders disappear
 * and screen readers skip them. Moving it inside the card changed only where it is
 * painted, so `getByLabelText` keeps working everywhere.
 */
export function Field({
  label,
  hint,
  error,
  suffix,
  className,
  ...props
}: FieldProps): JSX.Element {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
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
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy || undefined}
            className={cn(
              'h-[26px] min-w-0 flex-1 bg-transparent text-[15px] text-white',
              'placeholder:text-fm-text-disabled',
              className,
            )}
            {...props}
          />
          {suffix ? (
            <span aria-hidden="true" className="shrink-0 text-sm text-fm-text-faint">
              {suffix}
            </span>
          ) : null}
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
