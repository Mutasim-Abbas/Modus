import { useId } from 'react';
import { cn } from '@/lib/cn';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  hint?: string;
}

interface SegmentedProps<T extends string> {
  legend: string;
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Stack vertically when options carry hints. */
  columns?: 1 | 2 | 3 | 4;
}

/**
 * A radio group styled as segments.
 *
 * Built on real <input type="radio"> rather than buttons, so arrow-key navigation,
 * form semantics and screen-reader grouping come for free.
 */
export function Segmented<T extends string>({
  legend,
  options,
  value,
  onChange,
  columns = 2,
}: SegmentedProps<T>): JSX.Element {
  const name = useId();

  return (
    <fieldset className="flex flex-col gap-2 border-0 p-0">
      <legend className="mb-1 text-sm font-semibold text-white">{legend}</legend>

      <div
        className={cn(
          'grid gap-2',
          columns === 1 && 'grid-cols-1',
          columns === 2 && 'grid-cols-2',
          columns === 3 && 'grid-cols-3',
          columns === 4 && 'grid-cols-4',
        )}
      >
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <label
              key={option.value}
              className={cn(
                'flex min-h-[48px] cursor-pointer flex-col justify-center rounded-md border px-3 py-2 text-center',
                'transition-colors duration-200 ease-out',
                'focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[color:var(--gold-light)]',
                selected
                  ? 'border-[color:var(--border-strong)] bg-gold/15 text-white'
                  : 'border-[color:var(--border)] bg-surface-2 text-gray hover:text-white',
              )}
            >
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={selected}
                onChange={() => onChange(option.value)}
                className="sr-only"
              />
              <span className={cn('text-sm', selected && 'font-bold')}>{option.label}</span>
              {option.hint ? (
                <span className="mt-0.5 text-[11px] leading-tight text-gray">{option.hint}</span>
              ) : null}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
