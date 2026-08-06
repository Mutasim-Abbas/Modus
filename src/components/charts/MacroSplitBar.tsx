import { PieChart } from 'lucide-react';
import type { MacroCalorieSplit } from '@/features/progress/selectors';
import { EmptyState } from '@/components/EmptyState';
import { LinkButton } from '@/components/LinkButton';

interface MacroSplitBarProps {
  split: MacroCalorieSplit | null;
}

const SEGMENTS = [
  { key: 'protein', label: 'Protein', color: 'var(--fm-data-protein)' },
  { key: 'carbs', label: 'Carbs', color: 'var(--fm-data-carbs)' },
  { key: 'fat', label: 'Fat', color: 'var(--fm-data-fat)' },
] as const;

/**
 * Where the calories come from: one horizontal stacked bar of protein/carbs/fat as a
 * share of energy, with a legend carrying each percentage.
 *
 * The bar is `aria-hidden` and the same numbers are repeated as real text in the legend
 * below, so a screen reader gets the figures rather than three unlabelled boxes. A
 * segment at 0% is dropped entirely instead of rendering a zero-width sliver that the
 * 3px gap would still make visible as a stray line.
 */
export function MacroSplitBar({ split }: MacroSplitBarProps): JSX.Element {
  if (!split) {
    return (
      <EmptyState
        icon={PieChart}
        /* Deliberately not "Nothing logged in this range" — `CaloriesChart` already
           owns that sentence, and two cards saying it verbatim reads as one message
           duplicated rather than as two cards each answering for themselves. */
        title="No split to show yet"
        description="Log a few days and you'll see which macros your calories came from."
        action={<LinkButton to="/log">Log food</LinkButton>}
      />
    );
  }

  const visible = SEGMENTS.filter((segment) => split[segment.key] > 0);

  return (
    <figure className="m-0 flex flex-col gap-4">
      <div aria-hidden="true" className="flex h-4 gap-[3px] overflow-hidden rounded-full">
        {visible.map((segment) => (
          <div
            key={segment.key}
            className="rounded-full"
            style={{ width: `${split[segment.key]}%`, background: segment.color }}
          />
        ))}
      </div>

      <ul className="flex flex-wrap gap-x-5 gap-y-2.5">
        {SEGMENTS.map((segment) => (
          <li key={segment.key} className="flex items-center gap-2.5">
            <span
              aria-hidden="true"
              className="h-2.5 w-2.5 shrink-0 rounded-[4px]"
              style={{ background: segment.color }}
            />
            <span className="text-[12.5px] text-fm-text-muted">{segment.label}</span>
            <span className="text-xs tabular-nums text-fm-text-faint">
              {split[segment.key]}%
            </span>
          </li>
        ))}
      </ul>

      <figcaption className="text-xs leading-relaxed text-fm-text-subtle">
        Across the {split.loggedDays} {split.loggedDays === 1 ? 'day' : 'days'} you logged
        in this range. Counted as energy — 4 kcal per gram of protein and carbs, 9 per gram
        of fat — not as grams.
      </figcaption>
    </figure>
  );
}
