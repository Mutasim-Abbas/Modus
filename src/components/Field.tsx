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
 * A labelled text/number input. The label is always a real <label for>, never a
 * placeholder — placeholders disappear and screen readers skip them.
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
      <label htmlFor={id} className="text-sm font-semibold text-white">
        {label}
      </label>

      <div className="relative">
        <input
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
          className={cn(
            'min-h-[48px] w-full rounded-md border bg-black-soft px-4 text-[15px] text-white',
            'placeholder:text-gray-soft',
            'transition-colors duration-200 ease-out',
            error
              ? 'border-[color:var(--danger)]'
              : 'border-[color:var(--border)] focus:border-[color:var(--border-strong)]',
            suffix ? 'pe-12' : '',
            className,
          )}
          {...props}
        />
        {suffix ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute end-4 top-1/2 -translate-y-1/2 text-sm text-gray"
          >
            {suffix}
          </span>
        ) : null}
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
